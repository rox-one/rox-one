/**
 * Bundle-size budget gate (scripts/check-bundle-size.ts) and the closed-form minify profile.
 *
 * The gate cases are exercised both through the real CLI (exit codes as CI sees them) on throwaway
 * renderer trees and against the pure `evaluateAssets`, which aggregates js/css prefix TOTALS and the
 * whole-extension totals; prefix derivation and the recording floor are pure-function cases. The
 * recording itself is covered too: `--update --prefix=` must move only the prefixes it names, every
 * write must carry provenance the gate ignores, and a chunk the build listed but cannot be read must
 * fail rather than vanish from the measurement.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import {
  BUDGET_SLACK_MIN_BYTES,
  BUDGET_SLACK_RATIO,
  DESCRIPTION,
  MANIFEST_RELATIVE_PATH,
  MAX_NEW_CHUNK_BYTES,
  MAX_NEW_STARTUP_BYTES,
  MIN_BUDGET_BYTES,
  RECORDED_COMMENT,
  UnreadableFileError,
  assetKind,
  budgetSlackBytes,
  buildBudgets,
  bundleTotals,
  chunkPrefix,
  evaluateAssets,
  evaluateStartup,
  formatFailure,
  formatStartupFailure,
  formatUpdateDelta,
  gitHeadSha,
  measureRendererChunks,
  measureStartup,
  mergePrefixBudgets,
  parseHtmlReferences,
  payloadSlackBytes,
  readLocalePayloads,
  readManifestPrefixes,
  recordProvenance,
  type BundleBaseline,
  type LocalePayloads,
  type MeasuredChunk,
  type StartupMeasurement,
} from '../check-bundle-size'
import { minifyHangChecksum } from '../../apps/electron/src/renderer/perf/bundle-profile'

const ROOT = resolve(import.meta.dir, '..', '..')

const TEMP_DIRS: string[] = []
afterEach(() => {
  for (const dir of TEMP_DIRS.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'bundle-size-'))
  TEMP_DIRS.push(dir)
  return dir
}

/** A measured chunk for the same file names the build emits (hash suffix included). */
function chunk(file: string, rawBytes: number, gzipBytes = Math.floor(rawBytes / 4)): MeasuredChunk {
  const kind = assetKind(file)
  if (!kind) throw new Error(`not a measured asset: ${file}`)
  return { file, prefix: chunkPrefix(file), kind, rawBytes, gzipBytes }
}

/** A throwaway `apps/electron/dist/renderer` tree; `files` maps an asset name to its byte size. */
function seedBuild(root: string, files: Record<string, number>, withIndexHtml = true): void {
  const rendererDist = join(root, 'apps/electron/dist/renderer')
  mkdirSync(join(rendererDist, 'assets'), { recursive: true })
  if (withIndexHtml) writeFileSync(join(rendererDist, 'index.html'), '<!doctype html>')
  for (const [name, size] of Object.entries(files)) writeFileSync(join(rendererDist, 'assets', name), Buffer.alloc(size))
}

/**
 * A throwaway build manifest, in the shape `build.manifest: true` emits: keyed by the chunk's source
 * path, each entry carrying the emitted `file` and the Rollup chunk `name` (absent for emitted assets
 * such as CSS, which is why the gate keeps a regex fallback for them).
 */
function seedManifest(root: string, manifest: Record<string, Record<string, unknown>>): void {
  const dir = join(root, 'apps/electron/dist/renderer', MANIFEST_RELATIVE_PATH)
  mkdirSync(dirname(dir), { recursive: true })
  writeFileSync(dir, JSON.stringify(manifest, null, 2))
}

function seedBaseline(root: string, baseline: Partial<BundleBaseline>): void {
  mkdirSync(join(root, 'perf-baselines'), { recursive: true })
  writeFileSync(
    join(root, 'perf-baselines/bundle-size.json'),
    JSON.stringify({ description: 'test', ...baseline }),
  )
}

/** The baseline as recorded on disk, for the cases that assert what a write actually wrote. */
function readRecorded(root: string): BundleBaseline {
  return JSON.parse(readFileSync(join(root, 'perf-baselines/bundle-size.json'), 'utf8')) as BundleBaseline
}

/** A synthetic startup measurement for the pure gate, with one js file of `jsRawBytes`. */
function startupMeasurement(
  html: string,
  jsRawBytes: number,
  overrides: Partial<StartupMeasurement> = {},
): StartupMeasurement {
  return {
    html,
    jsRawBytes,
    gzipTotalBytes: Math.floor(jsRawBytes / 4),
    fileCount: jsRawBytes > 0 ? 1 : 0,
    cssRawBytes: 0,
    cssGzipBytes: 0,
    cssFileCount: 0,
    files: jsRawBytes > 0 ? [{ file: `assets/${html}.js`, kind: 'js', rawBytes: jsRawBytes, gzipBytes: 0 }] : [],
    missing: [],
    ...overrides,
  }
}

/** A throwaway renderer tree carrying one html file with the given markup and its `assets/` files. */
function seedStartupBuild(root: string, html: string, files: Record<string, number>) {
  const rendererDist = join(root, 'apps/electron/dist/renderer')
  mkdirSync(join(rendererDist, 'assets'), { recursive: true })
  writeFileSync(join(rendererDist, 'index.html'), html)
  for (const [name, size] of Object.entries(files)) writeFileSync(join(rendererDist, 'assets', name), Buffer.alloc(size))
}

function runCli(root: string, args: string[] = ['--check']) {
  const result = Bun.spawnSync(['bun', 'scripts/check-bundle-size.ts', ...args], {
    cwd: ROOT,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, ROX_BUNDLE_SIZE_ROOT: root },
  })
  return { code: result.exitCode, out: result.stdout.toString(), err: result.stderr.toString() }
}

describe('chunk-name prefix derivation (never the content hash)', () => {
  it('strips the 8-character hash suffix from real emitted names', () => {
    expect(chunkPrefix('index-B3-J8HY7.js')).toBe('index')
    expect(chunkPrefix('main-qrX9lp_n.js')).toBe('main')
    expect(chunkPrefix('project-authority-BDUHCR2T.js')).toBe('project-authority')
    expect(chunkPrefix('useTranslation-C3vs8uOy.js')).toBe('useTranslation')
    expect(chunkPrefix('vendor-react-abc12345.js')).toBe('vendor-react')
  })

  it('derives the same prefix for a CSS chunk (the extension is part of the stem)', () => {
    expect(chunkPrefix('main-BCWHcyRa.css')).toBe('main')
    expect(chunkPrefix('main.css')).toBe('main')
    expect(chunkPrefix('vendor-code-BCWHcyRa.css')).toBe('vendor-code')
  })

  it('leaves a name without an 8-character hash suffix untouched', () => {
    expect(chunkPrefix('chunk-abc.js')).toBe('chunk-abc')
  })
})

describe('measured assets (emitted *.js and *.css; never source maps or the pdf worker)', () => {
  it('drops *.js.map, *.css.map and pdf.worker.min-*.mjs from the fixture listing', () => {
    expect(assetKind('index-B3-J8HY7.js')).toBe('js')
    expect(assetKind('index-B3-J8HY7.js.map')).toBeUndefined()
    expect(assetKind('main-BCWHcyRa.css')).toBe('css')
    expect(assetKind('main-BCWHcyRa.css.map')).toBeUndefined()
    expect(assetKind('pdf.worker.min-qwK7q_zL.mjs')).toBeUndefined()

    const root = tempRoot()
    const assets = join(root, 'apps/electron/dist/renderer/assets')
    mkdirSync(assets, { recursive: true })
    for (const name of [
      'index-B3-J8HY7.js',
      'index-B3-J8HY7.js.map',
      'main-qrX9lp_n.js',
      'main-BCWHcyRa.css',
      'main-BCWHcyRa.css.map',
      'project-authority-BDUHCR2T.js',
      'useTranslation-C3vs8uOy.js',
      'vendor-react-abc12345.js',
      'pdf.worker.min-qwK7q_zL.mjs',
    ]) {
      writeFileSync(join(assets, name), Buffer.alloc(64))
    }

    const measured = measureRendererChunks(assets)
    expect(measured.map((chunk) => chunk.file)).toEqual([
      'index-B3-J8HY7.js',
      'main-BCWHcyRa.css',
      'main-qrX9lp_n.js',
      'project-authority-BDUHCR2T.js',
      'useTranslation-C3vs8uOy.js',
      'vendor-react-abc12345.js',
    ])
    expect(measured.map((chunk) => chunk.kind)).toEqual(['js', 'css', 'js', 'js', 'js', 'js'])
    expect(measured.some((entry) => entry.file.endsWith('.map') || entry.file.startsWith('pdf.worker'))).toBe(false)
    expect(measured.map((entry) => entry.prefix)).toEqual([
      'index',
      'main',
      'main',
      'project-authority',
      'useTranslation',
      'vendor-react',
    ])
  })
})

