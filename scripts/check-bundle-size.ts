#!/usr/bin/env bun
/**
 * Bundle-size budget gate for the Electron renderer.
 *
 * Measures the production renderer assets (apps/electron/dist/renderer/assets) — emitted JS *and* CSS
 * chunks — and fails when a known chunk-name *prefix* grows past its recorded raw-byte budget, when an
 * unbudgeted prefix grows past MAX_NEW_CHUNK_BYTES, or when a whole-extension total grows past its
 * recorded total. Raw `Buffer.byteLength` of the emitted files is the gated number; gzip (level 9) is
 * recorded and reported alongside. `.map` files and the pdf worker are never measured, and the trailing
 * `//# sourceMappingURL=` pointer comment is stripped before any byte is counted — this gate also runs in
 * the CI job that builds with `ROX_RENDERER_SOURCEMAP=1` (.github/workflows/bundle-size.yml), so the
 * emitted chunks carry that pointer even though the packaged app emits no source maps at all.
 *
 * A budget is the TOTAL of every measured chunk sharing a prefix, not the largest one: real `index-*`
 * builds emit a handful of chunks, so gating only the max lets a secondary chunk grow unbounded up to
 * its sibling's size.
 *
 * Locale entries (`ar`, `de`, …, `zh-Hant`) each embed their own i18n payload, so before the split a
 * translation merge moved twelve per-prefix budgets plus the js total at once and every one of them
 * ended in a re-record (#2031, #2063, #2104, #2120). Those prefixes and the js total are now gated on
 * CODE — the measured total minus the payload that entry embeds, measured from
 * `packages/shared/src/i18n/locales/<locale>.json` — and the payload gets one budget of its own
 * (`i18n.totalRawBytes`, slack 3% + 32 KB) that still fails a runaway. A baseline recorded before the
 * split carries none of the new fields and keeps comparing raw totals, exactly as it was recorded: the
 * subtraction is decided by the recorded shape, never by the presence of locale files. See
 * `LocalePayloads`.
 *
 * The `startup` section gates a different regression class (issue #1675): a heavy chunk added to an
 * entry page's STATIC closure ships eagerly even when every chunk-prefix budget still passes. Each
 * `*.html` in the renderer dist is parsed for `<script src>` and `<link rel="modulepreload" href>`
 * references; their deduped raw bytes (and gzip, reported alongside) are the gated number. A path
 * referenced twice counts once, a reference missing from the build is a hard failure (never a silent
 * 0), and `<link rel="preload" as="style">` is summed into a css total that is reported but never
 * gated. The gate fails when an html file's measured raw total exceeds its recorded entry, or
 * MAX_NEW_STARTUP_BYTES when the build emits an html file with no recorded entry; `--update` records
 * every html file found, with no MIN floor.
 *
 * Usage:
 *   bun scripts/check-bundle-size.ts              # --check (default): fail on any budget overrun
 *   bun scripts/check-bundle-size.ts --check      # same, explicit
 *   bun scripts/check-bundle-size.ts --update     # re-record perf-baselines/bundle-size.json
 *   bun scripts/check-bundle-size.ts --update --prefix=index,main   # re-record only those prefixes
 *   bun scripts/check-bundle-size.ts --print <out.json>   # write current budgets, compare nothing
 *
 * Options:
 *   --baseline <file>   baseline path (default perf-baselines/bundle-size.json)
 *   --prefix <p1,p2>    with --update: accept (re-record) only the named chunk-name prefixes. Every
 *                       other prefix keeps its recorded budget byte for byte, and the totals, the
 *                       startup entries and the payload are left as recorded too; a name in neither
 *                       the build nor the baseline is refused rather than silently accepting nothing.
 *                       The `--prefix=<p1,p2>` spelling is accepted as well. Without --prefix,
 *                       --update rewrites every section exactly as it always has.
 *
 * Every write also records `recordedAt` (ISO-8601 UTC) and `source` (the git sha at the recorded root,
 * else the invocation) next to the `comment`. Those two are provenance for the reviewer, not budgets:
 * the gate reads `budgets`/`stylesheets`/`totals`/`i18n` only, so metadata churn never moves a
 * threshold. A chunk that `readdirSync` listed but `readFileSync` could not read is a hard failure
 * naming the path — a silently skipped chunk understates the bundle, which is the bug class this gate
 * exists for (the same holds for an entry page that vanished before its markup was read).
 *
 * Exit code: 1 when the renderer build is missing, when any prefix/extension total exceeds its budget or
 * the ceiling, when an entry page's static JS closure exceeds its recorded budget or MAX_NEW_STARTUP_BYTES,
 * when an entry page references a file missing from the build, when a listed chunk or entry page could not
 * be read, or when `--prefix` is malformed, unknown or used without `--update`; 0 otherwise. Budgets are
 * keyed by the chunk-name prefix — never the content hash — so a rebuild that only changes hashes does
 * not move the budget. The prefix is the name the build itself recorded for the file, read from Vite's
 * build manifest (`build.manifest: true` -> `<rendererDist>/.vite/manifest.json`, see
 * `readManifestPrefixes`); only when a file is not in the manifest (a stale dist, a fixture tree, or a
 * CSS asset, which Vite emits without a `name`) is it derived by stripping a hash suffix with
 * `chunkPrefix`'s `-<8-char hash>` guess. JS prefixes live under `budgets` and
 * CSS prefixes under `stylesheets`, so the two extensions can never collide; entry pages live under
 * `startup`, keyed by html file name. `--check` prints one startup line per html file and, on failure,
 * the 5 heaviest referenced files behind each offending page.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'

/** Default repo root, overridden in tests (and CI sandboxes) by ROX_BUNDLE_SIZE_ROOT. */
const DEFAULT_ROOT = resolve(import.meta.dir, '..')

/** An unbudgeted chunk prefix may not exceed this; vite.config.ts VENDOR_CHUNKS: ~2.5 MB startup. */
export const MAX_NEW_CHUNK_BYTES = 2_500_000

/**
 * A chunk prefix whose TOTAL is at or above this size at recording time gets its own budget entry;
 * everything smaller stays unbudgeted and is only caught by MAX_NEW_CHUNK_BYTES (a floor keeps the
 * recorded baseline meaningful instead of listing every 1 KB shiki language chunk).
 */
export const MIN_BUDGET_BYTES = 250_000

/**
 * Proportional slack on every budget AND every whole-extension total, as a fraction of that budget.
 * A constant allowance does not scale with the bundle: the previous 4,096 B is 0.012% of the ~35 MB
 * js total, far tighter than the build reproduces — the same source differs across platforms by
 * ~91 B on the 900 KB `main` chunk. One fraction prices the tolerance in the unit being budgeted,
 * instead of at a precision the bundle never had.
 *
 * The fraction is deliberately ~5x that measured platform noise (91 / 900,000 = 0.01%) and no more.
 * Slack exists to absorb build non-determinism, not ordinary code growth: the totals were observed
 * drifting 6,158 B up to 79,135 B between adjacent commits on the ~35 MB total, and a slack wide
 * enough to pass those would be a gate that never fires. At 0.05% the js total is allowed 17,504 B
 * and playground.html 8,558 B, so real growth of that size still fails.
 */
export const BUDGET_SLACK_RATIO = 0.0005

/**
 * Absolute floor of that slack, so a small css chunk or a test fixture is not gated at a byte
 * precision its build cannot reproduce. Kept at the historical 4 KiB: a larger floor does not
 * merely protect small chunks, it *dominates* them — 64 KiB is 7% of a 900 KB chunk and 0.18% of
 * the ~35 MB js total, which is wide enough to swallow the 6-79 KB drift the gate exists to catch.
 */
export const BUDGET_SLACK_MIN_BYTES = 4 * 1024

