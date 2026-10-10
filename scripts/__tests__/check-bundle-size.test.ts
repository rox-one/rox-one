/**
 * Bundle-size budget gate (scripts/check-bundle-size.ts) and the closed-form minify profile.
 *
 * The gate cases are exercised both through the real CLI (exit codes as CI sees them) on throwaway
 * renderer trees and against the pure `evaluateAssets`, which aggregates js/css prefix TOTALS and the
 * whole-extension totals; prefix derivation and the recording floor are pure-function cases.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  BUDGET_SLACK_BYTES,
  MAX_NEW_CHUNK_BYTES,
  MAX_NEW_STARTUP_BYTES,
  MIN_BUDGET_BYTES,
  assetKind,
  buildBudgets,
  bundleTotals,
  chunkPrefix,
  evaluateAssets,
  evaluateStartup,
  formatFailure,
  formatStartupFailure,
  measureRendererChunks,
  measureStartup,
  parseHtmlReferences,
  type BundleBaseline,
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

function seedBaseline(root: string, baseline: Partial<BundleBaseline>): void {
  mkdirSync(join(root, 'perf-baselines'), { recursive: true })
  writeFileSync(
    join(root, 'perf-baselines/bundle-size.json'),
    JSON.stringify({ description: 'test', ...baseline }),
  )
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

    const over = BUDGET_SLACK_BYTES + 1
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
    const grown = 100_000 + BUDGET_SLACK_BYTES + 1
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
    const within = [chunk('main-aaaaaaaa.js', 600), chunk('main-bbbbbbbb.js', 400 + BUDGET_SLACK_BYTES)]
    expect(evaluateAssets(within, recorded)).toEqual([])

    const beyond = [chunk('main-aaaaaaaa.js', 600), chunk('main-bbbbbbbb.js', 401 + BUDGET_SLACK_BYTES)]
    expect(evaluateAssets(beyond, recorded)).toHaveLength(1)
  })

  it('allows within-slack bundle totals but fails one byte beyond, leaving slack-free prefixes alone', () => {
    const recorded = { budgets: { main: { totalRawBytes: 1_000_000, gzipTotalBytes: 1 } }, totals: { jsRawBytes: 1000 } }
    expect(evaluateAssets([chunk('main-aaaaaaaa.js', 1000 + BUDGET_SLACK_BYTES)], recorded)).toEqual([])

    const failures = evaluateAssets([chunk('main-aaaaaaaa.js', 1001 + BUDGET_SLACK_BYTES)], recorded)
    expect(failures).toEqual([
      {
        kind: 'js',
        prefix: null,
        rawBytes: 1001 + BUDGET_SLACK_BYTES,
        budget: 1000,
        file: 'main-aaaaaaaa.js',
        fileRawBytes: 1001 + BUDGET_SLACK_BYTES,
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
    const over = BUDGET_SLACK_BYTES + 1
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
    seedBuild(root, { 'main-aaaaaaaa.js': 10_000 })
    seedBaseline(root, {
      budgets: { main: { totalRawBytes: 10_000, gzipTotalBytes: 500 } },
      totals: { jsRawBytes: 1000, jsGzipBytes: 1 },
    })
    const result = runCli(root)
    expect(result.code).toBe(1)
    expect(result.err).toContain('js bundle total is 10000 B, budget 1000 B')
    expect(result.err).toContain('assets/main-aaaaaaaa.js')
    expect(result.err).not.toContain("prefix 'main'")
  })

  it('exits 1 when a CSS prefix total regresses', () => {
    const root = tempRoot()
    seedBuild(root, { 'main-aaaaaaaa.css': 10_000 })
    seedBaseline(root, { stylesheets: { main: { totalRawBytes: 1000, gzipTotalBytes: 100 } } })
    const result = runCli(root)
    expect(result.code).toBe(1)
    expect(result.err).toContain("css prefix 'main' total is 10000 B, budget 1000 B")
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
    expect(evaluateStartup([startupMeasurement('index.html', 1000 + BUDGET_SLACK_BYTES)], recorded)).toEqual([])

    const failures = evaluateStartup([startupMeasurement('index.html', 1000 + BUDGET_SLACK_BYTES + 1)], recorded)
    expect(failures).toHaveLength(1)
    expect(failures[0]).toMatchObject({ html: 'index.html', jsRawBytes: 1001 + BUDGET_SLACK_BYTES, budget: 1000, unbudgeted: false, overBudget: true })
    const line = formatStartupFailure(failures[0]!)
    expect(line).toContain(`startup: index.html static JS closure is ${1001 + BUDGET_SLACK_BYTES} B, budget 1000 B`)
    expect(line).toContain('heaviest referenced files for index.html')
  })

  it('gates an html file with no recorded entry against MAX_NEW_STARTUP_BYTES', () => {
    expect(evaluateStartup([startupMeasurement('new.html', MAX_NEW_STARTUP_BYTES)], {})).toEqual([])

    const failures = evaluateStartup([startupMeasurement('new.html', MAX_NEW_STARTUP_BYTES + BUDGET_SLACK_BYTES + 1)], {})
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
    seedStartupBuild(
      root,
      [
        '<script type="module" src="./assets/main-aaaaaaaa.js"></script>',
        '<link rel="modulepreload" href="./assets/vendor-bbbbbbbb.js">',
      ].join('\n'),
      { 'main-aaaaaaaa.js': 5000, 'vendor-bbbbbbbb.js': 1000 },
    )
    seedBaseline(root, { budgets: {}, startup: { 'index.html': { jsRawBytes: 1000, gzipTotalBytes: 10, fileCount: 1 } } })
    const result = runCli(root)
    expect(result.code).toBe(1)
    expect(result.err).toContain('startup: index.html static JS closure is 6000 B, budget 1000 B')
    expect(result.err).toContain('heaviest referenced files for index.html')
    expect(result.err).toContain('assets/main-aaaaaaaa.js: 5000 B')
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