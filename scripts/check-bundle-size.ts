#!/usr/bin/env bun
/**
 * Bundle-size budget gate for the Electron renderer.
 *
 * Measures the production renderer JS chunks (apps/electron/dist/renderer/assets) and fails when a
 * known chunk-name *prefix* grows past its recorded raw-byte budget, or when an unbudgeted prefix
 * grows past MAX_NEW_CHUNK_BYTES. Raw `statSync().size` is the gated number; gzip (level 9) is
 * reported alongside. Source maps (vite.config.ts `sourcemap: true`) and the pdf worker are never
 * measured: only `assets/*.js` is read.
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
 * Exit code: 1 when the renderer build is missing, or any chunk exceeds its budget / the ceiling;
 * 0 otherwise. Budgets are keyed by the chunk-name prefix
 * (basename.replace(/-[A-Za-z0-9_-]{8}\.js$/, '')) — never the content hash — so a rebuild that
 * only changes hashes does not move the budget.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'

/** Default repo root, overridden in tests (and CI sandboxes) by ROX_BUNDLE_SIZE_ROOT. */
const DEFAULT_ROOT = resolve(import.meta.dir, '..')

/** An unbudgeted chunk prefix may not exceed this; vite.config.ts VENDOR_CHUNKS: ~2.5 MB startup. */
export const MAX_NEW_CHUNK_BYTES = 2_500_000

/**
 * Vite/Rollup hashed-chunk suffix: a dash plus the 8-character content hash.
 * `chunkPrefix('index-B3-J8HY7.js')` -> `index`; a name without that suffix keeps its stem, so
 * the budget key is always the extension-less chunk name (`chunk-abc.js` -> `chunk-abc`).
 */
const HASH_SUFFIX = /-[A-Za-z0-9_-]{8}$/
const JS_EXTENSION = /\.js$/

export interface ChunkBudget {
  rawBytes: number
  gzipBytes: number
}

export interface BundleBaseline {
  description: string
  /** Human note (e.g. how the seed values were recorded); ignored by the gate. */
  comment?: string
  budgets: Record<string, ChunkBudget>
}

export interface MeasuredChunk {
  /** Basename, e.g. `index-B3-J8HY7.js`. */
  file: string
  prefix: string
  /** The gated number: `statSync().size` of the emitted chunk. */
  rawBytes: number
  /** gzip level 9, mtime 0 — informational, reported alongside rawBytes. */
  gzipBytes: number
}