/**
 * Slack allowed on a recorded budget: `max(BUDGET_SLACK_MIN_BYTES, round(BUDGET_SLACK_RATIO * budget))`
 * — the stated fraction, to the nearest byte. The gate compares against
 * `recorded + budgetSlackBytes(recorded)` and still reports the raw recorded number.
 *
 * The fraction only bites above 8,192,000 B, so every chunk-prefix budget still lands on the 4 KiB
 * floor (the heaviest is ~2.3 MB) and no prefix is gated more loosely than it was at a flat 4 KiB.
 * The budgets it does move are the whole-js total (~36.7 MB -> ~18 KB) and the ~17.8 MB playground.html
 * closure, which is the point of pricing the tolerance in the unit being budgeted.
 */
export function budgetSlackBytes(budget: number): number {
  return Math.max(BUDGET_SLACK_MIN_BYTES, Math.round(budget * BUDGET_SLACK_RATIO))
}

/**
 * Slack on the recorded i18n payload. A feature merge adds keys to every locale, so the payload is
 * *meant* to move — the code budgets must not see it, and this one must not fail the merge that
 * added a screen's worth of strings. It still catches a runaway: a payload that doubles, a locale
 * that stops being split out, or a source file copied into every locale by mistake.
 */
export const PAYLOAD_SLACK_RATIO = 0.03
export const PAYLOAD_SLACK_MIN_BYTES = 32 * 1024

export function payloadSlackBytes(budget: number): number {
  return Math.ceil(Math.max(PAYLOAD_SLACK_MIN_BYTES, budget * PAYLOAD_SLACK_RATIO))
}

/**
 * An entry page (html file) that exists in the build but has no recorded `startup` entry may not pull
 * more than this many raw bytes of static JS into its `<script src>` + modulepreload closure. Bounds
 * the blast radius of a brand-new unbudgeted entry page; real index.html sits near 6.4 MB.
 */
export const MAX_NEW_STARTUP_BYTES = 8_000_000

/**
 * Vite/Rollup hashed-chunk suffix: a dash plus the 8-character content hash.
 * `chunkPrefix('index-B3-J8HY7.js')` -> `index`; a name without that suffix keeps its stem, so the
 * budget key is always the extension-less chunk name (`chunk-abc.js` -> `chunk-abc`, `main.css` -> `main`).
 */
const HASH_SUFFIX = /-[A-Za-z0-9_-]{8}$/
const ASSET_EXTENSION = /\.(?:js|css)$/

const ASSET_KINDS = ['js', 'css'] as const
export type AssetKind = (typeof ASSET_KINDS)[number]

/** A per-prefix budget: the sum over every measured chunk of that prefix. */
export interface ChunkBudget {
  totalRawBytes: number
  gzipTotalBytes: number
  /**
   * `totalRawBytes` minus the i18n payload for a locale entry (absent for code-only prefixes). The
   * gate compares THIS when it is recorded: the renderer emits one entry chunk per locale and each
   * embeds its own translations, so comparing the raw total reads every translation merge as twelve
   * code regressions at once.
   */
  codeRawBytes?: number
}

/** Whole-bundle byte counts, summed over every measured chunk of each extension. */
export interface BundleTotals {
  jsRawBytes: number
  jsGzipBytes: number
  cssRawBytes: number
  cssGzipBytes: number
  /** `jsRawBytes` minus the i18n payload: what the js-total gate compares. */
  jsCodeRawBytes?: number
}

export interface BundleBaseline {
  description: string
  /** Human note (e.g. how the seed values were recorded); ignored by the gate. */
  comment?: string
  /** ISO-8601 UTC instant of the write that produced this file; provenance, never compared. */
  recordedAt?: string
  /** Short provenance of that write: the git sha at the recorded root, else the invocation. Never compared. */
  source?: string
  /** JS chunk-name prefix -> total budget. */
  budgets: Record<string, ChunkBudget>
  /** CSS chunk-name prefix -> total budget (separate map, so the keys never collide with `budgets`). */
  stylesheets?: Record<string, ChunkBudget>
  /** Whole-extension totals; raw bytes are gated, gzip is recorded and reported. */
  totals?: BundleTotals
  /** Entry-page (html file name) -> static JS closure total. Absent in pre-startup baselines. */
  startup?: Record<string, StartupEntry>
  /** The i18n payload, recorded apart from the code it rides with (see `LocalePayloads`). */
  i18n?: LocalePayloads
}

/** One recorded entry page: its deduped static JS closure totals. */
export interface StartupEntry {
  /** Gated number: raw bytes of every deduped `<script src>` + modulepreload referenced file. */
  jsRawBytes: number
  /** gzip level 9 of the same deduped files, summed; informational. */
  gzipTotalBytes: number
  /** Number of distinct JS files in the closure. */
  fileCount: number
}

/** The recorded numbers the pure gate reads; every part is optional so a missing baseline degrades cleanly. */
export interface RecordedBudgets {
  budgets?: Record<string, ChunkBudget>
  stylesheets?: Record<string, ChunkBudget>
  totals?: Partial<BundleTotals>
  i18n?: Partial<LocalePayloads>
}

export interface MeasuredChunk {
  /** Basename, e.g. `index-B3-J8HY7.js` or `main-BCWHcyRa.css`. */
  file: string
  prefix: string
  kind: AssetKind
  /** The gated number: byte length of the emitted chunk. */
  rawBytes: number
  /** gzip level 9, mtime 0 — informational, reported alongside rawBytes. */
  gzipBytes: number
}

export interface BudgetFailure {
  kind: AssetKind
  /** Chunk-name prefix, or `null` for a whole-extension total overrun. */
  prefix: string | null
  /** Overrides the scope wording of the report (e.g. the i18n payload, which is not a chunk prefix). */
  label?: string
  /** The gated byte count: the prefix total, or the whole-extension total. */
  rawBytes: number
  /** Recorded total, or MAX_NEW_CHUNK_BYTES for an unbudgeted prefix. */
  budget: number
  /** Largest measured chunk behind the gated total. */
  file: string
  /** Raw bytes of that largest chunk. */
  fileRawBytes: number
}

/** One referenced file in an entry page's startup closure. */
export interface StartupFile {
  /** Path relative to the renderer dist dir, e.g. `assets/main-B3-J8HY7.js`. */
  file: string
  kind: AssetKind
  rawBytes: number
  gzipBytes: number
}

/** One measured entry page: the deduped static closure of its `*.html` file. */
export interface StartupMeasurement {
  /** Html file name (not a path), e.g. `index.html`. */
  html: string
  /** Gated number: raw bytes of the deduped JS closure. */
  jsRawBytes: number
  /** gzip level 9 of the deduped JS closure, summed. */
  gzipTotalBytes: number
  /** Distinct JS files in the closure. */
  fileCount: number
  /** `<link rel="preload" as="style">` raw bytes; reported, never gated. */
  cssRawBytes: number
  cssGzipBytes: number
  cssFileCount: number
  /** Every referenced file, sorted by raw bytes descending (for the failure report). */
  files: StartupFile[]
  /** Referenced paths (relative to the renderer dist) that are missing from the build. */
  missing: string[]
}

/** A failing entry page: over its recorded budget/ceiling, or referencing a missing file. */
export interface StartupFailure {
  html: string
  jsRawBytes: number
  /** Recorded total, or MAX_NEW_STARTUP_BYTES for an html file with no recorded entry. */
  budget: number
  /** True when the html file had no recorded entry (compared against the ceiling). */
  unbudgeted: boolean
  overBudget: boolean
  missing: string[]
  /** Up to 5 largest referenced files, by raw bytes. */
  topFiles: StartupFile[]
}

export interface Paths {
  root: string
  rendererDist: string
  assets: string
  indexHtml: string
  baseline: string
}