/**
 * The build already knows each chunk's real name — Vite writes it to `.vite/manifest.json` under
 * `build.manifest: true`. Reading that name replaces the `-<8-char hash>` guess, which silently
 * mis-keys (and so un-budgets) a chunk the moment Rollup's hash length or separator changes. The regex
 * stays as the fallback for a file the manifest does not cover: a stale dist, a fixture tree, or CSS
 * (Vite emits CSS as an asset with no `name`).
 */
describe('budget prefixes come from the build manifest, with the hash-suffix regex as fallback', () => {
  const dist = (root: string) => join(root, 'apps/electron/dist/renderer')

  it('maps each emitted file to the chunk name the build recorded', () => {
    const root = tempRoot()
    seedManifest(root, {
      'src/renderer/index.html': { file: 'assets/index-B3-J8HY7.js', name: 'index', src: 'src/renderer/index.html', isEntry: true },
      'src/renderer/main.tsx': { file: 'assets/main-qrX9lp_n.js', name: 'main', src: 'src/renderer/main.tsx' },
      'src/renderer/locale/ar.ts': { file: 'assets/ar-BZQWQe49.js', name: 'ar', isDynamicEntry: true },
    })
    const prefixes = readManifestPrefixes(dist(root))
    expect(prefixes.get('index-B3-J8HY7.js')).toBe('index')
    expect(prefixes.get('main-qrX9lp_n.js')).toBe('main')
    expect(prefixes.get('ar-BZQWQe49.js')).toBe('ar')
  })

  it('skips entries Vite emits as assets (no `name`), leaving them to the regex', () => {
    const root = tempRoot()
    seedManifest(root, {
      // CSS is emitted as an asset: `file` + `src`, no `name` to key a budget by.
      'src/renderer/index.css': { file: 'assets/index-Cj-Yxrsl.css', src: 'src/renderer/index.css' },
      // A truncated/odd entry must not throw either.
      'src/renderer/odd.ts': { name: 'odd' },
    })
    const prefixes = readManifestPrefixes(dist(root))
    expect(prefixes.has('index-Cj-Yxrsl.css')).toBe(false)
    expect(prefixes.size).toBe(0)
  })

  it('degrades to no mapping when the manifest is missing or malformed', () => {
    const missing = tempRoot()
    mkdirSync(dist(missing), { recursive: true })
    expect(readManifestPrefixes(dist(missing)).size).toBe(0)

    const malformed = tempRoot()
    mkdirSync(join(dist(malformed), '.vite'), { recursive: true })
    writeFileSync(join(dist(malformed), MANIFEST_RELATIVE_PATH), '{ not json')
    expect(readManifestPrefixes(dist(malformed)).size).toBe(0)
  })

  it('keys a chunk by the manifest name, and by the regex when the manifest does not cover it', () => {
    const root = tempRoot()
    const assets = join(dist(root), 'assets')
    mkdirSync(assets, { recursive: true })
    for (const name of ['index-B3-J8HY7.js', 'lazy-page-bbbbbbbb.js']) writeFileSync(join(assets, name), Buffer.alloc(64))
    seedManifest(root, { 'src/renderer/index.html': { file: 'assets/index-B3-J8HY7.js', name: 'index' } })

    const measured = measureRendererChunks(assets, readManifestPrefixes(dist(root)))
    expect(measured.map((entry) => [entry.file, entry.prefix])).toEqual([
      ['index-B3-J8HY7.js', 'index'],
      // Not in the manifest: the built-in fallback still names it.
      ['lazy-page-bbbbbbbb.js', 'lazy-page'],
    ])
  })

  it('fixes a chunk the hash-suffix regex would mis-key, without changing today`s keys', () => {
    const root = tempRoot()
    const assets = join(dist(root), 'assets')
    mkdirSync(assets, { recursive: true })
    // A 10-character hash: the `-<8-char hash>` guess cannot strip it and leaves the name untouched.
    const file = 'index-D3f4gH5jK6.js'
    writeFileSync(join(assets, file), Buffer.alloc(64))
    expect(chunkPrefix(file)).toBe('index-D3f4gH5jK6')
    seedManifest(root, { 'src/renderer/index.html': { file: `assets/${file}`, name: 'index' } })

    const [measured] = measureRendererChunks(assets, readManifestPrefixes(dist(root)))
    expect(measured!.prefix).toBe('index')
    // An 8-character hash — today's shape — keys the same either way, so the baselines do not move.
    expect(chunkPrefix('index-B3-J8HY7.js')).toBe('index')
  })

  it('CLI: a manifest name keeps a grown prefix budgeted where the regex silently un-budgets it', () => {
    // Two chunks whose names the regex only partly recovers: one 10-char hash (mis-keyed), one 8-char
    // (correct). Together they are over the recorded `index` budget; split across two prefixes, each
    // stays under the 2.5 MB ceiling.
    const files = { 'index-D3f4gH5jK6.js': 200_000, 'index-B3-J8HY7.js': 200_000 }
    const baseline = { budgets: { index: { totalRawBytes: 330_000, gzipTotalBytes: 1 } } }

    const withManifest = tempRoot()
    seedBuild(withManifest, files)
    seedManifest(withManifest, {
      'src/renderer/a.tsx': { file: 'assets/index-D3f4gH5jK6.js', name: 'index' },
      'src/renderer/b.tsx': { file: 'assets/index-B3-J8HY7.js', name: 'index' },
    })
    seedBaseline(withManifest, baseline)
    const gated = runCli(withManifest)
    expect(gated.code).toBe(1)
    expect(gated.err).toContain("js prefix 'index' total is 400000 B, budget 330000 B")

    // Without a manifest the 10-char-hash chunk becomes a brand-new unbudgeted prefix, so the same
    // growth that should have failed the `index` budget slips through on the 2.5 MB ceiling alone.
    const blind = tempRoot()
    seedBuild(blind, files)
    seedBaseline(blind, baseline)
    expect(runCli(blind).code).toBe(0)
  })

  it('CLI: --print keys by the manifest, so a printed baseline carries today`s names', () => {
    const root = tempRoot()
    seedBuild(root, { 'index-D3f4gH5jK6.js': 300_000 })
    seedManifest(root, { 'src/renderer/index.html': { file: 'assets/index-D3f4gH5jK6.js', name: 'index' } })
    const out = join(root, 'printed.json')
    expect(runCli(root, ['--print', out]).code).toBe(0)
    const written = JSON.parse(readFileSync(out, 'utf8')) as BundleBaseline
    expect(Object.keys(written.budgets)).toEqual(['index'])
  })
})

