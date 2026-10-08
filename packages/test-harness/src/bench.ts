/**
 * W1-10 (#1507) — perf micro-benchmarks.
 *
 * Budgets come from TECH-SPEC §7: batch resolve of 100 refs < 40 ms local,
 * Work Map with 1,000 rows first paint < 300 ms, task list filter over
 * 10k items < 50 ms.
 *
 * Real vs synthetic (owner decision, #1507 review 2): a bench times the
 * real product code where it exists, otherwise it is labelled `synthetic`
 * in the result and in the perf-gate summary, so nobody reads a synthetic
 * number as a product measurement.
 *   - `resolve`   — real: entity ref parse/format from `@rox/core/entities`.
 *   - `work-map`  — synthetic until the wave-2 work-map projection lands;
 *   - `list-view` — synthetic until the wave-2 task list filter lands.
 * Wave 2 wires the real code through `MicroBenchOptions.implementations`
 * (each entry flips that bench to `real`); no harness change is needed.
 *
 * Each bench runs `warmup` untimed iterations, then `samples` timed ones,
 * and takes the median. `runs` (ROX_BENCH_RUNS, default 1) repeats that
 * whole measurement and reports the median of the run medians — strict CI
 * (push to main + nightly, see .github/workflows/bench-strict.yml) uses 3.
 * On PRs the perf gate is report-only (`warn`) unless `ROX_BENCH_STRICT=1`
 * (see `perfGate` in gates/run-all.ts).
 */
import { formatEntityRef, parseEntityRef } from '@rox/core/entities'

export const MICRO_BENCH_BUDGETS = {
  resolveBatch100Ms: 40,
  workMap1000Ms: 300,
  listFilter10kMs: 50,
} as const

export type MicroBenchName = 'resolve' | 'work-map' | 'list-view'
export type MicroBenchKind = 'real' | 'synthetic'

export interface MicroBenchResult {
  name: MicroBenchName
  /** `real` times product code; `synthetic` times a stand-in shaped like it. */
  kind: MicroBenchKind
  /** Median of the per-run medians (the plain median when runs = 1). */
  measuredMs: number
  /** Median of each run, in run order. */
  runMediansMs: number[]
  /** Timed samples of every run, flattened in run order. */
  samplesMs: number[]
  budgetMs: number
  pass: boolean
}

/** Product code a bench times; it does the work once and must not throw. */
export type BenchWork = () => void

export interface MicroBenchOptions {
  warmup?: number
  samples?: number
  /** Independent repetitions; the result is the median of their medians. */
  runs?: number
  /** Real implementations; a provided entry makes that bench `real`. */
  implementations?: Partial<Record<MicroBenchName, BenchWork>>
}

export const DEFAULT_WARMUP = 3
export const DEFAULT_SAMPLES = 7
export const DEFAULT_RUNS = 1

export function median(values: number[]): number {
  if (values.length === 0) throw new Error('median of no samples')
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

/** ROX_BENCH_RUNS → run count (positive integer; anything else → default). */
export function benchRunsFromEnv(env: Record<string, string | undefined> = process.env): number {
  const raw = env.ROX_BENCH_RUNS
  if (raw === undefined || raw.trim() === '') return DEFAULT_RUNS
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1) throw new Error(`ROX_BENCH_RUNS must be a positive integer, got ${JSON.stringify(raw)}`)
  return n
}

function nowMs(): number {
  return Number(process.hrtime.bigint()) / 1e6
}

function timed(work: BenchWork): number {
  const t0 = nowMs()
  work()
  return nowMs() - t0
}

function measure(work: BenchWork, opts: MicroBenchOptions): Pick<MicroBenchResult, 'measuredMs' | 'runMediansMs' | 'samplesMs'> {
  const warmup = Math.max(0, opts.warmup ?? DEFAULT_WARMUP)
  const count = Math.max(1, opts.samples ?? DEFAULT_SAMPLES)
  const runs = Math.max(1, opts.runs ?? DEFAULT_RUNS)
  const runMediansMs: number[] = []
  const samplesMs: number[] = []
  for (let r = 0; r < runs; r += 1) {
    for (let i = 0; i < warmup; i += 1) work()
    const run = Array.from({ length: count }, () => timed(work))
    samplesMs.push(...run)
    runMediansMs.push(median(run))
  }
  return { measuredMs: median(runMediansMs), runMediansMs, samplesMs }
}

const RESOLVE_REFS = Array.from({ length: 100 }, (_, i) => `task:seed-${i}`)

/** Real: the `@rox/core/entities` ref codec over a batch of 100 refs. */
function resolveWork(): void {
  for (const raw of RESOLVE_REFS) {
    const parsed = parseEntityRef(raw)
    if (parsed.ok) formatEntityRef(parsed.value)
  }
}

interface WorkMapRow {
  id: string
  depth: number
  progress: number
  title: string
}

const WORK_MAP_ROWS: WorkMapRow[] = Array.from({ length: 1000 }, (_, i) => ({
  id: `goal:${i}`,
  depth: i % 4,
  progress: (i * 37) % 100,
  title: `Seeded goal ${i}`,
}))

/** Synthetic: sort + flatten 1,000 goal rows (no work-map projection exists yet). */
function syntheticWorkMap(): void {
  const sorted = [...WORK_MAP_ROWS].sort((a, b) => a.depth - b.depth || a.title.localeCompare(b.title))
  const flat = sorted.map((r) => `${'  '.repeat(r.depth)}${r.title} ${r.progress}%`)
  if (flat.length !== 1000) throw new Error('work-map bench: row count changed')
}

const LIST_ITEMS = Array.from({ length: 10_000 }, (_, i) => ({
  id: `task:${i}`,
  title: `Seeded task ${i}`,
  status: i % 3 === 0 ? 'done' : 'open',
}))

/** Synthetic: filter 10k task rows (no task list filter exists yet). */
function syntheticListFilter(): void {
  const open = LIST_ITEMS.filter((t) => t.status === 'open' && t.title.includes('Seeded'))
  if (open.length === 0) throw new Error('list-view bench: filter matched nothing')
}

interface BenchSpec {
  name: MicroBenchName
  budgetMs: number
  /** The real product code, or null while only a synthetic stand-in exists. */
  real: BenchWork | null
  synthetic: BenchWork
}

const BENCHES: BenchSpec[] = [
  { name: 'resolve', budgetMs: MICRO_BENCH_BUDGETS.resolveBatch100Ms, real: resolveWork, synthetic: resolveWork },
  { name: 'work-map', budgetMs: MICRO_BENCH_BUDGETS.workMap1000Ms, real: null, synthetic: syntheticWorkMap },
  { name: 'list-view', budgetMs: MICRO_BENCH_BUDGETS.listFilter10kMs, real: null, synthetic: syntheticListFilter },
]

export function runMicroBenchmarks(opts: MicroBenchOptions = {}): MicroBenchResult[] {
  return BENCHES.map((spec) => {
    const work = opts.implementations?.[spec.name] ?? spec.real
    const kind: MicroBenchKind = work ? 'real' : 'synthetic'
    const m = measure(work ?? spec.synthetic, opts)
    return { name: spec.name, kind, ...m, budgetMs: spec.budgetMs, pass: m.measuredMs < spec.budgetMs }
  })
}