export function paths(root: string = DEFAULT_ROOT): Paths {
  const rendererDist = join(root, 'apps/electron/dist/renderer')
  return {
    root,
    rendererDist,
    assets: join(rendererDist, 'assets'),
    indexHtml: join(rendererDist, 'index.html'),
    baseline: join(root, 'perf-baselines/bundle-size.json'),
  }
}

/** The stable chunk-name prefix (never the hash): `main-BCWHcyRa.js` -> `main`, `main.css` -> `main`. */
export function chunkPrefix(baseName: string): string {
  return baseName.replace(ASSET_EXTENSION, '').replace(HASH_SUFFIX, '')
}

/**
 * Vite's build manifest, relative to the renderer dist (`build.manifest: true` emits it here).
 * The gate prefers it over `chunkPrefix`'s regex: the manifest is the build's own record of the name
 * Rollup gave each emitted chunk, so the gate never has to guess where a content hash begins.
 */
export const MANIFEST_RELATIVE_PATH = join('.vite', 'manifest.json')

/**
 * One entry of Vite's build manifest, keyed by the chunk's source path. Only the fields the gate reads
 * are declared: `file` is the emitted path relative to the renderer dist (e.g. `assets/index-B3-J8HY7.js`)
 * and `name` is the Rollup chunk name — the budget prefix. `name` is absent for emitted *assets*: with
 * the default `cssCodeSplit` Vite emits each chunk's CSS as an asset, so CSS files carry no `name` and
 * keep the regex fallback.
 */
export interface ManifestChunk {
  file: string
  name?: string
}

/**
 * Emitted-file basename -> budget prefix, taken from the build manifest at
 * `<rendererDist>/.vite/manifest.json`.
 *
 * The manifest reports the *real* chunk name, so the gate stops relying on the hash-suffix guess: Vite
 * names each chunk file `assets/[name]-[hash].js` (its default `chunkFileNames`), and Rollup does not
 * de-duplicate a name once `[hash]` is in the pattern — two chunks can both be `index`, distinguished
 * only by their file names. Reading `name` therefore yields exactly the prefix the regex produces today,
 * but keeps doing so when the hash length or the separator changes (the change that would silently
 * re-key — and so un-budget — a prefix under the regex).
 *
 * A missing or unreadable manifest is not an error: a stale dist or a fixture tree simply has none, so
 * every file falls back to `chunkPrefix` (see `measureRendererChunks`). Malformed JSON degrades the
 * same way. Assets Vite emits without a `name` (CSS, fonts, images) are skipped, leaving them to the regex.
 */
export function readManifestPrefixes(rendererDist: string = paths().rendererDist): Map<string, string> {
  const prefixes = new Map<string, string>()
  let raw: string
  try {
    raw = readFileSync(join(rendererDist, MANIFEST_RELATIVE_PATH), 'utf8')
  } catch {
    // No manifest: a dist built before `build.manifest: true`, or a throwaway fixture tree.
    return prefixes
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    // A truncated/partial manifest is not worth failing the gate over; the regex fallback covers it.
    return prefixes
  }
  // `null`/`[]`/a scalar are all valid JSON but not a manifest; only an object maps files to names.
  if (parsed === null || typeof parsed !== 'object') return prefixes
  for (const entry of Object.values(parsed) as Array<ManifestChunk | null>) {
    if (!entry || typeof entry.file !== 'string' || typeof entry.name !== 'string' || entry.name.length === 0) continue
    prefixes.set(basename(entry.file), entry.name)
  }
  return prefixes
}

/**
 * The renderer emits one entry chunk per locale (`ar`, `de`, …, `zh-Hant`) and each embeds its own
 * i18n payload, so a translation merge moves twelve "code" budgets and the js total in lockstep.
 * That is why every feature merge used to end in a re-record (#2031, #2063, #2104, #2120 all exist
 * for it). The payload is measured from its source of truth — `packages/shared/src/i18n/locales/
 * <locale>.json` — and budgeted apart from the code it rides with: locale prefixes and the js total
 * are gated on `codeRawBytes`/`jsCodeRawBytes` (total minus payload), and the payload itself is
 * gated once, with slack wide enough for the keys a feature merge adds.
 */
export interface LocalePayloads {
  /** Locale id (the entry chunk's prefix) -> source JSON bytes. */
  byLocale: Record<string, number>
  /** Sum over every locale. */
  totalRawBytes: number
}

export const I18N_LOCALES_DIR = join('packages', 'shared', 'src', 'i18n', 'locales')

/** Reads the locale payload sizes. An absent directory (a throwaway fixture tree) means "no payload". */
export function readLocalePayloads(root: string): LocalePayloads {
  const dir = join(root, I18N_LOCALES_DIR)
  const byLocale: Record<string, number> = {}
  let totalRawBytes = 0
  let files: string[]
  try {
    files = readdirSync(dir).sort()
  } catch {
    return { byLocale, totalRawBytes }
  }
  for (const file of files) {
    if (!file.endsWith('.json')) continue
    const size = statSync(join(dir, file)).size
    byLocale[file.slice(0, -'.json'.length)] = size
    totalRawBytes += size
  }
  return { byLocale, totalRawBytes }
}

/** The gated code bytes of a chunk that embeds a payload: its measured total minus that payload. */
export function codeBytesOf(rawBytes: number, payloadRawBytes: number | undefined): number {
  return payloadRawBytes === undefined ? rawBytes : Math.max(0, rawBytes - payloadRawBytes)
}

/**
 * The measured-asset kind of a file name, or `undefined` when it is not measured: only emitted
 * `*.js` / `*.css` chunks are. `.js.map` / `.css.map` siblings and the pdf worker are excluded
 * explicitly as well as by extension.
 */
export function assetKind(baseName: string): AssetKind | undefined {
  if (baseName.startsWith('pdf.worker')) return undefined
  if (baseName.endsWith('.map')) return undefined
  if (baseName.endsWith('.js')) return 'js'
  if (baseName.endsWith('.css')) return 'css'
  return undefined
}

/**
 * A trailing sourcemap pointer comment: `//# sourceMappingURL=<file>.map` (Rollup/Vite also emit the
 * legacy `//@` form and `//# sourceMappingURL=data:...` inline URIs). Only the document's final line is
 * ever tested against it, so a `sourceMappingURL` string deeper in the payload is left untouched.
 */