describe('sourcemap pointer comment is not gated payload (the CI build emits it)', () => {
  // The CI job builds the renderer with ROX_RENDERER_SOURCEMAP=1, so every emitted chunk ends with
  // this pointer to a sibling `.map` the gate never measures. It must not count as shipped bytes.
  const PAYLOAD = 'export const answer = 42;\n'
  const pointer = (name: string) => `\n//# sourceMappingURL=${name}.map\n`

  it('measures an assets/*.js chunk as its payload, not payload + the //# sourceMappingURL= line', () => {
    const root = tempRoot()
    const assets = join(root, 'apps/electron/dist/renderer/assets')
    mkdirSync(assets, { recursive: true })
    const name = 'main-aaaaaaaa.js'
    writeFileSync(join(assets, name), PAYLOAD + pointer(name))

    const [measured] = measureRendererChunks(assets)
    expect(measured!.file).toBe(name)
    expect(measured!.rawBytes).toBe(Buffer.byteLength(PAYLOAD))
    expect(measured!.rawBytes).toBeLessThan(Buffer.byteLength(PAYLOAD + pointer(name)))
    // gzip is computed over the stripped buffer too, so raw and gzip stay comparable.
    expect(measured!.gzipBytes).toBe(gzipSync(Buffer.from(PAYLOAD), { level: 9 }).length)
  })

  it('strips the pointer from a startup-closure file as well', () => {
    const root = tempRoot()
    const rendererDist = join(root, 'apps/electron/dist/renderer')
    const name = 'main-bbbbbbbb.js'
    mkdirSync(join(rendererDist, 'assets'), { recursive: true })
    writeFileSync(join(rendererDist, 'index.html'), `<script type="module" src="./assets/${name}"></script>`)
    writeFileSync(join(rendererDist, 'assets', name), PAYLOAD + pointer(name))

    const [measured] = measureStartup(rendererDist)
    expect(measured!.jsRawBytes).toBe(Buffer.byteLength(PAYLOAD))
    expect(measured!.gzipTotalBytes).toBe(gzipSync(Buffer.from(PAYLOAD), { level: 9 }).length)
  })

  it('leaves a payload that only mentions sourceMappingURL mid-file untouched', () => {
    const root = tempRoot()
    const assets = join(root, 'apps/electron/dist/renderer/assets')
    mkdirSync(assets, { recursive: true })
    const body = 'const s = "//# sourceMappingURL=nope"\nconsole.log(s)\n'
    writeFileSync(join(assets, 'main-cccccccc.js'), body)

    const [measured] = measureRendererChunks(assets)
    expect(measured!.rawBytes).toBe(Buffer.byteLength(body))
  })
})

describe('budget recording (prefix TOTALS, floor applies to the total)', () => {
  it('records the summed total of every chunk of a prefix once it reaches the floor', () => {
    const chunks = [
      chunk('index-aaaaaaaa.js', 1_300_000, 400_000),
      chunk('index-bbbbbbbb.js', 1_500_000, 450_000),
      chunk('index-cccccccc.js', 25_000, 8000),
      chunk('shiki-small-aaaaaaaa.js', MIN_BUDGET_BYTES - 1, 3),
    ]
    // 1,300,000 + 1,500,000 + 25,000 — not just the 1,500,000 largest chunk.
    expect(buildBudgets(chunks, 'js')).toEqual({
      index: { totalRawBytes: 2_825_000, gzipTotalBytes: 858_000 },
    })
  })

  it('omits a prefix whose TOTAL is below MIN_BUDGET_BYTES', () => {
    const chunks = [
      chunk('index-aaaaaaaa.js', MIN_BUDGET_BYTES - 2, 5),
      chunk('index-bbbbbbbb.js', 1, 1),
    ]
    expect(buildBudgets(chunks, 'js')).toEqual({})
  })

  it('keeps CSS budgets in their own map so a shared prefix never collides', () => {
    const chunks = [chunk('index-aaaaaaaa.js', 300_000), chunk('index-aaaaaaaa.css', 400_000)]
    expect(buildBudgets(chunks, 'js')).toEqual({ index: { totalRawBytes: 300_000, gzipTotalBytes: 75_000 } })
    expect(buildBudgets(chunks, 'css')).toEqual({ index: { totalRawBytes: 400_000, gzipTotalBytes: 100_000 } })
  })

  it('sums whole-extension totals for raw and gzip bytes', () => {
    expect(
      bundleTotals([
        chunk('a-aaaaaaaa.js', 100, 40),
        chunk('b-aaaaaaaa.js', 200, 70),
        chunk('a-aaaaaaaa.css', 50, 10),
      ]),
    ).toEqual({ jsRawBytes: 300, jsGzipBytes: 110, cssRawBytes: 50, cssGzipBytes: 10 })
  })
})

describe('budget evaluation (pure)', () => {
  it('fails the TOTAL gate when a small sibling grows while staying under the largest chunk', () => {
    const recorded = { budgets: { index: { totalRawBytes: 1_525_000, gzipTotalBytes: 500_000 } } }
    const failures = evaluateAssets(
      [chunk('index-bigggggg.js', 1_500_000), chunk('index-smolllll.js', 1_400_000)],
      recorded,
    )
    // The bypass that motivated the change: the old gate compared each chunk to the recorded 1,500,000 B
    // max, so the grown 1,400,000 B sibling passed. The summed total does not.
    expect(failures).toEqual([
      {
        kind: 'js',
        prefix: 'index',
        rawBytes: 2_900_000,
        budget: 1_525_000,
        file: 'index-bigggggg.js',
        fileRawBytes: 1_500_000,
      },
    ])
    const line = formatFailure(failures[0]!)
    expect(line).toContain("js prefix 'index' total is 2900000 B, budget 1525000 B (+1375000 B)")
    expect(line).toContain('largest chunk assets/index-bigggggg.js is 1500000 B')
    expect(line).not.toContain('\n')
  })

  it('fails an unbudgeted prefix whose TOTAL is above the ceiling, and passes at the ceiling', () => {
    const below = [chunk('heavy-aaaaaaaa.js', 1_300_000), chunk('heavy-bbbbbbbb.js', 1_200_000)]
    expect(evaluateAssets(below, {})).toEqual([])

    const over = budgetSlackBytes(MAX_NEW_CHUNK_BYTES) + 1
    const failures = evaluateAssets(
      [chunk('heavy-aaaaaaaa.js', 1_300_000), chunk('heavy-bbbbbbbb.js', 1_200_000 + over)],
      {},
    )
    expect(failures).toEqual([
      {
        kind: 'js',
        prefix: 'heavy',
        rawBytes: MAX_NEW_CHUNK_BYTES + over,
        budget: MAX_NEW_CHUNK_BYTES,
        // The reported largest chunk is whichever is biggest, not the one that grew.
        file: 'heavy-aaaaaaaa.js',
        fileRawBytes: 1_300_000,
      },
    ])
    expect(formatFailure(failures[0]!)).toContain(
      `js prefix 'heavy' total is ${MAX_NEW_CHUNK_BYTES + over} B, budget ${MAX_NEW_CHUNK_BYTES} B`,
    )
  })

  it('fails a CSS prefix total regression and a whole-CSS total regression', () => {
    const recorded = {
      stylesheets: { main: { totalRawBytes: 100_000, gzipTotalBytes: 20_000 } },
      totals: { cssRawBytes: 100_000 },
    }
    const grown = 100_000 + budgetSlackBytes(100_000) + 1
    const failures = evaluateAssets([chunk('main-aaaaaaaa.css', grown)], recorded)
    expect(failures).toEqual([
      {
        kind: 'css',
        prefix: 'main',
        rawBytes: grown,
        budget: 100_000,
        file: 'main-aaaaaaaa.css',
        fileRawBytes: grown,
      },
      {
        kind: 'css',
        prefix: null,
        rawBytes: grown,
        budget: 100_000,
        file: 'main-aaaaaaaa.css',
        fileRawBytes: grown,
      },
    ])
    expect(formatFailure(failures[1]!)).toContain(`css bundle total is ${grown} B, budget 100000 B`)
  })

  it('allows within-slack prefix totals but fails one byte beyond', () => {
    const recorded = { budgets: { main: { totalRawBytes: 1000, gzipTotalBytes: 500 } } }
    const within = [chunk('main-aaaaaaaa.js', 600), chunk('main-bbbbbbbb.js', 400 + budgetSlackBytes(1000))]
    expect(evaluateAssets(within, recorded)).toEqual([])

    const beyond = [chunk('main-aaaaaaaa.js', 600), chunk('main-bbbbbbbb.js', 401 + budgetSlackBytes(1000))]
    expect(evaluateAssets(beyond, recorded)).toHaveLength(1)
  })

  it('allows within-slack bundle totals but fails one byte beyond, leaving slack-free prefixes alone', () => {
    const recorded = { budgets: { main: { totalRawBytes: 1_000_000, gzipTotalBytes: 1 } }, totals: { jsRawBytes: 1000 } }
    expect(evaluateAssets([chunk('main-aaaaaaaa.js', 1000 + budgetSlackBytes(1000))], recorded)).toEqual([])

    const failures = evaluateAssets([chunk('main-aaaaaaaa.js', 1001 + budgetSlackBytes(1000))], recorded)
    expect(failures).toEqual([
      {
        kind: 'js',
        prefix: null,
        rawBytes: 1001 + budgetSlackBytes(1000),
        budget: 1000,
        file: 'main-aaaaaaaa.js',
        fileRawBytes: 1001 + budgetSlackBytes(1000),
      },
    ])
  })
})

