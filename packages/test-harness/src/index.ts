/**
 * W1-10 (#1507) — test harness public surface.
 *
 * Seeded two-user workspaces, migration fixtures, micro-benchmarks and the
 * CI gate runners consumed by `scripts/check-provenance.ts`,
 * `scripts/run-unified-gates.ts` and the `unified-gates` CI job.
 */
export { resolvePostgresUrl, ensurePostgres, type PostgresFixture } from './postgres.ts'
export {
  seedTwoUserWorkspace,
  type SeededWorkspace,
  type SeededUser,
  type SeededSpace,
} from './seed.ts'
export { runMicroBenchmarks, MICRO_BENCH_BUDGETS, median, type MicroBenchResult, type MicroBenchOptions } from './bench.ts'
export {
  VISUAL_VIEWPORTS,
  VISUAL_PROFILES,
  VISUAL_THEMES,
  VISUAL_LOCALES,
  FIXED_CLOCK_ISO,
  planVisualSnapshots,
  type VisualSnapshotPlan,
} from './visual.ts'
export { runAxeAudit, type AxeAuditResult, type AxeViolation } from './axe.ts'
export * from './gates/index.ts'
export * from './fixtures/index.ts'