const SOURCEMAP_COMMENT = /^\/\/[#@]\s*sourceMappingURL=/

/**
 * Drop a trailing `//# sourceMappingURL=…` comment line from a measured chunk and return the payload
 * buffer. The pointer names a sibling `.map` file the gate never measures, but the CI job builds with
 * `ROX_RENDERER_SOURCEMAP=1`, so every emitted chunk carries it — counting it would add ~40-58 B per
 * chunk of pure pointer noise. Byte-oriented and conservative: only the last line is removed, and only
 * when it is exactly that comment (together with the line break separating it from the payload and any
 * trailing newline). The input is returned unchanged when there is no such line — nothing is
 * minified, rewritten or otherwise altered.
 */
export function stripSourceMapComment(content: Buffer): Buffer {
  // The pointer, when present, is the document's final line; a trailing newline still belongs to it.
  let end = content.length
  if (end > 0 && content[end - 1] === 0x0a) end--
  if (end > 0 && content[end - 1] === 0x0d) end--
  let start = end
  while (start > 0 && content[start - 1] !== 0x0a) start--
  if (!SOURCEMAP_COMMENT.test(content.subarray(start, end).toString('latin1'))) return content
  // Remove the comment line and the line break that separates it from the payload.
  let cut = start
  if (cut > 0 && content[cut - 1] === 0x0a) cut--
  if (cut > 0 && content[cut - 1] === 0x0d) cut--
  return content.subarray(0, cut)
}

/**
 * A file the build listed that could not then be read — a chunk gone between `readdirSync` and
 * `readFileSync` (a concurrent build rewriting the assets dir), or any other read failure. Skipping it
 * would silently understate the bundle and record a budget no build has to stay under, which is exactly
 * the bug class this gate exists for, so the read is fatal and the message names the offending path.
 */
export class UnreadableFileError extends Error {
  constructor(file: string, cause: unknown) {
    const code = (cause as { code?: unknown } | null)?.code
    super(`bundle-size: cannot read ${file} (${typeof code === 'string' ? code : String(cause)}) - re-run the renderer build if it changed while this ran`)
    this.name = 'UnreadableFileError'
  }
}

/**
 * Raw + gzip bytes of every measured `assets/*` chunk, sorted by file name.
 *
 * `manifestPrefixes` (from `readManifestPrefixes`) names the budget prefix from the build manifest;
 * a file it does not cover — a CSS asset, a stale dist with no manifest, a fixture tree — keeps the
 * `chunkPrefix` hash-suffix regex, which is the only behaviour when no manifest is passed at all.
 */
export function measureRendererChunks(
  assetsDir: string = paths().assets,
  manifestPrefixes?: ReadonlyMap<string, string>,
): MeasuredChunk[] {
  let files: string[]
  try {
    files = readdirSync(assetsDir)
  } catch {
    // No (readable) build output yet; the caller fails closed.
    return []
  }
  const chunks: MeasuredChunk[] = []
  for (const file of files.sort()) {
    const kind = assetKind(file)
    if (!kind) continue
    let content: Buffer
    try {
      // The emitted `//# sourceMappingURL=` pointer (present in the CI build) is not payload.
      content = stripSourceMapComment(readFileSync(join(assetsDir, file)))
    } catch (error) {
      // Never skip a listed chunk: a skipped one is a chunk the gate stops seeing (see UnreadableFileError).
      throw new UnreadableFileError(join(assetsDir, file), error)
    }
    chunks.push({
      file,
      prefix: manifestPrefixes?.get(file) ?? chunkPrefix(file),
      kind,
      rawBytes: content.length,
      // Bun accepts `mtime: 0` (deterministic gzip) beyond Node's ZlibOptions type.
      gzipBytes: gzipSync(content, { level: 9, mtime: 0 } as unknown as Parameters<typeof gzipSync>[1]).length,
    })
  }
  return chunks
}

/** gzip level 9, mtime 0 — the deterministic informational number recorded alongside raw bytes. */
function gzipSize(content: Buffer): number {
  // Bun accepts `mtime: 0` (deterministic gzip) beyond Node's ZlibOptions type.
  return gzipSync(content, { level: 9, mtime: 0 } as unknown as Parameters<typeof gzipSync>[1]).length
}

/** `name="value"` attribute pairs of a single start tag; a bare attribute is ignored. */
function tagAttributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  for (const match of tag.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*"([^"]*)"/g)) {
    attrs[match[1]!.toLowerCase()] = match[2]!
  }
  return attrs
}

/**
 * The startup-closure references of an html document, in document order (duplicates preserved — the
 * caller dedupes by resolved path). `<script src>` and `<link rel="modulepreload">` are JS;
 * `<link rel="preload" as="style">` is CSS. An inline `<script>` (no src) contributes nothing.
 */
export function parseHtmlReferences(html: string): { js: string[]; css: string[] } {
  const js: string[] = []
  const css: string[] = []
  for (const match of html.matchAll(/<(script|link)\b[^>]*>/gi)) {
    const name = match[1]!.toLowerCase()
    const attrs = tagAttributes(match[0]!)
    if (name === 'script') {
      if (attrs.src) js.push(attrs.src)
      continue
    }
    const rels = (attrs.rel ?? '').toLowerCase().split(/\s+/)
    if (!attrs.href) continue
    if (rels.includes('modulepreload')) js.push(attrs.href)
    else if (rels.includes('preload') && (attrs.as ?? '').toLowerCase() === 'style') css.push(attrs.href)
  }
  return { js, css }
}

/**
 * An href resolved against the html file's own directory, or `undefined` for a non-file reference
 * (absolute URL, protocol-relative, or fragment) that cannot live in the build output.
 */