describe('CLI exit codes', () => {
  it('exits 0 when every js/css asset total is within budget', () => {
    const root = tempRoot()
    seedBuild(root, {
      'main-qrX9lp_n.js': 800,
      'index-B3-J8HY7.js': 1200,
      'main-BCWHcyRa.css': 400,
    })
    seedBaseline(root, {
      budgets: {
        main: { totalRawBytes: 1000, gzipTotalBytes: 500 },
        index: { totalRawBytes: 2000, gzipTotalBytes: 900 },
      },
      stylesheets: { main: { totalRawBytes: 500, gzipTotalBytes: 100 } },
      totals: { jsRawBytes: 2000, jsGzipBytes: 10, cssRawBytes: 500, cssGzipBytes: 10 },
    })
    const result = runCli(root)
    expect(result.code).toBe(0)
    expect(result.err).not.toContain('bundle-size: ')
    expect(result.out).toContain('prefix')
    expect(result.out).toContain('main')
    expect(result.out).toContain('js total')
    expect(result.out).toContain('css total')
  })

  it('exits 1 when a budgeted prefix TOTAL is over budget, naming the prefix and its largest chunk', () => {
    const root = tempRoot()
    seedBuild(root, { 'main-aaaaaaaa.js': 1_300_000, 'main-bbbbbbbb.js': 1_200_000 })
    seedBaseline(root, { budgets: { main: { totalRawBytes: 1_500_000, gzipTotalBytes: 500 } } })
    const result = runCli(root)
    expect(result.code).toBe(1)
    expect(result.err).toContain("js prefix 'main' total is 2500000 B, budget 1500000 B")
    expect(result.err).toContain('assets/main-aaaaaaaa.js')
    expect(result.err).toContain('is 1300000 B')
    expect(result.err).toContain('bun scripts/check-bundle-size.ts --update')
  })

  it('exits 1 when an unbudgeted prefix TOTAL exceeds the 2.5 MB ceiling', () => {
    const root = tempRoot()
    const over = budgetSlackBytes(MAX_NEW_CHUNK_BYTES) + 1
    seedBuild(root, { 'lazy-page-aaaaaaaa.js': 1_300_000, 'lazy-page-bbbbbbbb.js': 1_200_000 + over })
    seedBaseline(root, { budgets: {} })
    const result = runCli(root)
    expect(result.code).toBe(1)
    expect(result.err).toContain(`js prefix 'lazy-page' total is ${MAX_NEW_CHUNK_BYTES + over} B, budget ${MAX_NEW_CHUNK_BYTES} B`)
    expect(result.err).toContain('assets/lazy-page-aaaaaaaa.js')
    expect(result.err).toContain('is 1300000 B')
  })

  it('exits 1 when the whole-js total regresses even though each prefix is within its budget', () => {
    const root = tempRoot()
    // Must clear the slack floor to trip the gate: budget + slack + 1, not a nominal 10 KB.
    const over = 1000 + budgetSlackBytes(1000) + 1
    seedBuild(root, { 'main-aaaaaaaa.js': over })
    seedBaseline(root, {
      budgets: { main: { totalRawBytes: over, gzipTotalBytes: 500 } },
      totals: { jsRawBytes: 1000, jsGzipBytes: 1 },
    })
    const result = runCli(root)
    expect(result.code).toBe(1)
    expect(result.err).toContain(`js bundle total is ${over} B, budget 1000 B`)
    expect(result.err).toContain('assets/main-aaaaaaaa.js')
    expect(result.err).not.toContain("prefix 'main'")
  })

  it('exits 1 when a CSS prefix total regresses', () => {
    const root = tempRoot()
    const over = 1000 + budgetSlackBytes(1000) + 1
    seedBuild(root, { 'main-aaaaaaaa.css': over })
    seedBaseline(root, { stylesheets: { main: { totalRawBytes: 1000, gzipTotalBytes: 100 } } })
    const result = runCli(root)
    expect(result.code).toBe(1)
    expect(result.err).toContain(`css prefix 'main' total is ${over} B, budget 1000 B`)
    expect(result.err).toContain('assets/main-aaaaaaaa.css')
  })

  it('fails closed with the exact message when there is no renderer build', () => {
    const root = tempRoot()
    const result = runCli(root)
    expect(result.code).toBe(1)
    expect(result.err).toContain('no renderer build found - run bun run electron:build:renderer first')
  })
})

describe('startup closure parsing (script src + modulepreload + style preload)', () => {
  it('collects js from <script src> and modulepreload, css from preload-as-style, ignoring inline scripts', () => {
    const refs = parseHtmlReferences(
      [
        '<!doctype html><html><head>',
        '<script type="module" crossorigin src="./assets/main-aaaaaaaa.js"></script>',
        '<link rel="modulepreload" crossorigin href="./assets/vendor-react-bbbbbbbb.js">',
        '<link rel="preload" as="style" crossorigin href="./assets/main-cccccccc.css">',
        '<link rel="modulepreload" href="./assets/main-aaaaaaaa.js">',
        '<link rel="icon" href="./favicon.ico">',
        '</head><body><script>window.inline = 1</script></body></html>',
      ].join('\n'),
    )
    expect(refs.js).toEqual([
      './assets/main-aaaaaaaa.js',
      './assets/vendor-react-bbbbbbbb.js',
      './assets/main-aaaaaaaa.js',
    ])
    expect(refs.css).toEqual(['./assets/main-cccccccc.css'])
  })

  it('resolves ./assets hrefs relative to the html file and counts a duplicate reference once', () => {
    const root = tempRoot()
    const rendererDist = join(root, 'apps/electron/dist/renderer')
    seedStartupBuild(
      root,
      [
        '<script type="module" src="./assets/main-aaaaaaaa.js"></script>',
        '<link rel="modulepreload" href="./assets/vendor-react-bbbbbbbb.js">',
        '<link rel="modulepreload" href="./assets/main-aaaaaaaa.js">',
        '<link rel="preload" as="style" href="./assets/main-cccccccc.css">',
      ].join('\n'),
      { 'main-aaaaaaaa.js': 1200, 'vendor-react-bbbbbbbb.js': 800, 'main-cccccccc.css': 300 },
    )

    const [measured] = measureStartup(rendererDist)!
    expect(measured!.html).toBe('index.html')
    // 1200 + 800 — the twice-referenced main chunk counts once.
    expect(measured!.jsRawBytes).toBe(2000)
    expect(measured!.fileCount).toBe(2)
    expect(measured!.cssRawBytes).toBe(300)
    expect(measured!.cssFileCount).toBe(1)
    expect(measured!.missing).toEqual([])
    expect(measured!.gzipTotalBytes).toBeGreaterThan(0)
    expect(measured!.gzipTotalBytes).toBeLessThan(measured!.jsRawBytes)
  })

  it('reports a referenced file missing from the build instead of counting it as 0', () => {
    const root = tempRoot()
    const rendererDist = join(root, 'apps/electron/dist/renderer')
    seedStartupBuild(
      root,
      [
        '<script type="module" src="./assets/main-aaaaaaaa.js"></script>',
        '<link rel="modulepreload" href="./assets/gone-bbbbbbbb.js">',
      ].join('\n'),
      { 'main-aaaaaaaa.js': 1200 },
    )

    const [measured] = measureStartup(rendererDist)!
    expect(measured!.jsRawBytes).toBe(1200)
    expect(measured!.missing).toEqual(['assets/gone-bbbbbbbb.js'])

    const failures = evaluateStartup([measured!], {})
    expect(failures).toHaveLength(1)
    expect(failures[0]!.missing).toEqual(['assets/gone-bbbbbbbb.js'])
    expect(formatStartupFailure(failures[0]!)).toContain('references 1 file(s) missing from the build')
  })
})

