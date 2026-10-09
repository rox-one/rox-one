#!/usr/bin/env bun
/**
 * Bundle-size budget gate for the Electron renderer.
 *
 * Measures the production renderer assets (apps/electron/dist/renderer/assets) — emitted JS *and* CSS
 * chunks — and fails when a known chunk-name *prefix* grows past its recorded raw-byte budget, when an
 * unbudgeted prefix grows past MAX_NEW_CHUNK_BYTES, or when a whole-extension total grows past its
 * recorded total. Raw `Buffer.byteLength` of the emitted files is the gated number; gzip (level 9) is
 * recorded and reported alongside. Source maps (vite.config.ts `sourcemap: true`) and the pdf worker
 * are never measured.
 *
 * A budget is the TOTAL of every measured chunk sharing a prefix, not the largest one: real `index-*`
 * builds emit a handful of chunks, so gating only the max lets a secondary chunk grow unbounded up to
 * its sibling's size.
 *
 * Usage:
 *   bun scripts/check-bundle-size.ts              # --check (default): fail on any budget overrun
 *   bun scripts/check-bundle-size.ts --check      # same, explicit
 *   bun scripts/check-bundle-size.ts --update     # re-record perf-baselines/bundle-size.json
 *   bun scripts/check-bundle-size.ts --print <out.json>   # write current budgets, compare nothing
 *
 * Options:
 *   --baseline <file>   baseline path (default perf-baselines/bundle-size.json)
 *
 * Exit code: 1 when the renderer build is missing, or any prefix/extension total exceeds its budget or
 * the ceiling; 0 otherwise. Budgets are keyed by the chunk-name prefix
 * (basename.replace(/\.(?:js|css)$/, '').replace(/-[A-Za-z0-9_-]{8}$/, '')) — never the content hash —
 * so a rebuild that only changes hashes does not move the budget. JS prefixes live under `budgets` and
 * CSS prefixes under `stylesheets`, so the two extensions can never collide.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
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
 * Cross-platform slack on every budget AND every whole-extension total: the same source builds to
 * slightly different byte counts on macOS and Linux (observed <= 91 B on the 900 KB `main` chunk), so
 * the gate compares against `recorded + BUDGET_SLACK_BYTES` and reports the raw recorded number.
 */
export const BUDGET_SLACK_BYTES = 4096

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
}

/** Whole-bundle byte counts, summed over every measured chunk of each extension. */
export interface BundleTotals {
  jsRawBytes: number
  jsGzipBytes: number
  cssRawBytes: number
  cssGzipBytes: number
}

export interface BundleBaseline {
  description: string
  /** Human note (e.g. how the seed values were recorded); ignored by the gate. */
  comment?: string
  /** JS chunk-name prefix -> total budget. */
  budgets: Record<string, ChunkBudget>
  /** CSS chunk-name prefix -> total budget (separate map, so the keys never collide with `budgets`). */
  stylesheets?: Record<string, ChunkBudget>
  /** Whole-extension totals; raw bytes are gated, gzip is recorded and reported. */
  totals?: BundleTotals
}

