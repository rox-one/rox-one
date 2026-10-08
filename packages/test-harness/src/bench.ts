/**
 * W1-10 (#1507) — perf micro-benchmarks.
 *
 * Budgets come from TECH-SPEC §7: batch resolve of 100 refs < 40 ms local,
 * Work Map with 1,000 rows first paint < 300 ms, task list filter over
 * 10k items < 50 ms.
 *
 * Labels (owner decision, #1507 review 2; refined in review 3): every result
 * says what it timed, in the result and in the perf-gate summary, so nobody
 * reads a stand-in number as a product measurement.
 *   - `real`       — the product code path the budget refers to;
 *   - `codec-only` — product code, but only part of the budgeted path;
 *   - `synthetic`  — a stand-in shaped like the workload.
 * Current benches:
 *   - `resolve`   — codec-only: the `@rox/core/entities` ref parse/format over
 *     100 refs, NOT the batch resolve (lookup + ACL) the 40 ms budget names;
 *   - `work-map`  — synthetic until the wave-2 work-map projection lands;
 *   - `list-view` — synthetic until the wave-2 task list filter lands.
 * `MicroBenchOptions.implementations` swaps in real code (each entry makes
 * that bench `real`), but the only production caller, `perfGate(runMicro
 * Benchmarks(…))` in gates/run-all.ts, passes none today: wiring a wave-2
 * implementation into CI needs a change there (import the module and pass
 * it in `implementations`). Until then CI keeps timing the stand-ins.
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
export type MicroBenchKind = 'real' | 'codec-only' | 'synthetic'

export interface MicroBenchResult {
  name: MicroBenchName
  /** `real` times the budgeted product path; `codec-only` part of it; `synthetic` a stand-in shaped like it. */
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

/** Codec-only: the `@rox/core/entities` ref codec over a batch of 100 refs (no lookup / ACL). */
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
  /** What runs when no implementation is injected, and its label. */
  fallback: BenchWork
  fallbackKind: Exclude<MicroBenchKind, 'real'>
}

const BENCHES: BenchSpec[] = [
  { name: 'resolve', budgetMs: MICRO_BENCH_BUDGETS.resolveBatch100Ms, fallback: resolveWork, fallbackKind: 'codec-only' },
  { name: 'work-map', budgetMs: MICRO_BENCH_BUDGETS.workMap1000Ms, fallback: syntheticWorkMap, fallbackKind: 'synthetic' },
  { name: 'list-view', budgetMs: MICRO_BENCH_BUDGETS.listFilter10kMs, fallback: syntheticListFilter, fallbackKind: 'synthetic' },
]

export function runMicroBenchmarks(opts: MicroBenchOptions = {}): MicroBenchResult[] {
  return BENCHES.map((spec) => {
    const injected = opts.implementations?.[spec.name]
    const kind: MicroBenchKind = injected ? 'real' : spec.fallbackKind
    const m = measure(injected ?? spec.fallback, opts)
    return { name: spec.name, kind, ...m, budgetMs: spec.budgetMs, pass: m.measuredMs < spec.budgetMs }
  })
}