describe('startup gate (pure)', () => {
  it('fails when the measured closure exceeds the recorded budget beyond slack', () => {
    const recorded = { 'index.html': { jsRawBytes: 1000, gzipTotalBytes: 10, fileCount: 1 } }
    expect(evaluateStartup([startupMeasurement('index.html', 1000 + budgetSlackBytes(1000))], recorded)).toEqual([])

    const failures = evaluateStartup([startupMeasurement('index.html', 1000 + budgetSlackBytes(1000) + 1)], recorded)
    expect(failures).toHaveLength(1)
    expect(failures[0]).toMatchObject({ html: 'index.html', jsRawBytes: 1001 + budgetSlackBytes(1000), budget: 1000, unbudgeted: false, overBudget: true })
    const line = formatStartupFailure(failures[0]!)
    expect(line).toContain(`startup: index.html static JS closure is ${1001 + budgetSlackBytes(1000)} B, budget 1000 B`)
    expect(line).toContain('heaviest referenced files for index.html')
  })

  it('gates an html file with no recorded entry against MAX_NEW_STARTUP_BYTES', () => {
    expect(evaluateStartup([startupMeasurement('new.html', MAX_NEW_STARTUP_BYTES)], {})).toEqual([])

    const failures = evaluateStartup(
      [startupMeasurement('new.html', MAX_NEW_STARTUP_BYTES + budgetSlackBytes(MAX_NEW_STARTUP_BYTES) + 1)],
      {},
    )
    expect(failures).toHaveLength(1)
    expect(failures[0]).toMatchObject({ html: 'new.html', budget: MAX_NEW_STARTUP_BYTES, unbudgeted: true, overBudget: true })
    expect(formatStartupFailure(failures[0]!)).toContain(`ceiling ${MAX_NEW_STARTUP_BYTES} B (unbudgeted entry page)`)
  })

  it('passes a fully budgeted closure that stays within slack', () => {
    const recorded = { 'index.html': { jsRawBytes: 2000, gzipTotalBytes: 20, fileCount: 2 } }
    expect(evaluateStartup([startupMeasurement('index.html', 2000)], recorded)).toEqual([])
  })
})

describe('startup gate (CLI)', () => {
  it('records the startup section for every html file and passes when within budget', () => {
    const root = tempRoot()
    seedStartupBuild(
      root,
      '<script type="module" src="./assets/main-aaaaaaaa.js"></script>',
      { 'main-aaaaaaaa.js': 1000 },
    )
    seedBaseline(root, {
      budgets: { main: { totalRawBytes: 2000, gzipTotalBytes: 1 } },
      startup: { 'index.html': { jsRawBytes: 1000, gzipTotalBytes: 10, fileCount: 1 } },
    })
    const result = runCli(root)
    expect(result.code).toBe(0)
    expect(result.out).toContain('startup: 1 entry page(s) measured')
    expect(result.out).toContain('index.html')
    expect(result.out).toContain('1000')
  })

  it('exits 1 and prints the top referenced files when an entry closure regresses', () => {
    const root = tempRoot()
    // The closure must clear the recorded budget's slack floor to trip the gate. `main` carries the
    // regression and stays the heaviest file, so it must stay below the recorded 1000 B plus that
    // floor — the remainder lands in `vendor`.
    const main = 3000
    const vendor = 1000 + budgetSlackBytes(1000) + 1 - main
    seedStartupBuild(
      root,
      [
        '<script type="module" src="./assets/main-aaaaaaaa.js"></script>',
        '<link rel="modulepreload" href="./assets/vendor-bbbbbbbb.js">',
      ].join('\n'),
      { 'main-aaaaaaaa.js': main, 'vendor-bbbbbbbb.js': vendor },
    )
    seedBaseline(root, { budgets: {}, startup: { 'index.html': { jsRawBytes: 1000, gzipTotalBytes: 10, fileCount: 1 } } })
    const result = runCli(root)
    expect(result.code).toBe(1)
    expect(result.err).toContain(`startup: index.html static JS closure is ${main + vendor} B, budget 1000 B`)
    expect(result.err).toContain('heaviest referenced files for index.html')
    expect(result.err).toContain(`assets/main-aaaaaaaa.js: ${main} B`)
  })

  it('exits 1 when a referenced startup file is missing from the build', () => {
    const root = tempRoot()
    seedStartupBuild(
      root,
      [
        '<script type="module" src="./assets/main-aaaaaaaa.js"></script>',
        '<link rel="modulepreload" href="./assets/gone-bbbbbbbb.js">',
      ].join('\n'),
      { 'main-aaaaaaaa.js': 1000 },
    )
    seedBaseline(root, { budgets: {} })
    const result = runCli(root)
    expect(result.code).toBe(1)
    expect(result.err).toContain('missing from the build')
    expect(result.err).toContain('assets/gone-bbbbbbbb.js')
  })

  it('behaves exactly as before when the baseline has no startup section', () => {
    const root = tempRoot()
    seedBuild(root, { 'main-aaaaaaaa.js': 1000 })
    seedBaseline(root, { budgets: { main: { totalRawBytes: 2000, gzipTotalBytes: 1 } } })
    const result = runCli(root)
    expect(result.code).toBe(0)
    // The empty index.html closure is unbudgeted and well under the ceiling.
    expect(result.out).toContain('index.html')
    expect(result.out).toContain('unbudgeted')
  })
})

describe('minify profile closed form', () => {
  /** The pre-change implementation, verbatim, as the equivalence oracle. */
  function minifyHangOracle(sourceChars: number, iterations: number): number {
    let checksum = 0
    const sample = 'function x(){return 1}'
    for (let i = 0; i < iterations; i++) {
      for (let j = 0; j < Math.min(sourceChars, 50_000); j++) {
        checksum = (checksum + sample.charCodeAt(j % sample.length) + i) | 0
      }
    }
    return checksum
  }

  it('matches the per-character oracle for several sourceChars/iterations pairs', () => {
    for (const [sourceChars, iterations] of [
      [2000, 2],
      [12345, 8],
      [50000, 3],
      [90000, 4],
      [0, 5],
    ] as const) {
      expect(minifyHangChecksum(sourceChars, iterations)).toBe(minifyHangOracle(sourceChars, iterations))
    }
  })
})

describe('--update delta report (an acceptance has to stay readable afterwards)', () => {
  type Next = Pick<BundleBaseline, 'budgets' | 'stylesheets' | 'totals' | 'startup'>
  const zeros = { jsRawBytes: 0, jsGzipBytes: 0, cssRawBytes: 0, cssGzipBytes: 0 }
  const previous = (over: Partial<BundleBaseline> = {}): BundleBaseline => ({
    description: 'fixture', budgets: {}, stylesheets: {}, totals: zeros, startup: {}, ...over,
  })
  const next = (over: Partial<Next> = {}): Next => ({
    budgets: {}, stylesheets: {}, totals: zeros, startup: {}, ...over,
  })
  const entry = (jsRawBytes: number, fileCount: number) => ({ jsRawBytes, gzipTotalBytes: 0, fileCount })

  it('says so when there is no committed baseline to compare against', () => {
    expect(formatUpdateDelta(undefined, next())).toEqual([
      'bundle-size: no committed baseline to compare against; this is a first recording',
    ])
  })

  it('reports a quiet re-record as such, instead of printing an empty list', () => {
    expect(formatUpdateDelta(previous(), next())).toEqual(['  (nothing moved)'])
  })

  it('shows the sign of each byte movement', () => {
    const lines = formatUpdateDelta(
      previous({ totals: { ...zeros, jsRawBytes: 1000 }, budgets: { ru: { totalRawBytes: 500, gzipTotalBytes: 0 } } }),
      next({ totals: { ...zeros, jsRawBytes: 250 }, budgets: { ru: { totalRawBytes: 900, gzipTotalBytes: 0 } } }),
    )
    expect(lines).toContain('  js  total: 1000 → 250 B  (-750)')
    expect(lines).toContain('  js  ru: 500 → 900 B  (+400)')
  })

  it('omits prefixes that did not move, so the report stays readable', () => {
    const unchanged = { totalRawBytes: 700, gzipTotalBytes: 0 }
    const lines = formatUpdateDelta(
      previous({ budgets: { a: unchanged, b: unchanged } }),
      next({ budgets: { a: unchanged, b: unchanged } }),
    )
    expect(lines).toEqual(['  (nothing moved)'])
  })

  it('names a prefix that is new in this recording', () => {
    const lines = formatUpdateDelta(previous(), next({ budgets: { fresh: { totalRawBytes: 42, gzipTotalBytes: 0 } } }))
    expect(lines).toContain('  js  fresh: new, 42 B')
  })

  // The one shape a re-record must never bury: bytes alone cannot show it, because a page can shrink
  // while pulling in more files.
  it('flags an entry page whose static closure gained files', () => {
    const lines = formatUpdateDelta(
      previous({ startup: { 'index.html': entry(1000, 51) } }),
      next({ startup: { 'index.html': entry(900, 53) } }),
    )
    expect(lines).toContain('  startup index.html: 1000 → 900 B  (-100), 51 → 53 file(s)')
    expect(lines.at(-1)).toContain('! static closure gained file(s): index.html (51 → 53)')
  })

  it('reports a shrinking closure without the warning', () => {
    const lines = formatUpdateDelta(
      previous({ startup: { 'index.html': entry(2663738, 53) } }),
      next({ startup: { 'index.html': entry(2563903, 51) } }),
    )
    expect(lines).toContain('  startup index.html: 2663738 → 2563903 B  (-99835), 53 → 51 file(s)')
    expect(lines.some((line) => line.includes('!'))).toBe(false)
  })

  it('reports a byte-only page move without the file-count clause', () => {
    const lines = formatUpdateDelta(
      previous({ startup: { 'playground.html': entry(100, 211) } }),
      next({ startup: { 'playground.html': entry(150, 211) } }),
    )
    expect(lines).toEqual(['  startup playground.html: 100 → 150 B  (+50)'])
  })
})