/** The recorded numbers the pure gate reads; every part is optional so a missing baseline degrades cleanly. */
export interface RecordedBudgets {
  budgets?: Record<string, ChunkBudget>
  stylesheets?: Record<string, ChunkBudget>
  totals?: Partial<BundleTotals>
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
  /** The gated byte count: the prefix total, or the whole-extension total. */
  rawBytes: number
  /** Recorded total, or MAX_NEW_CHUNK_BYTES for an unbudgeted prefix. */
  budget: number
  /** Largest measured chunk behind the gated total. */
  file: string
  /** Raw bytes of that largest chunk. */
  fileRawBytes: number
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
 * The measured-asset kind of a file name, or `undefined` when it is not measured: only emitted
 * `*.js` / `*.css` chunks are. `.js.map` / `.css.map` (sourcemap: true) and the pdf worker are
 * excluded explicitly as well as by extension.
 */
export function assetKind(baseName: string): AssetKind | undefined {
  if (baseName.startsWith('pdf.worker')) return undefined
  if (baseName.endsWith('.map')) return undefined
  if (baseName.endsWith('.js')) return 'js'
  if (baseName.endsWith('.css')) return 'css'
  return undefined
}

/** Raw + gzip bytes of every measured `assets/*` chunk, sorted by file name. */
export function measureRendererChunks(assetsDir: string = paths().assets): MeasuredChunk[] {
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
    try {
      const content = readFileSync(join(assetsDir, file))
      chunks.push({
        file,
        prefix: chunkPrefix(file),
        kind,
        rawBytes: content.length,
        // Bun accepts `mtime: 0` (deterministic gzip) beyond Node's ZlibOptions type.
        gzipBytes: gzipSync(content, { level: 9, mtime: 0 } as unknown as Parameters<typeof gzipSync>[1]).length,
      })
    } catch {
      // Vanished between listing and reading (concurrent build) — ignore this entry.
    }
  }
  return chunks
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
export function bundleTotals(chunks: MeasuredChunk[]): BundleTotals {
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
  return totals
}

/**
 * Per-prefix budgets for `--update` / `--print`: the TOTAL of every measured chunk of `kind` sharing a
 * prefix (a prefix such as `index` covers several entry chunks; gating only the largest let a sibling
 * grow to its size unnoticed). Prefixes whose total is below MIN_BUDGET_BYTES are omitted.
 */
export function buildBudgets(chunks: MeasuredChunk[], kind: AssetKind): Record<string, ChunkBudget> {
  const budgets: Record<string, ChunkBudget> = {}
  for (const group of groupByPrefix(chunks.filter((chunk) => chunk.kind === kind))) {
    if (group.rawBytes < MIN_BUDGET_BYTES) continue
    budgets[group.prefix] = { totalRawBytes: group.rawBytes, gzipTotalBytes: group.gzipBytes }
  }
  return budgets
}

/**
 * Pure gate. Fails when (1) a budgeted prefix's TOTAL exceeds its recorded total, (2) an unbudgeted
 * prefix's TOTAL exceeds MAX_NEW_CHUNK_BYTES, or (3) either gated extension total exceeds its recorded
 * total — each with BUDGET_SLACK_BYTES of platform noise allowed. Kept free of filesystem access so it
 * is unit-testable without a build.
 */
export function evaluateAssets(chunks: MeasuredChunk[], recorded: RecordedBudgets): BudgetFailure[] {
  const failures: BudgetFailure[] = []
  for (const kind of ASSET_KINDS) {
    const kindChunks = chunks.filter((chunk) => chunk.kind === kind)
    if (kindChunks.length === 0) continue
    const recordedPrefixes = (kind === 'js' ? recorded.budgets : recorded.stylesheets) ?? {}
    for (const group of groupByPrefix(kindChunks)) {
      // `?? MAX_NEW_CHUNK_BYTES` also guards a baseline recorded in an older shape (a missing
      // `totalRawBytes` would otherwise compare as NaN and pass silently).
      const budget = recordedPrefixes[group.prefix]?.totalRawBytes ?? MAX_NEW_CHUNK_BYTES
      if (group.rawBytes > budget + BUDGET_SLACK_BYTES) {
        failures.push({
          kind,
          prefix: group.prefix,
          rawBytes: group.rawBytes,
          budget,
          file: group.largest.file,
          fileRawBytes: group.largest.rawBytes,
        })
      }
    }
    const recordedTotal = kind === 'js' ? recorded.totals?.jsRawBytes : recorded.totals?.cssRawBytes
    if (recordedTotal === undefined) continue
    const total = kindChunks.reduce((sum, chunk) => sum + chunk.rawBytes, 0)
    if (total <= recordedTotal + BUDGET_SLACK_BYTES) continue
    const largest = kindChunks.reduce((max, chunk) => (chunk.rawBytes > max.rawBytes ? chunk : max), kindChunks[0]!)
    failures.push({
      kind,
      prefix: null,
      rawBytes: total,
      budget: recordedTotal,
      file: largest.file,
      fileRawBytes: largest.rawBytes,
    })
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
    failure.prefix === null
      ? `${failure.kind} bundle total`
      : `${failure.kind} prefix '${failure.prefix}' total`
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

const DESCRIPTION =
  'Renderer bundle-size budgets. Generated by `bun scripts/check-bundle-size.ts --update`; each entry is ' +
  'the TOTAL rawBytes of every emitted assets chunk sharing that chunk-name prefix (js under `budgets`, ' +
  'css under `stylesheets`), gzip reported alongside, plus `totals` summing each extension. Over a ' +
  'recorded total the gate fails (or 2,500,000 B for an unbudgeted prefix).'

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

export function main(argv: string[] = process.argv.slice(2), env: Record<string, string | undefined> = process.env): number {
  const p = paths(env.ROX_BUNDLE_SIZE_ROOT ?? DEFAULT_ROOT)
  const baselineArg = argValue(argv, '--baseline')
  const baselinePath = baselineArg ? resolve(p.root, baselineArg) : p.baseline
  const printArg = argValue(argv, '--print')
  const update = argv.includes('--update')

  if (argv.includes('--print') && !printArg) {
    console.error('bundle-size: --print needs an output path: --print <out.json>')
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

  const chunks = measureRendererChunks(p.assets)
  if (chunks.length === 0) {
    console.error('no renderer build found - run bun run electron:build:renderer first')
    return 1
  }
  const budgets = buildBudgets(chunks, 'js')
  const stylesheets = buildBudgets(chunks, 'css')
  const totals = bundleTotals(chunks)

  if (printArg) {
    writeJson(resolve(printArg), { description: DESCRIPTION, budgets, stylesheets, totals })
    console.log(
      `bundle-size: wrote ${Object.keys(budgets).length} js + ${Object.keys(stylesheets).length} css prefix budget(s) to ${printArg}`,
    )
    return 0
  }

  if (update) {
    writeJson(baselinePath, {
      description: DESCRIPTION,
      comment: 'Recorded by `bun scripts/check-bundle-size.ts --update` against a real renderer build.',
      budgets,
      stylesheets,
      totals,
    })
    console.log(
      `bundle-size: wrote ${relative(p.root, baselinePath)} (${Object.keys(budgets).length} js + ${Object.keys(stylesheets).length} css prefix budget(s))`,
    )
    for (const [prefix, budget] of Object.entries(budgets).sort()) {
      console.log(`  js  ${prefix}: raw ${budget.totalRawBytes} B, gzip ${budget.gzipTotalBytes} B`)
    }
    for (const [prefix, budget] of Object.entries(stylesheets).sort()) {
      console.log(`  css ${prefix}: raw ${budget.totalRawBytes} B, gzip ${budget.gzipTotalBytes} B`)
    }
    console.log(`  js  total: raw ${totals.jsRawBytes} B, gzip ${totals.jsGzipBytes} B`)
    console.log(`  css total: raw ${totals.cssRawBytes} B, gzip ${totals.cssGzipBytes} B`)
    return 0
  }

  let baseline: BundleBaseline
  try {
    baseline = readBaseline(baselinePath)
  } catch {
    // No recorded baseline yet: every prefix is judged against MAX_NEW_CHUNK_BYTES only.
    baseline = { description: DESCRIPTION, budgets: {} }
  }
  const failures = evaluateAssets(chunks, {
    budgets: baseline.budgets ?? {},
    stylesheets: baseline.stylesheets ?? {},
    totals: baseline.totals,
  })
  if (failures.length > 0) {
    for (const failure of failures) console.error(formatFailure(failure))
    console.error(
      `bundle-size: ${failures.length} budget(s) over limit. If the growth is intended, owner-approve ` +
        `it and re-record with \`bun scripts/check-bundle-size.ts --update\`.`,
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