function resolveReference(htmlDir: string, href: string): string | undefined {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) return undefined
  const path = href.split(/[?#]/)[0]!
  if (!path) return undefined
  return resolve(htmlDir, path)
}

/**
 * Measure every `*.html` entry page in the renderer dist: parse its static JS closure (`<script src>`
 * + modulepreload) and CSS preloads, resolve each href relative to the html file's directory, and sum
 * the raw + gzip bytes of the deduped referenced files. A referenced file missing from disk is captured
 * in `missing` (the caller fails on it) rather than counted as 0.
 */
export function measureStartup(rendererDist: string = paths().rendererDist): StartupMeasurement[] {
  let htmlFiles: string[]
  try {
    htmlFiles = readdirSync(rendererDist).filter((file) => file.endsWith('.html'))
  } catch {
    // No (readable) build output yet; the caller fails closed.
    return []
  }
  const measurements: StartupMeasurement[] = []
  for (const html of htmlFiles.sort()) {
    let text: string
    try {
      text = readFileSync(join(rendererDist, html), 'utf8')
    } catch (error) {
      // Skipping the page would drop its `startup` entry from the next --update and quietly un-gate it
      // against the 8 MB ceiling, so a page that vanished between listing and reading is fatal.
      throw new UnreadableFileError(join(rendererDist, html), error)
    }
    const refs = parseHtmlReferences(text)
    const htmlDir = dirname(join(rendererDist, html))
    const seen = new Set<string>()
    const files: StartupFile[] = []
    const missing: string[] = []
    for (const [kind, hrefs] of [
      ['js', refs.js],
      ['css', refs.css],
    ] as const) {
      for (const href of hrefs) {
        const resolved = resolveReference(htmlDir, href)
        if (!resolved || seen.has(resolved)) continue
        seen.add(resolved)
        const file = relative(rendererDist, resolved) || html
        let content: Buffer
        try {
          // The referenced chunk carries the same `//# sourceMappingURL=` pointer the CI build emits.
          content = stripSourceMapComment(readFileSync(resolved))
        } catch {
          missing.push(file)
          continue
        }
        files.push({ file, kind, rawBytes: content.length, gzipBytes: gzipSize(content) })
      }
    }
    files.sort((a, b) => b.rawBytes - a.rawBytes)
    const js = files.filter((entry) => entry.kind === 'js')
    const css = files.filter((entry) => entry.kind === 'css')
    measurements.push({
      html,
      jsRawBytes: js.reduce((sum, entry) => sum + entry.rawBytes, 0),
      gzipTotalBytes: js.reduce((sum, entry) => sum + entry.gzipBytes, 0),
      fileCount: js.length,
      cssRawBytes: css.reduce((sum, entry) => sum + entry.rawBytes, 0),
      cssGzipBytes: css.reduce((sum, entry) => sum + entry.gzipBytes, 0),
      cssFileCount: css.length,
      files,
      missing,
    })
  }
  return measurements
}

/** The recorded `startup` section for `--update` / `--print`: one entry per html file, no MIN floor. */
export function buildStartupEntries(measurements: StartupMeasurement[]): Record<string, StartupEntry> {
  const entries: Record<string, StartupEntry> = {}
  for (const measurement of measurements) {
    entries[measurement.html] = {
      jsRawBytes: measurement.jsRawBytes,
      gzipTotalBytes: measurement.gzipTotalBytes,
      fileCount: measurement.fileCount,
    }
  }
  return entries
}

/**
 * Pure startup gate. Fails an entry page when its measured static JS closure exceeds its recorded total
 * (or MAX_NEW_STARTUP_BYTES when unbudgeted) plus that budget's `budgetSlackBytes`, and fails any
 * entry page referencing a file that is missing from the build.
 */
export function evaluateStartup(
  measurements: StartupMeasurement[],
  recorded: Record<string, StartupEntry> = {},
): StartupFailure[] {
  const failures: StartupFailure[] = []
  for (const measurement of measurements) {
    const entry = recorded[measurement.html]
    const budget = entry?.jsRawBytes ?? MAX_NEW_STARTUP_BYTES
    const unbudgeted = entry?.jsRawBytes === undefined
    const overBudget = measurement.jsRawBytes > budget + budgetSlackBytes(budget)
    if (!overBudget && measurement.missing.length === 0) continue
    failures.push({
      html: measurement.html,
      jsRawBytes: measurement.jsRawBytes,
      budget,
      unbudgeted,
      overBudget,
      missing: [...measurement.missing],
      topFiles: measurement.files.slice(0, 5),
    })
  }
  return failures
}

/** The multi-line startup failure report: the overrun or the missing-file list, then the 5 heaviest files. */
export function formatStartupFailure(failure: StartupFailure): string {
  const lines: string[] = []
  if (failure.overBudget) {
    const label = failure.unbudgeted ? `ceiling ${failure.budget} B (unbudgeted entry page)` : `budget ${failure.budget} B`
    lines.push(
      `startup: ${failure.html} static JS closure is ${failure.jsRawBytes} B, ${label} ` +
        `(+${failure.jsRawBytes - failure.budget} B). Move the payload behind a lazy import`,
    )
  }
  if (failure.missing.length > 0) {
    lines.push(
      `startup: ${failure.html} references ${failure.missing.length} file(s) missing from the build: ` +
        failure.missing.join(', '),
    )
  }
  if (failure.topFiles.length > 0) {
    lines.push(`  heaviest referenced files for ${failure.html}:`)
    for (const file of failure.topFiles) lines.push(`    ${file.file}: ${file.rawBytes} B`)
  }
  return lines.join('\n')
}

interface PrefixGroup {
  prefix: string
  rawBytes: number
  gzipBytes: number
  largest: MeasuredChunk
}

/** Every chunk of one extension grouped by prefix (sorted), each group summing raw + gzip bytes. */
function groupByPrefix(chunks: MeasuredChunk[]): PrefixGroup[] {
  const groups = new Map<string, PrefixGroup>()
  for (const chunk of chunks) {
    const group = groups.get(chunk.prefix)
    if (!group) {
      groups.set(chunk.prefix, {
        prefix: chunk.prefix,
        rawBytes: chunk.rawBytes,
        gzipBytes: chunk.gzipBytes,
        largest: chunk,
      })
      continue
    }
    group.rawBytes += chunk.rawBytes
    group.gzipBytes += chunk.gzipBytes
    if (chunk.rawBytes > group.largest.rawBytes) group.largest = chunk
  }
  return [...groups.values()].sort((a, b) => (a.prefix < b.prefix ? -1 : a.prefix > b.prefix ? 1 : 0))
}

/** Whole-bundle totals for `--update` / `--print`. */
export function bundleTotals(chunks: MeasuredChunk[], payloads?: LocalePayloads): BundleTotals {
  const totals: BundleTotals = { jsRawBytes: 0, jsGzipBytes: 0, cssRawBytes: 0, cssGzipBytes: 0 }
  for (const chunk of chunks) {
    if (chunk.kind === 'js') {
      totals.jsRawBytes += chunk.rawBytes
      totals.jsGzipBytes += chunk.gzipBytes
    } else {
      totals.cssRawBytes += chunk.rawBytes
      totals.cssGzipBytes += chunk.gzipBytes
    }
  }
  if (payloads) totals.jsCodeRawBytes = codeBytesOf(totals.jsRawBytes, payloads.totalRawBytes)
  return totals
}

/**
 * Per-prefix budgets for `--update` / `--print`: the TOTAL of every measured chunk of `kind` sharing a
 * prefix (a prefix such as `index` covers several entry chunks; gating only the largest let a sibling
 * grow to its size unnoticed). Prefixes whose total is below MIN_BUDGET_BYTES are omitted.
 */
export function buildBudgets(chunks: MeasuredChunk[], kind: AssetKind, payloads?: LocalePayloads): Record<string, ChunkBudget> {
  const budgets: Record<string, ChunkBudget> = {}
  for (const group of groupByPrefix(chunks.filter((chunk) => chunk.kind === kind))) {
    if (group.rawBytes < MIN_BUDGET_BYTES) continue
    const payload = payloads?.byLocale[group.prefix]
    budgets[group.prefix] = {
      totalRawBytes: group.rawBytes,
      gzipTotalBytes: group.gzipBytes,
      ...(payload === undefined ? {} : { codeRawBytes: codeBytesOf(group.rawBytes, payload) }),
    }
  }
  return budgets
}

/**
 * Pure gate. Fails when (1) a budgeted prefix's TOTAL exceeds its recorded total, (2) an unbudgeted
 * prefix's TOTAL exceeds MAX_NEW_CHUNK_BYTES, or (3) either gated extension total exceeds its recorded
 * total — each compared against `budget + budgetSlackBytes(budget)`. Kept free of filesystem access so
 * it is unit-testable without a build.
 */
export function evaluateAssets(
  chunks: MeasuredChunk[],
  recorded: RecordedBudgets,
  payloads?: LocalePayloads,
): BudgetFailure[] {
  const failures: BudgetFailure[] = []
  for (const kind of ASSET_KINDS) {
    const kindChunks = chunks.filter((chunk) => chunk.kind === kind)
    if (kindChunks.length === 0) continue
    const recordedPrefixes = (kind === 'js' ? recorded.budgets : recorded.stylesheets) ?? {}
    for (const group of groupByPrefix(kindChunks)) {
      const recordedEntry = recordedPrefixes[group.prefix]
      // A locale entry embeds its payload: gate the code it carries, not the translations it
      // re-exports (see LocalePayloads). A baseline recorded before the split has no `codeRawBytes`,
      // so it keeps comparing raw totals — the same shape it was recorded in.
      const recordedCode = recordedEntry?.codeRawBytes
      const gated = recordedCode === undefined ? group.rawBytes : codeBytesOf(group.rawBytes, payloads?.byLocale[group.prefix])
      // `?? MAX_NEW_CHUNK_BYTES` also guards a baseline recorded in an older shape (a missing
      // `totalRawBytes` would otherwise compare as NaN and pass silently).
      const budget = recordedCode ?? recordedEntry?.totalRawBytes ?? MAX_NEW_CHUNK_BYTES
      if (gated > budget + budgetSlackBytes(budget)) {
        failures.push({
          kind,
          prefix: group.prefix,
          rawBytes: gated,
          budget,
          file: group.largest.file,
          fileRawBytes: group.largest.rawBytes,
        })
      }
    }
    const recordedTotal = kind === 'js' ? recorded.totals?.jsRawBytes : recorded.totals?.cssRawBytes
    if (recordedTotal === undefined) continue
    const total = kindChunks.reduce((sum, chunk) => sum + chunk.rawBytes, 0)
    // The js total carries the same twelve payloads, so compare the code once a build recorded it.
    const recordedCode = kind === 'js' ? recorded.totals?.jsCodeRawBytes : undefined
    const gatedTotal = recordedCode === undefined ? total : codeBytesOf(total, payloads?.totalRawBytes ?? 0)
    const gatedBudget = recordedCode ?? recordedTotal
    if (gatedTotal <= gatedBudget + budgetSlackBytes(gatedBudget)) continue
    const largest = kindChunks.reduce((max, chunk) => (chunk.rawBytes > max.rawBytes ? chunk : max), kindChunks[0]!)
    failures.push({
      kind,
      prefix: null,
      rawBytes: gatedTotal,
      budget: gatedBudget,
      file: largest.file,
      fileRawBytes: largest.rawBytes,
    })
  }
  if (payloads && payloads.totalRawBytes > 0) {
    const recordedPayload = recorded.i18n?.totalRawBytes
    if (recordedPayload !== undefined && payloads.totalRawBytes > recordedPayload + payloadSlackBytes(recordedPayload)) {
      const largestLocale = Object.entries(payloads.byLocale).reduce(
        (max, entry) => (entry[1] > max[1] ? entry : max),
        ['', 0] as [string, number],
      )
      failures.push({
        kind: 'js',
        prefix: null,
        label: 'i18n payload total',
        rawBytes: payloads.totalRawBytes,
        budget: recordedPayload,
        file: `${largestLocale[0]}.json`,
        fileRawBytes: largestLocale[1],
      })
    }
  }
  return failures
}

/**
 * The single-line failure report naming the offending prefix (or extension total), the gated total and
 * its budget, plus the largest chunk file behind it and that file's size.
 */
export function formatFailure(failure: BudgetFailure): string {
  const diff = failure.rawBytes - failure.budget
  const scope =
    failure.label ??
    (failure.prefix === null
      ? `${failure.kind} bundle total`
      : `${failure.kind} prefix '${failure.prefix}' total`)
  return (
    `bundle-size: ${scope} is ${failure.rawBytes} B, budget ${failure.budget} B (+${diff} B); largest chunk ` +
    `assets/${failure.file} is ${failure.fileRawBytes} B. Shrink it (move the payload behind a lazy import - ` +
    `see vite.config.ts VENDOR_CHUNKS / SIDE_EFFECT_FREE_MODULES) or re-record: ` +
    `bun scripts/check-bundle-size.ts --update`
  )
}

export function readBaseline(file: string): BundleBaseline {
  return JSON.parse(readFileSync(file, 'utf8')) as BundleBaseline
}

export function writeJson(file: string, value: unknown) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
}