/**
 * The renderer emits one entry chunk per locale and each embeds its own i18n payload, so before this
 * split every translation merge moved twelve code budgets plus the js total and ended in a re-record
 * (#2031, #2063, #2104, #2120). These cases pin the contract that replaces it.
 */
describe('i18n payload is budgeted apart from the code it rides with', () => {
  const LOCALES = join('packages', 'shared', 'src', 'i18n', 'locales')

  function seedLocales(root: string, sizes: Record<string, number>): void {
    mkdirSync(join(root, LOCALES), { recursive: true })
    for (const [locale, size] of Object.entries(sizes)) {
      writeFileSync(join(root, LOCALES, `${locale}.json`), Buffer.alloc(size))
    }
  }

  const payloads = (byLocale: Record<string, number>): LocalePayloads => ({
    byLocale,
    totalRawBytes: Object.values(byLocale).reduce((sum, size) => sum + size, 0),
  })

  it('reads one payload per locale JSON, ignoring other files in the directory', () => {
    const root = tempRoot()
    seedLocales(root, { ru: 1000, de: 2000 })
    writeFileSync(join(root, LOCALES, 'README.md'), 'not a payload')
    expect(readLocalePayloads(root)).toEqual({ byLocale: { de: 2000, ru: 1000 }, totalRawBytes: 3000 })
  })

  it('treats a tree with no locale files (a throwaway fixture build) as no payload at all', () => {
    expect(readLocalePayloads(tempRoot())).toEqual({ byLocale: {}, totalRawBytes: 0 })
  })

  it('records code bytes for a locale prefix and leaves every other prefix on its raw total', () => {
    const chunks = [chunk('ru-9gJEvcUc.js', 900_000), chunk('main-uOHJX_ma.js', 300_000)]
    const budgets = buildBudgets(chunks, 'js', payloads({ ru: 700_000 }))
    expect(budgets.ru).toEqual({ totalRawBytes: 900_000, gzipTotalBytes: 225_000, codeRawBytes: 200_000 })
    expect(budgets.main?.codeRawBytes).toBeUndefined()
    expect(bundleTotals(chunks, payloads({ ru: 700_000 })).jsCodeRawBytes).toBe(500_000)
  })

  it('does not read a translation-only merge as a regression — the whole point of the split', () => {
    const before = payloads({ ru: 700_000, de: 700_000 })
    // A feature merge adds ~9 KB of keys to every locale: both the payload source and the entry
    // chunks that embed it grow, the code does not.
    const after = payloads({ ru: 709_234, de: 709_234 })
    const recordedChunks = [chunk('ru-9gJEvcUc.js', 900_000), chunk('de-Dp4A7dEn.js', 900_000), chunk('main-uOHJX_ma.js', 400_000)]
    const grownChunks = [chunk('ru-9gJEvcUc.js', 909_234), chunk('de-Dp4A7dEn.js', 909_234), chunk('main-uOHJX_ma.js', 400_000)]
    const failures = evaluateAssets(grownChunks, {
      budgets: buildBudgets(recordedChunks, 'js', before),
      totals: bundleTotals(recordedChunks, before),
      i18n: before,
    }, after)
    expect(failures).toEqual([])
  })

  it('still fails the locale prefix whose code grows with the payload held constant', () => {
    const payload = payloads({ ru: 700_000 })
    const recorded = [chunk('ru-9gJEvcUc.js', 900_000)]
    const grown = [chunk('ru-9gJEvcUc.js', 960_000)]
    const failures = evaluateAssets(grown, {
      budgets: buildBudgets(recorded, 'js', payload),
      totals: bundleTotals(recorded, payload),
      i18n: payload,
    }, payload)
    const prefixFailure = failures.find((failure) => failure.prefix === 'ru')
    expect(prefixFailure?.rawBytes).toBe(260_000)
    expect(prefixFailure?.budget).toBe(200_000)
    // The js total carries the same growth, so it reports too.
    expect(failures.some((failure) => failure.prefix === null)).toBe(true)
  })

  it('fails a runaway payload that the slack cannot absorb, naming it as the payload', () => {
    const before = payloads({ ru: 700_000 })
    const runaway = payloads({ ru: 1_500_000 })
    const recorded = [chunk('ru-9gJEvcUc.js', 900_000)]
    const grown = [chunk('ru-9gJEvcUc.js', 1_700_000)]
    const failures = evaluateAssets(grown, {
      budgets: buildBudgets(recorded, 'js', before),
      totals: bundleTotals(recorded, before),
      i18n: before,
    }, runaway)
    expect(failures.map((failure) => failure.label)).toEqual(['i18n payload total'])
    expect(failures[0]?.rawBytes).toBe(1_500_000)
    expect(failures[0]?.budget).toBe(700_000)
    expect(formatFailure(failures[0]!)).toContain('i18n payload total is 1500000 B')
    expect(payloadSlackBytes(700_000)).toBeLessThan(1_500_000 - 700_000)
  })

  it('keeps the legacy contract for a baseline recorded before the split', () => {
    const payload = payloads({ ru: 700_000 })
    const recorded = [chunk('ru-9gJEvcUc.js', 900_000)]
    // No `codeRawBytes` / `jsCodeRawBytes` / `i18n`: the raw totals are gated exactly as before.
    const legacy = {
      budgets: { ru: { totalRawBytes: 900_000, gzipTotalBytes: 225_000 } },
      totals: { jsRawBytes: 900_000 },
    }
    expect(evaluateAssets(recorded, legacy, payload)).toEqual([])
    const failures = evaluateAssets([chunk('ru-9gJEvcUc.js', 990_000)], legacy, payload)
    expect(failures[0]?.prefix).toBe('ru')
    expect(failures[0]?.rawBytes).toBe(990_000)
  })

  it('CLI: a payload-only growth stays green, the same growth in code goes red', () => {
    const root = tempRoot()
    seedLocales(root, { ru: 700_000 })
    seedBuild(root, { 'ru-9gJEvcUc.js': 900_000, 'main-uOHJX_ma.js': 300_000 })
    expect(runCli(root, ['--update']).code).toBe(0)
    expect(runCli(root, ['--check']).code).toBe(0)

    // The translation merge: source and embedded copy both grow, the code does not.
    seedLocales(root, { ru: 709_234 })
    seedBuild(root, { 'ru-9gJEvcUc.js': 909_234, 'main-uOHJX_ma.js': 300_000 })
    const translated = runCli(root, ['--check'])
    expect(translated.code).toBe(0)

    // The code merge: the entry grows with the payload held constant.
    seedBuild(root, { 'ru-9gJEvcUc.js': 960_000, 'main-uOHJX_ma.js': 300_000 })
    const code = runCli(root, ['--check'])
    expect(code.code).toBe(1)
    expect(code.err).toContain("js prefix 'ru'")
    expect(code.err).toContain('budget 200000 B')
  })
})