export interface BudgetFailure {
  file: string
  prefix: string
  rawBytes: number
  budget: number
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

/** The stable chunk-name prefix (never the hash): `main-BCWHcyRa.js` -> `main`. */
export function chunkPrefix(baseName: string): string {
  return baseName.replace(JS_EXTENSION, '').replace(HASH_SUFFIX, '')
}

/**
 * Only emitted JS chunks are measured. `.js.map` (sourcemap: true) and the pdf worker
 * (pdf.worker.min-*.mjs) are excluded explicitly as well as by extension.
 */
export function isMeasuredAsset(baseName: string): boolean {
  if (!baseName.endsWith('.js')) return false
  if (baseName.endsWith('.js.map') || baseName.endsWith('.map')) return false
  if (baseName.startsWith('pdf.worker')) return false
  return true
}

/** Raw + gzip bytes of every emitted `assets/*.js` chunk, sorted by file name. */
export function measureRendererChunks(assetsDir: string = paths().assets): MeasuredChunk[] {
  if (!existsSync(assetsDir)) return []
  const chunks: MeasuredChunk[] = []
  for (const file of readdirSync(assetsDir).sort()) {
    if (!isMeasuredAsset(file)) continue
    const path = join(assetsDir, file)
    if (!statSync(path).isFile()) continue
    const content = readFileSync(path)
    chunks.push({
      file,
      prefix: chunkPrefix(file),
      rawBytes: statSync(path).size,
      // Bun accepts `mtime: 0` (deterministic gzip) beyond Node's ZlibOptions type.
      gzipBytes: gzipSync(content, { level: 9, mtime: 0 } as unknown as Parameters<typeof gzipSync>[1]).length,
    })
  }
  return chunks
}

/**
 * A chunk prefix at or above this size at recording time gets its own budget entry; everything
 * smaller stays unbudgeted and is only caught by MAX_NEW_CHUNK_BYTES (a floor keeps the recorded
 * baseline meaningful instead of listing every 1 KB shiki language chunk).
 */
export const MIN_BUDGET_BYTES = 250_000

/**
 * Per-prefix budgets for `--update` / `--print`: the largest emitted chunk of each prefix (a prefix
 * such as `index` covers several small entry chunks plus the big one; the gate fails on the max).
 * Prefixes whose largest chunk is below MIN_BUDGET_BYTES are omitted.
 */
export function buildBudgets(chunks: MeasuredChunk[]): Record<string, ChunkBudget> {
  const budgets: Record<string, ChunkBudget> = {}
  for (const chunk of chunks) {
    const current = budgets[chunk.prefix]
    if (!current || chunk.rawBytes > current.rawBytes) {
      budgets[chunk.prefix] = { rawBytes: chunk.rawBytes, gzipBytes: chunk.gzipBytes }
    }
  }
  for (const [prefix, budget] of Object.entries(budgets)) {
    if (budget.rawBytes < MIN_BUDGET_BYTES) delete budgets[prefix]
  }
  return budgets
}

/**
 * Cross-platform slack on every budget: the same source builds to slightly different byte counts on
 * macOS and Linux (observed <= 91 B on the 900 KB `main` chunk), so the gate compares against
 * `budget + BUDGET_SLACK_BYTES` and reports the raw recorded budget.
 */
export const BUDGET_SLACK_BYTES = 4096

/**
 * Pure gate: a budgeted prefix over its recorded rawBytes budget, or an unbudgeted prefix over
 * MAX_NEW_CHUNK_BYTES, each with BUDGET_SLACK_BYTES of platform noise allowed. Kept free of
 * filesystem access so it is unit-testable without a build.
 */
export function evaluateChunks(chunks: MeasuredChunk[], budgets: Record<string, ChunkBudget>): BudgetFailure[] {
  const failures: BudgetFailure[] = []
  for (const chunk of chunks) {
    const known = budgets[chunk.prefix]
    const recorded = known ? known.rawBytes : MAX_NEW_CHUNK_BYTES
    if (chunk.rawBytes > recorded + BUDGET_SLACK_BYTES) {
      failures.push({ file: chunk.file, prefix: chunk.prefix, rawBytes: chunk.rawBytes, budget: recorded })
    }
  }
  return failures
}

/** The single-line failure report naming the file and both byte counts. */
export function formatFailure(failure: BudgetFailure): string {
  const diff = failure.rawBytes - failure.budget
  return (
    `bundle-size: assets/${failure.file} is ${failure.rawBytes} B, budget ${failure.budget} B for ` +
    `'${failure.prefix}' (+${diff} B). Shrink it (move the payload behind a lazy import - see ` +
    `vite.config.ts VENDOR_CHUNKS / SIDE_EFFECT_FREE_MODULES) or re-record: ` +
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
  'Renderer bundle-size budgets. Generated by `bun scripts/check-bundle-size.ts --update`; rawBytes ' +
  'gates the largest emitted chunk of each name prefix, gzipBytes is reported alongside. Over the ' +
  'recorded rawBytes the gate fails (or 2,500,000 B for an unbudgeted prefix).'

/** The largest chunk of each prefix, with its gate budget, for the success table (top 5 by raw). */
function topPrefixes(chunks: MeasuredChunk[], budgets: Record<string, ChunkBudget>) {
  const largest = new Map<string, MeasuredChunk>()
  for (const chunk of chunks) {
    const current = largest.get(chunk.prefix)
    if (!current || chunk.rawBytes > current.rawBytes) largest.set(chunk.prefix, chunk)
  }
  return [...largest.values()]
    .map((chunk) => ({
      prefix: chunk.prefix,
      rawBytes: chunk.rawBytes,
      gzipBytes: chunk.gzipBytes,
      budget: budgets[chunk.prefix]?.rawBytes ?? MAX_NEW_CHUNK_BYTES,
    }))
    .sort((a, b) => b.rawBytes - a.rawBytes)
    .slice(0, 5)
}

function printSuccessTable(chunks: MeasuredChunk[], budgets: Record<string, ChunkBudget>) {
  const rows = topPrefixes(chunks, budgets)
  console.log(`bundle-size: ${chunks.length} renderer chunk(s) measured (raw bytes gate; gzip reported alongside)`)
  console.log(`  ${'prefix'.padEnd(24)} ${'raw'.padStart(10)} ${'gzip'.padStart(10)} ${'budget'.padStart(10)}`)
  for (const row of rows) {
    console.log(
      `  ${row.prefix.padEnd(24)} ${String(row.rawBytes).padStart(10)} ${String(row.gzipBytes).padStart(10)} ${String(row.budget).padStart(10)}`,
    )
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

  // Fail closed: without the renderer entry HTML there is no build to measure.
  if (!existsSync(p.indexHtml)) {
    console.error('no renderer build found - run bun run electron:build:renderer first')
    return 1
  }

  const chunks = measureRendererChunks(p.assets)
  const measured = buildBudgets(chunks)

  if (printArg) {
    writeJson(resolve(printArg), { description: DESCRIPTION, budgets: measured })
    console.log(`bundle-size: wrote ${Object.keys(measured).length} prefix budget(s) to ${printArg}`)
    return 0
  }

  if (update) {
    writeJson(baselinePath, {
      description: DESCRIPTION,
      comment: 'Recorded by `bun scripts/check-bundle-size.ts --update` against a real renderer build.',
      budgets: measured,
    })
    console.log(`bundle-size: wrote ${relative(p.root, baselinePath)} (${Object.keys(measured).length} prefix budget(s))`)
    for (const [prefix, budget] of Object.entries(measured).sort()) {
      console.log(`  ${prefix}: raw ${budget.rawBytes} B, gzip ${budget.gzipBytes} B`)
    }
    return 0
  }

  const baseline = existsSync(baselinePath)
    ? readBaseline(baselinePath)
    : { description: DESCRIPTION, budgets: {} }
  const failures = evaluateChunks(chunks, baseline.budgets ?? {})
  if (failures.length > 0) {
    for (const failure of failures) console.error(formatFailure(failure))
    console.error(
      `bundle-size: ${failures.length} chunk(s) over budget. If the growth is intended, owner-approve ` +
        `it and re-record with \`bun scripts/check-bundle-size.ts --update\`.`,
    )
    return 1
  }

  printSuccessTable(chunks, baseline.budgets ?? {})
  console.log('bundle-size: OK — every renderer chunk is within its budget.')
  return 0
}

if (import.meta.main) {
  process.exit(main())
}