/** The value after `name` (the last occurrence wins, so a CLI flag overrides a script default). */
function argValue(args: string[], name: string): string | undefined {
  const index = args.lastIndexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

const PREFIX_FLAG = '--prefix'

/**
 * The `--prefix` value: `--prefix=<p1,p2>` (the spelling in the usage block) or a following word, the
 * way `--baseline`/`--print` take theirs. A repeated flag resolves to its last occurrence, and a bare
 * trailing `--prefix` yields the empty string so the caller refuses it instead of silently rewriting
 * everything — the one outcome a selective accept must never fall back to.
 */
function prefixArg(args: string[]): string | undefined {
  let value: string | undefined
  for (const [index, arg] of args.entries()) {
    if (arg.startsWith(`${PREFIX_FLAG}=`)) value = arg.slice(PREFIX_FLAG.length + 1)
    else if (arg === PREFIX_FLAG) value = args[index + 1] ?? ''
  }
  return value
}

/**
 * The `--update --prefix=` accept: the recorded budgets with only the named prefixes replaced by what
 * the build now weighs. Every other prefix keeps its recorded entry untouched (including a
 * `codeRawBytes` from the i18n split), a named prefix the build no longer emits keeps its recorded
 * entry too, and a named prefix new to the build is added. Recorded order is preserved and new names
 * are appended in prefix order, so a selective accept rewrites the named entry and nothing else.
 */
export function mergePrefixBudgets(
  recorded: Record<string, ChunkBudget>,
  measured: Record<string, ChunkBudget>,
  accepted: readonly string[],
): Record<string, ChunkBudget> {
  const pending = new Set(accepted)
  const merged: Record<string, ChunkBudget> = {}
  for (const [name, entry] of Object.entries(recorded)) {
    if (!pending.has(name)) {
      merged[name] = entry
      continue
    }
    pending.delete(name)
    merged[name] = measured[name] ?? entry
  }
  for (const name of [...pending].sort()) {
    const entry = measured[name]
    if (entry) merged[name] = entry
  }
  return merged
}

/** The two provenance fields every write records; the gate never compares them (see `BundleBaseline`). */
export interface Provenance {
  /** ISO-8601 UTC instant of the write (`Date#toISOString`). */
  recordedAt: string
  /** Short provenance of the write: the git sha at the recorded root, else how the script was invoked. */
  source: string
}

/**
 * The short git HEAD sha at `root`, or `undefined` when `root` is not a checkout (a throwaway fixture
 * tree, an exported tarball) or git is unavailable. Provenance labels the recording; it is never a gate
 * input, so a missing sha degrades to the invocation instead of failing the run.
 */
export function gitHeadSha(root: string): string | undefined {
  try {
    const result = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' })
    if (result.error || result.status !== 0) return undefined
    const sha = result.stdout.trim()
    return sha.length > 0 ? sha : undefined
  } catch {
    // git missing, or `root` gone: provenance is a label, so fall back to the invocation.
    return undefined
  }
}

/** The provenance of a write: the sha of the measured tree when it is a checkout, else the invocation. */
export function recordProvenance(root: string, argv: string[]): Provenance {
  return {
    recordedAt: new Date().toISOString(),
    source: gitHeadSha(root) ?? ['bun scripts/check-bundle-size.ts', ...argv].join(' '),
  }
}

export const DESCRIPTION =
  'Renderer bundle-size budgets. Generated by `bun scripts/check-bundle-size.ts --update`; each entry is ' +
  'the TOTAL rawBytes of every emitted assets chunk sharing that chunk-name prefix (js under `budgets`, ' +
  'css under `stylesheets`), gzip reported alongside, plus `totals` summing each extension. Over a ' +
  'recorded total the gate fails (or 2,500,000 B for an unbudgeted prefix). `startup` records, per entry ' +
  'html file, the raw + gzip bytes of the deduped static JS closure (`<script src>` + modulepreload); ' +
  'the gate fails when it grows past the recorded total, or 8,000,000 B for an html file with no entry.'

/**
 * The `comment` every `--update` writes. Both this and `DESCRIPTION` are canonical values rather than
 * per-recording notes: they are rewritten on every write, selective accept included, so a file that
 * carried its own text is canonicalised rather than kept.
 */
export const RECORDED_COMMENT = 'Recorded by `bun scripts/check-bundle-size.ts --update` against a real renderer build.'

/** The largest prefix totals, with their gate budget, for the success table (top 5 by raw bytes). */
function topPrefixes(
  chunks: MeasuredChunk[],
  budgets: Record<string, ChunkBudget>,
  stylesheets: Record<string, ChunkBudget>,
) {
  return ASSET_KINDS.flatMap((kind) =>
    groupByPrefix(chunks.filter((chunk) => chunk.kind === kind)).map((group) => ({
      kind,
      prefix: group.prefix,
      rawBytes: group.rawBytes,
      gzipBytes: group.gzipBytes,
      budget:
        (kind === 'js' ? budgets : stylesheets)[group.prefix]?.totalRawBytes ?? MAX_NEW_CHUNK_BYTES,
    })),
  )
    .sort((a, b) => b.rawBytes - a.rawBytes)
    .slice(0, 5)
}

function printSuccessTable(
  chunks: MeasuredChunk[],
  budgets: Record<string, ChunkBudget>,
  stylesheets: Record<string, ChunkBudget>,
  recorded: Partial<BundleTotals> | undefined,
) {
  const rows = topPrefixes(chunks, budgets, stylesheets)
  console.log(
    `bundle-size: ${chunks.length} renderer asset(s) measured (prefix totals gate raw bytes; gzip reported alongside)`,
  )
  console.log(
    `  ${'kind'.padEnd(4)} ${'prefix'.padEnd(24)} ${'raw'.padStart(10)} ${'gzip'.padStart(10)} ${'budget'.padStart(10)}`,
  )
  for (const row of rows) {
    console.log(
      `  ${row.kind.padEnd(4)} ${row.prefix.padEnd(24)} ${String(row.rawBytes).padStart(10)} ${String(row.gzipBytes).padStart(10)} ${String(row.budget).padStart(10)}`,
    )
  }
  const measured = bundleTotals(chunks)
  for (const [kind, raw, gzip, budget] of [
    ['js', measured.jsRawBytes, measured.jsGzipBytes, recorded?.jsRawBytes],
    ['css', measured.cssRawBytes, measured.cssGzipBytes, recorded?.cssRawBytes],
  ] as const) {
    console.log(`  ${kind} total: raw ${raw} B (budget ${budget ?? 'unrecorded'}), gzip ${gzip} B`)
  }
}

/** One line per entry html file: measured static-closure totals and the recorded budget (or `unbudgeted`). */
function printStartupTable(measurements: StartupMeasurement[], recorded: Record<string, StartupEntry>) {
  console.log(
    `startup: ${measurements.length} entry page(s) measured (static JS closure = <script src> + <link rel="modulepreload">; css reported, not gated)`,
  )
  console.log(
    `  ${'html'.padEnd(28)} ${'jsRaw'.padStart(10)} ${'jsGzip'.padStart(10)} ${'files'.padStart(6)} ${'cssRaw'.padStart(10)} ${'budget'.padStart(10)}`,
  )
  for (const measurement of measurements) {
    const entry = recorded[measurement.html]
    const budget = entry ? String(entry.jsRawBytes) : 'unbudgeted'
    console.log(
      `  ${measurement.html.padEnd(28)} ${String(measurement.jsRawBytes).padStart(10)} ${String(measurement.gzipTotalBytes).padStart(10)} ${String(measurement.fileCount).padStart(6)} ${String(measurement.cssRawBytes).padStart(10)} ${budget.padStart(10)}`,
    )
  }
}

/**
 * `--update` resets every budget to whatever the build now weighs, which is precisely why the
 * acceptance has to stay readable afterwards: without a delta, "re-recorded" and "silently grew"
 * look identical in review.
 *
 * Prints only what moved, plus the one shape a re-record must never bury — an entry page whose
 * static closure gained files, which is how a lazy import quietly turns back into a blocking one.
 * Byte totals alone cannot show that: a page can shrink while pulling in more files, or grow while
 * shedding them.
 */
export function formatUpdateDelta(
  previous: BundleBaseline | undefined,
  next: Pick<BundleBaseline, 'budgets' | 'stylesheets' | 'totals' | 'startup'>,
): string[] {
  if (!previous) return ['bundle-size: no committed baseline to compare against; this is a first recording']
  const lines: string[] = []
  const signed = (after: number, before: number) => `${after - before < 0 ? '-' : '+'}${Math.abs(after - before)}`
  const moved = (label: string, before: number | undefined, after: number) => {
    if (before === undefined) { lines.push(`  ${label}: new, ${after} B`); return }
    if (before === after) return
    lines.push(`  ${label}: ${before} → ${after} B  (${signed(after, before)})`)
  }
  const prefixes = (kind: 'js' | 'css', after: Record<string, ChunkBudget> | undefined, before: Record<string, ChunkBudget> | undefined) => {
    for (const [name, entry] of Object.entries(after ?? {}).sort()) {
      moved(`${kind}  ${name}`, before?.[name]?.totalRawBytes, entry.totalRawBytes)
    }
  }
  // A total neither side recorded is not "new": a selective accept leaves `totals` as recorded, and an
  // old baseline may not carry one at all.
  if (previous.totals?.jsRawBytes !== undefined || next.totals?.jsRawBytes !== undefined) {
    moved('js  total', previous.totals?.jsRawBytes, next.totals?.jsRawBytes ?? 0)
  }
  if (previous.totals?.cssRawBytes !== undefined || next.totals?.cssRawBytes !== undefined) {
    moved('css total', previous.totals?.cssRawBytes, next.totals?.cssRawBytes ?? 0)
  }
  prefixes('js', next.budgets, previous.budgets)
  prefixes('css', next.stylesheets, previous.stylesheets)
  const grewClosure: string[] = []
  for (const [html, entry] of Object.entries(next.startup ?? {}).sort()) {
    const was = previous.startup?.[html]
    if (was && was.fileCount !== entry.fileCount) {
      lines.push(`  startup ${html}: ${was.jsRawBytes} → ${entry.jsRawBytes} B  (${signed(entry.jsRawBytes, was.jsRawBytes)}), ${was.fileCount} → ${entry.fileCount} file(s)`)
      if (entry.fileCount > was.fileCount) grewClosure.push(`${html} (${was.fileCount} → ${entry.fileCount})`)
      continue
    }
    moved(`startup ${html}`, was?.jsRawBytes, entry.jsRawBytes)
  }
  if (lines.length === 0) return ['  (nothing moved)']
  if (grewClosure.length > 0) {
    lines.push(`  ! static closure gained file(s): ${grewClosure.join(', ')} — confirm this is not a lazy import that became blocking`)
  }
  return lines
}

export function main(argv: string[] = process.argv.slice(2), env: Record<string, string | undefined> = process.env): number {
  const p = paths(env.ROX_BUNDLE_SIZE_ROOT ?? DEFAULT_ROOT)
  const baselineArg = argValue(argv, '--baseline')
  const baselinePath = baselineArg ? resolve(p.root, baselineArg) : p.baseline
  const printArg = argValue(argv, '--print')
  const update = argv.includes('--update')
  const prefixArgValue = prefixArg(argv)
  const accepted = prefixArgValue?.split(',').map((name) => name.trim()).filter(Boolean)
  const acceptedNames = accepted ? new Set(accepted) : undefined

  if (argv.includes('--print') && !printArg) {
    console.error('bundle-size: --print needs an output path: --print <out.json>')
    return 1
  }
  if (prefixArgValue !== undefined && !update) {
    console.error('bundle-size: --prefix narrows --update only: bun scripts/check-bundle-size.ts --update --prefix=<p1,p2>')
    return 1
  }
  if (accepted?.length === 0) {
    console.error('bundle-size: --prefix needs the chunk-name prefix(es) to accept: --prefix=<p1,p2>')
    return 1
  }

  // Fail closed: without the renderer entry HTML there is no build to measure. Read it
  // rather than pre-checking existence so the gate never races a concurrent build.
  try {
    readFileSync(p.indexHtml)
  } catch {
    console.error('no renderer build found - run bun run electron:build:renderer first')
    return 1
  }

  let chunks: MeasuredChunk[]
  let startup: StartupMeasurement[]
  try {
    // The build manifest names each chunk; without one (a stale dist) every file keeps the regex.
    chunks = measureRendererChunks(p.assets, readManifestPrefixes(p.rendererDist))
    startup = measureStartup(p.rendererDist)
  } catch (error) {
    // A file the build listed that cannot be read is fatal in every mode (see UnreadableFileError):
    // whatever the gate skipped is a chunk it would stop budgeting.
    if (!(error instanceof UnreadableFileError)) throw error
    console.error(error.message)
    return 1
  }
  if (chunks.length === 0) {
    console.error('no renderer build found - run bun run electron:build:renderer first')
    return 1
  }
  // The i18n payload is measured from its source of truth, so a locale entry's gate compares the
  // code it carries instead of the translations it embeds (see LocalePayloads).
  const payloads = readLocalePayloads(p.root)
  const budgets = buildBudgets(chunks, 'js', payloads)
  const stylesheets = buildBudgets(chunks, 'css')
  const totals = bundleTotals(chunks, payloads)
  const startupEntries = buildStartupEntries(startup)

  // A reference that resolves to nothing on disk means the build is incomplete: recording 0 bytes for it
  // (and calling the page within budget) would hide the regression, so fail closed in every mode.
  const missing = startup.filter((measurement) => measurement.missing.length > 0)
  if (missing.length > 0) {
    for (const measurement of missing) {
      console.error(
        formatStartupFailure({
          html: measurement.html,
          jsRawBytes: measurement.jsRawBytes,
          budget: startupEntries[measurement.html]?.jsRawBytes ?? MAX_NEW_STARTUP_BYTES,
          unbudgeted: startupEntries[measurement.html] === undefined,
          overBudget: false,
          missing: measurement.missing,
          topFiles: measurement.files.slice(0, 5),
        }),
      )
    }
    console.error('startup: the renderer build references file(s) that are missing - run bun run electron:build:renderer first')
    return 1
  }

  if (printArg) {
    writeJson(resolve(printArg), {
      description: DESCRIPTION,
      ...recordProvenance(p.root, argv),
      budgets,
      stylesheets,
      totals,
      startup: startupEntries,
      i18n: payloads,
    })
    console.log(
      `bundle-size: wrote ${Object.keys(budgets).length} js + ${Object.keys(stylesheets).length} css prefix budget(s) ` +
        `and ${Object.keys(startupEntries).length} startup entry page(s) to ${printArg}`,
    )
    return 0
  }

  if (update) {
    // Read the outgoing baseline before overwriting it: the delta is the only durable record of what
    // this acceptance costs, and the write below destroys the evidence.
    let previous: BundleBaseline | undefined
    try {
      previous = readBaseline(baselinePath)
    } catch {
      previous = undefined
    }

    // `--prefix` narrows a recording it has to preserve, so it needs one: writing only the named
    // prefixes into an empty baseline would silently un-budget every other prefix.
    if (accepted && !previous) {
      console.error(
        `bundle-size: --prefix needs the baseline it narrows (${relative(p.root, baselinePath)}) to keep every other recorded budget`,
      )
      return 1
    }
    // The prefixes this build emits, floor or no floor: a name below MIN_BUDGET_BYTES is a real prefix
    // the recording simply has no entry for, which is not the same as a name that does not exist.
    const measuredPrefixes = new Set(chunks.map((entry) => entry.prefix))
    if (accepted) {
      // A name in neither the build nor the recording would accept nothing while looking like it did.
      const unknown = accepted.filter(
        (name) =>
          !measuredPrefixes.has(name) &&
          previous?.budgets?.[name] === undefined &&
          previous?.stylesheets?.[name] === undefined,
      )
      if (unknown.length > 0) {
        console.error(
          `bundle-size: --prefix names chunk-name prefix(es) that are neither in the build nor in the baseline: ` +
            `${unknown.join(', ')}; known: ${[...measuredPrefixes, ...Object.keys(previous?.budgets ?? {}), ...Object.keys(previous?.stylesheets ?? {})].sort().join(', ')}`,
        )
        return 1
      }
    }

    const nextBudgets = accepted ? mergePrefixBudgets(previous?.budgets ?? {}, budgets, accepted) : budgets
    const nextStylesheets = accepted ? mergePrefixBudgets(previous?.stylesheets ?? {}, stylesheets, accepted) : stylesheets
    // `totals`, `startup` and `i18n` are whole-build numbers: a selective accept leaves them exactly as
    // recorded rather than mixing one fresh measurement into a partly-old file.
    const nextTotals = accepted ? previous?.totals : totals
    const nextStartup = accepted ? previous?.startup : startupEntries
    const nextI18n = accepted ? previous?.i18n : payloads
    writeJson(baselinePath, {
      description: DESCRIPTION,
      comment: RECORDED_COMMENT,
      ...recordProvenance(p.root, argv),
      budgets: nextBudgets,
      stylesheets: nextStylesheets,
      totals: nextTotals,
      startup: nextStartup,
      i18n: nextI18n,
    })
    console.log(
      `bundle-size: wrote ${relative(p.root, baselinePath)} (${Object.keys(nextBudgets).length} js + ${Object.keys(nextStylesheets).length} css prefix budget(s))`,
    )
    for (const [prefix, budget] of Object.entries(nextBudgets).sort()) {
      if (acceptedNames && !acceptedNames.has(prefix)) continue
      console.log(`  js  ${prefix}: raw ${budget.totalRawBytes} B, gzip ${budget.gzipTotalBytes} B`)
    }
    for (const [prefix, budget] of Object.entries(nextStylesheets).sort()) {
      if (acceptedNames && !acceptedNames.has(prefix)) continue
      console.log(`  css ${prefix}: raw ${budget.totalRawBytes} B, gzip ${budget.gzipTotalBytes} B`)
    }
    if (accepted) {
      console.log(
        `bundle-size: --prefix=${accepted.join(',')} accepted only those prefixes; every other budget, plus ` +
          `\`totals\`, \`startup\` and \`i18n\`, stays exactly as recorded`,
      )
      const notInBuild = accepted.filter((name) => !measuredPrefixes.has(name))
      if (notInBuild.length > 0) {
        console.log(`  ${notInBuild.join(', ')}: not in this build, so its recorded budget was kept`)
      }
      const belowFloor = accepted.filter(
        (name) => measuredPrefixes.has(name) && budgets[name] === undefined && stylesheets[name] === undefined,
      )
      if (belowFloor.length > 0) {
        console.log(`  ${belowFloor.join(', ')}: below the ${MIN_BUDGET_BYTES} B recording floor, so it has no entry to accept`)
      }
    } else {
      console.log(`  js  total: raw ${totals.jsRawBytes} B, gzip ${totals.jsGzipBytes} B`)
      console.log(
        `  js  total code (raw minus i18n payload): ${totals.jsCodeRawBytes ?? totals.jsRawBytes} B; ` +
          `i18n payload ${payloads.totalRawBytes} B over ${Object.keys(payloads.byLocale).length} locale(s)`,
      )
      console.log(`  css total: raw ${totals.cssRawBytes} B, gzip ${totals.cssGzipBytes} B`)
      for (const [html, entry] of Object.entries(startupEntries).sort()) {
        console.log(`  startup ${html}: js raw ${entry.jsRawBytes} B, gzip ${entry.gzipTotalBytes} B, ${entry.fileCount} file(s)`)
      }
    }
    console.log('bundle-size: delta vs the baseline being replaced')
    for (const line of formatUpdateDelta(previous, {
      budgets: nextBudgets,
      stylesheets: nextStylesheets,
      totals: nextTotals,
      startup: nextStartup,
    })) {
      console.log(line)
    }
    return 0
  }

  let baseline: BundleBaseline
  try {
    baseline = readBaseline(baselinePath)
  } catch {
    // No recorded baseline yet: every prefix is judged against MAX_NEW_CHUNK_BYTES only.
    baseline = { description: DESCRIPTION, budgets: {} }
  }
  const failures = evaluateAssets(
    chunks,
    { budgets: baseline.budgets ?? {}, stylesheets: baseline.stylesheets ?? {}, totals: baseline.totals, i18n: baseline.i18n },
    payloads,
  )
  const startupRecorded = baseline.startup ?? {}
  const startupFailures = evaluateStartup(startup, startupRecorded)
  printStartupTable(startup, startupRecorded)
  if (failures.length > 0 || startupFailures.length > 0) {
    const reports = [
      ...failures.map((failure) => formatFailure(failure)),
      ...startupFailures.map((failure) => formatStartupFailure(failure)),
    ]
    for (const message of reports) {
      console.error(message)
      // Also emit a workflow command so the byte deltas reach the GitHub check-run annotations
      // (`%`, CR and LF must be percent-encoded or the annotation truncates at the first newline).
      console.log(`::error::${message.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')}`)
    }
    console.error(
      `bundle-size: ${failures.length + startupFailures.length} budget(s) over limit. If the growth is ` +
        `intended, owner-approve it and re-record with \`bun scripts/check-bundle-size.ts --update\`.`,
    )
    return 1
  }

  printSuccessTable(chunks, baseline.budgets ?? {}, baseline.stylesheets ?? {}, baseline.totals)
  console.log('bundle-size: OK — every renderer asset total is within its budget.')
  return 0
}

if (import.meta.main) {
  process.exit(main())
}