/**
 * Slack is a fraction of the budget floored at the historical 4 KiB. A constant allowance does not
 * scale: 4 KiB is 0.012% of the ~36.7 MB js total, tighter than the same source reproduces across
 * platforms, while the fraction is 0.05% of it. The floor is what keeps small chunks where they were.
 */
describe('proportional slack (0.05% of the budget, floored at 4 KiB)', () => {
  it('floors small budgets at the historical 4 KiB, so no prefix is gated more loosely than before', () => {
    expect(budgetSlackBytes(0)).toBe(BUDGET_SLACK_MIN_BYTES)
    expect(budgetSlackBytes(MIN_BUDGET_BYTES)).toBe(BUDGET_SLACK_MIN_BYTES)
    // The heaviest js prefix (2.3 MB) and the heaviest css one (459 KB) both land on the floor, so the
    // proportional rule does not widen a single per-prefix budget.
    expect(budgetSlackBytes(2_346_835)).toBe(BUDGET_SLACK_MIN_BYTES)
    expect(budgetSlackBytes(459_071)).toBe(BUDGET_SLACK_MIN_BYTES)
  })

  it('prices the slack in the budget above the floor, at the stated fraction', () => {
    expect(budgetSlackBytes(12_000_000)).toBe(6_000)
    // 0.05% of the recorded 36,760,622 B js total is 18,380.311 B — rounded to the byte, not up.
    expect(budgetSlackBytes(36_760_622)).toBe(Math.round(BUDGET_SLACK_RATIO * 36_760_622))
    expect(budgetSlackBytes(36_760_622)).toBe(18_380)
  })

  it('gates a whole-extension total at recorded + proportional slack, and one byte beyond it fails', () => {
    const recorded = 20_000_000
    const slack = budgetSlackBytes(recorded)
    expect(slack).toBe(10_000)
    const baseline = {
      budgets: { main: { totalRawBytes: recorded + 100_000, gzipTotalBytes: 1 } },
      totals: { jsRawBytes: recorded },
    }
    expect(evaluateAssets([chunk('main-aaaaaaaa.js', recorded + slack)], baseline)).toEqual([])

    const failures = evaluateAssets([chunk('main-aaaaaaaa.js', recorded + slack + 1)], baseline)
    expect(failures).toHaveLength(1)
    expect(failures[0]).toMatchObject({ prefix: null, rawBytes: recorded + slack + 1, budget: recorded })
  })
})

/** The fixture build and recording the selective-accept cases narrow: every prefix moves if rewritten. */
const ACCEPT_BUILD = {
  'main-aaaaaaaa.js': 300_000,
  'index-bbbbbbbb.js': 260_000,
  'main-cccccccc.css': 300_000,
  'index-dddddddd.css': 260_000,
}
const ACCEPT_RECORDED: Partial<BundleBaseline> = {
  budgets: {
    main: { totalRawBytes: 100_000, gzipTotalBytes: 1, codeRawBytes: 90_000 },
    index: { totalRawBytes: 999_999, gzipTotalBytes: 2 },
  },
  stylesheets: {
    main: { totalRawBytes: 100_000, gzipTotalBytes: 3 },
    index: { totalRawBytes: 888_888, gzipTotalBytes: 4 },
  },
  totals: { jsRawBytes: 1_099_999, jsGzipBytes: 5, cssRawBytes: 988_888, cssGzipBytes: 6 },
  startup: { 'index.html': { jsRawBytes: 1234, gzipTotalBytes: 7, fileCount: 3 } },
}

/**
 * `--update --prefix=<p1,p2>` accepts only the prefixes it names. The point is reviewable diffs: a
 * translation or unrelated-prefix merge re-records its own prefix instead of every budget at once, and
 * a selective run must never quietly re-baseline a prefix the reviewer is not looking at.
 */
describe('--update --prefix accepts only the named prefixes', () => {
  it('merges one prefix into the recording, leaving every other entry object untouched', () => {
    const recorded = {
      main: { totalRawBytes: 100_000, gzipTotalBytes: 1, codeRawBytes: 90_000 },
      ru: { totalRawBytes: 900_000, gzipTotalBytes: 2, codeRawBytes: 700_000 },
    }
    const measured = { main: { totalRawBytes: 300_000, gzipTotalBytes: 3 }, ru: { totalRawBytes: 905_000, gzipTotalBytes: 4, codeRawBytes: 705_000 } }
    expect(mergePrefixBudgets(recorded, measured, ['main'])).toEqual({
      main: { totalRawBytes: 300_000, gzipTotalBytes: 3 },
      // Not accepted: byte for byte what was recorded, i18n-split field included.
      ru: { totalRawBytes: 900_000, gzipTotalBytes: 2, codeRawBytes: 700_000 },
    })
    // An accepted prefix new to the recording is added after the recorded ones, so nothing is reordered.
    expect(Object.keys(mergePrefixBudgets(recorded, measured, ['zzz']))).toEqual(['main', 'ru'])
    expect(Object.keys(mergePrefixBudgets(recorded, { ...measured, zzz: { totalRawBytes: 1, gzipTotalBytes: 1 } }, ['zzz']))).toEqual([
      'main',
      'ru',
      'zzz',
    ])
    // A named prefix the build no longer emits is not a recording of nothing: it keeps its entry.
    expect(mergePrefixBudgets(recorded, measured, ['gone'])).toEqual(recorded)
  })

  it('re-records exactly the named prefix and keeps every other section as recorded', () => {
    const root = tempRoot()
    seedBuild(root, ACCEPT_BUILD)
    seedBaseline(root, ACCEPT_RECORDED)
    const result = runCli(root, ['--update', '--prefix=main'])
    expect(result.code).toBe(0)
    // Anything the gate reports is prefixed; the run itself is silent on success.
    expect(result.err).not.toContain('bundle-size:')

    const recorded = readRecorded(root)
    // `--prefix` names a chunk-name prefix, and `main` is one in both maps: both are accepted.
    expect(recorded.budgets.main?.totalRawBytes).toBe(300_000)
    expect(recorded.stylesheets?.main?.totalRawBytes).toBe(300_000)
    // Every other prefix keeps its recorded entry, field for field.
    expect(recorded.budgets.index).toEqual({ totalRawBytes: 999_999, gzipTotalBytes: 2 })
    expect(recorded.stylesheets?.index).toEqual({ totalRawBytes: 888_888, gzipTotalBytes: 4 })
    // Whole-build numbers describe one build, so a selective accept leaves them as recorded.
    expect(recorded.totals).toEqual(ACCEPT_RECORDED.totals)
    expect(recorded.startup).toEqual(ACCEPT_RECORDED.startup)
    // The one thing a selective accept does canonicalise is the file's own header: `description` and
    // `comment` are the module constants this writer always records, exactly as a full --update writes
    // them (the fixture's `description: 'test'` is not preserved any more than `--update` preserved it).
    expect(recorded.description).toBe(DESCRIPTION)
    expect(recorded.comment).toBe(RECORDED_COMMENT)

    // Provenance is on the write, and the fixture tree is not a checkout, so `source` is the invocation.
    expect(new Date(recorded.recordedAt!).toISOString()).toBe(recorded.recordedAt)
    expect(recorded.recordedAt ?? '').toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    expect(recorded.source).toBe('bun scripts/check-bundle-size.ts --update --prefix=main')
  })

  it('accepts several comma-separated prefixes and reports a named prefix the build no longer emits', () => {
    const root = tempRoot()
    seedBuild(root, ACCEPT_BUILD)
    seedBaseline(root, {
      ...ACCEPT_RECORDED,
      budgets: { ...(ACCEPT_RECORDED.budgets ?? {}), gone: { totalRawBytes: 500_000, gzipTotalBytes: 8 } },
    })
    const result = runCli(root, ['--update', '--prefix=main,index,gone'])
    expect(result.code).toBe(0)
    expect(result.out).toContain('gone: not in this build')

    const recorded = readRecorded(root)
    expect(recorded.budgets.main?.totalRawBytes).toBe(300_000)
    expect(recorded.budgets.index?.totalRawBytes).toBe(260_000)
    expect(recorded.stylesheets?.index?.totalRawBytes).toBe(260_000)
    // Nothing to measure, so the recorded entry stands rather than being dropped or zeroed.
    expect(recorded.budgets.gone).toEqual({ totalRawBytes: 500_000, gzipTotalBytes: 8 })
  })

  it('still rewrites every section when no --prefix is given', () => {
    const root = tempRoot()
    seedBuild(root, ACCEPT_BUILD)
    seedBaseline(root, ACCEPT_RECORDED)
    expect(runCli(root, ['--update']).code).toBe(0)

    const recorded = readRecorded(root)
    expect(recorded.budgets.main?.totalRawBytes).toBe(300_000)
    expect(recorded.budgets.index?.totalRawBytes).toBe(260_000)
    expect(recorded.stylesheets?.main?.totalRawBytes).toBe(300_000)
    expect(recorded.stylesheets?.index?.totalRawBytes).toBe(260_000)
    // Whole-build numbers are re-measured, not carried over.
    expect(recorded.totals?.jsRawBytes).toBe(560_000)
    expect(recorded.totals?.cssRawBytes).toBe(560_000)
    expect(recorded.startup?.['index.html']?.jsRawBytes).toBe(0)
    // A full rewrite records provenance too, and here it names the invocation as it ran.
    expect(new Date(recorded.recordedAt!).toISOString()).toBe(recorded.recordedAt)
    expect(recorded.source).toBe('bun scripts/check-bundle-size.ts --update')
    // Same canonical header as the selective accept: both writer paths (check-bundle-size.ts:1092 for
    // --print, :1153 for --update) take `description`/`comment` from the module constants.
    expect(recorded.description).toBe(DESCRIPTION)
    expect(recorded.comment).toBe(RECORDED_COMMENT)
  })

  it('refuses a prefix that is in neither the build nor the baseline, and writes nothing', () => {
    const root = tempRoot()
    seedBuild(root, ACCEPT_BUILD)
    seedBaseline(root, ACCEPT_RECORDED)
    const before = readFileSync(join(root, 'perf-baselines/bundle-size.json'), 'utf8')

    const result = runCli(root, ['--update', '--prefix=mani'])
    expect(result.code).toBe(1)
    expect(result.err).toContain('mani')
    // A refused accept must not half-write: accepting nothing while looking like it accepted is the
    // silent failure the flag exists to prevent.
    expect(readFileSync(join(root, 'perf-baselines/bundle-size.json'), 'utf8')).toBe(before)
  })

  it('refuses --prefix without --update, and an empty --prefix list', () => {
    const root = tempRoot()
    seedBuild(root, ACCEPT_BUILD)
    seedBaseline(root, ACCEPT_RECORDED)

    const check = runCli(root, ['--check', '--prefix=main'])
    expect(check.code).toBe(1)
    expect(check.err).toContain('--prefix narrows --update only')

    const empty = runCli(root, ['--update', '--prefix='])
    expect(empty.code).toBe(1)
    expect(empty.err).toContain('--prefix needs the chunk-name prefix(es) to accept')

    const bare = runCli(root, ['--update', '--prefix'])
    expect(bare.code).toBe(1)
    expect(bare.err).toContain('--prefix needs the chunk-name prefix(es) to accept')
  })

  it('refuses --prefix when there is no recording to narrow', () => {
    const root = tempRoot()
    seedBuild(root, ACCEPT_BUILD)
    const result = runCli(root, ['--update', '--prefix=main'])
    expect(result.code).toBe(1)
    expect(result.err).toContain('--prefix needs the baseline it narrows')
    // Writing only the named prefix into an empty baseline would un-budget every other prefix.
    expect(() => readRecorded(root)).toThrow()
  })
})

