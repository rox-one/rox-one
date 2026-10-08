/**
 * W1-10 (#1507) — perf micro-benchmarks.
 *
 * Budgets come from TECH-SPEC §7: batch resolve of 100 refs < 40 ms local,
 * Work Map with 1,000 rows first paint < 300 ms, task list filter over
 * 10k items < 50 ms. Each bench exercises the real primitive (entity
 * ref parse/format from `@rox/core/entities`, array projections shaped
 * like the work-map rows and the list-view filter) and reports measured
 * milliseconds alongside the budget.
 */
import { formatEntityRef, parseEntityRef } from '@rox/core/entities'

export const MICRO_BENCH_BUDGETS = {
  resolveBatch100Ms: 40,
  workMap1000Ms: 300,
  listFilter10kMs: 50,
} as const

export interface MicroBenchResult {
  name: 'resolve' | 'work-map' | 'list-view'
  measuredMs: number
  budgetMs: number
  pass: boolean
}

function nowMs(): number {
  return Number(process.hrtime.bigint()) / 1e6
}

function benchResolve(): number {
  const refs = Array.from({ length: 100 }, (_, i) => `task:seed-${i}`)
  const t0 = nowMs()
  for (const raw of refs) {
    const parsed = parseEntityRef(raw)
    if (parsed.ok) formatEntityRef(parsed.value)
  }
  return nowMs() - t0
}

interface WorkMapRow {
  id: string
  depth: number
  progress: number
  title: string
}

function benchWorkMap(): number {
  const rows: WorkMapRow[] = Array.from({ length: 1000 }, (_, i) => ({
    id: `goal:${i}`,
    depth: i % 4,
    progress: (i * 37) % 100,
    title: `Seeded goal ${i}`,
  }))
  const t0 = nowMs()
  const sorted = [...rows].sort((a, b) => a.depth - b.depth || a.title.localeCompare(b.title))
  const flat = sorted.map((r) => `${'  '.repeat(r.depth)}${r.title} ${r.progress}%`)
  if (flat.length !== 1000) throw new Error('work-map bench: row count changed')
  return nowMs() - t0
}

function benchListFilter(): number {
  const items = Array.from({ length: 10_000 }, (_, i) => ({
    id: `task:${i}`,
    title: `Seeded task ${i}`,
    status: i % 3 === 0 ? 'done' : 'open',
  }))
  const t0 = nowMs()
  const open = items.filter((t) => t.status === 'open' && t.title.includes('Seeded'))
  if (open.length === 0) throw new Error('list-view bench: filter matched nothing')
  return nowMs() - t0
}

export function runMicroBenchmarks(): MicroBenchResult[] {
  const resolve = benchResolve()
  const workMap = benchWorkMap()
  const listView = benchListFilter()
  return [
    {
      name: 'resolve',
      measuredMs: resolve,
      budgetMs: MICRO_BENCH_BUDGETS.resolveBatch100Ms,
      pass: resolve < MICRO_BENCH_BUDGETS.resolveBatch100Ms,
    },
    {
      name: 'work-map',
      measuredMs: workMap,
      budgetMs: MICRO_BENCH_BUDGETS.workMap1000Ms,
      pass: workMap < MICRO_BENCH_BUDGETS.workMap1000Ms,
    },
    {
      name: 'list-view',
      measuredMs: listView,
      budgetMs: MICRO_BENCH_BUDGETS.listFilter10kMs,
      pass: listView < MICRO_BENCH_BUDGETS.listFilter10kMs,
    },
  ]
}