/**
 * Every write labels itself: `recordedAt` (ISO-8601 UTC) and `source` (the git sha at the measured
 * root, else the invocation). The gate reads budgets only, so this metadata must never move a
 * threshold — provenance churn between two recordings of the same bundle is not a regression.
 */
describe('provenance is recorded on every write and never gated', () => {
  it('labels the write with the git sha when the measured root is a checkout', () => {
    expect(gitHeadSha(ROOT) ?? '').toMatch(/^[0-9a-f]{7,40}$/)
    expect(gitHeadSha(tempRoot())).toBeUndefined()
  })

  it('falls back to the invocation when the measured tree is not a checkout', () => {
    const provenance = recordProvenance(tempRoot(), ['--update', '--prefix=main'])
    expect(provenance.source).toBe('bun scripts/check-bundle-size.ts --update --prefix=main')
    expect(new Date(provenance.recordedAt).toISOString()).toBe(provenance.recordedAt)
  })

  it('is ignored by the gate, even when the metadata is nonsense', () => {
    const recorded = 1_000_000
    const chunks = [chunk('main-aaaaaaaa.js', recorded + budgetSlackBytes(recorded))]
    const baseline = { budgets: { main: { totalRawBytes: recorded, gzipTotalBytes: 1 } } }
    const labelled: BundleBaseline = { description: 'fixture', recordedAt: 'not-a-date', source: '', ...baseline }
    expect(evaluateAssets(chunks, baseline)).toEqual([])
    expect(evaluateAssets(chunks, labelled)).toEqual([])

    const beyond = [chunk('main-aaaaaaaa.js', recorded + budgetSlackBytes(recorded) + 1)]
    expect(evaluateAssets(beyond, baseline)).toHaveLength(1)
    expect(evaluateAssets(beyond, labelled)).toHaveLength(1)
  })

  it('CLI: a baseline carrying provenance checks exactly like one without, and --print writes it too', () => {
    const root = tempRoot()
    seedBuild(root, { 'main-aaaaaaaa.js': 300_000 })
    seedBaseline(root, {
      budgets: { main: { totalRawBytes: 400_000, gzipTotalBytes: 1 } },
      recordedAt: '2026-01-01T00:00:00.000Z',
      source: 'abc1234',
    })
    const checked = runCli(root)
    expect(checked.code).toBe(0)
    expect(checked.err).not.toContain('bundle-size:')

    const printed = runCli(root, ['--print', join(root, 'printed.json')])
    expect(printed.code).toBe(0)
    const written = JSON.parse(readFileSync(join(root, 'printed.json'), 'utf8')) as BundleBaseline
    expect(new Date(written.recordedAt!).toISOString()).toBe(written.recordedAt)
    expect(written.source).toBe(`bun scripts/check-bundle-size.ts --print ${join(root, 'printed.json')}`)
    expect(written.budgets.main?.totalRawBytes).toBe(300_000)
    // A printed file is a valid baseline: canonical `description`, provenance, and no `comment` — the
    // comment belongs to `--update` alone (check-bundle-size.ts:1154).
    expect(written.description).toBe(DESCRIPTION)
    expect(written.comment).toBeUndefined()
  })
})

/**
 * A chunk `readdirSync` listed must be read or the run must fail: skipping one understates the bundle
 * and records a budget no build has to stay under, which is the bug class the gate exists for.
 */
describe('a chunk that cannot be read is fatal, never silently skipped', () => {
  it('throws naming the path instead of dropping the entry from the measured bundle', () => {
    const root = tempRoot()
    const assets = join(root, 'apps/electron/dist/renderer/assets')
    // Listed by readdirSync and named like a chunk, but unreadable as one (as a chunk gone between the
    // listing and the read is: the same read failure, whichever errno the platform reports).
    mkdirSync(join(assets, 'main-aaaaaaaa.js'), { recursive: true })
    writeFileSync(join(assets, 'index-bbbbbbbb.js'), Buffer.alloc(64))

    expect(() => measureRendererChunks(assets)).toThrow(UnreadableFileError)
    expect(() => measureRendererChunks(assets)).toThrow(join(assets, 'main-aaaaaaaa.js'))
  })

  it('CLI: exits 1 with the offending path in the message', () => {
    const root = tempRoot()
    seedBuild(root, { 'index-bbbbbbbb.js': 64 })
    mkdirSync(join(root, 'apps/electron/dist/renderer/assets/main-aaaaaaaa.js'), { recursive: true })

    const result = runCli(root)
    expect(result.code).toBe(1)
    expect(result.err).toContain('cannot read')
    expect(result.err).toContain(join(root, 'apps/electron/dist/renderer/assets/main-aaaaaaaa.js'))
  })
})
