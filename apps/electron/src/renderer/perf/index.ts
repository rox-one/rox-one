export { PERF_BUDGETS, CACHED_SESSION_SWITCH_P95_MS, DROPDOWN_OPEN_P95_MS } from './budgets'
export {
  createBulkSessionSidecar,
  createLargeVaultFixture,
  createSessionFixture,
  indexSessionsById,
} from './fixtures'
export { IpcCallCounter, diffIpc } from './ipc-counter'
export { normalizeIpcChannel, SESSION_API_TO_HARNESS } from './channels'
export { redactTelemetryPayload, redactText, REDACTED } from './redaction'
export { PerfTelemetry } from './telemetry'
export { PerfMarkClock } from './marks'
export { runPerfHarness } from './runner'
export { formatPerfReport } from './report'
export { evaluateAll, evaluateBudget, gatedFailures } from './evaluate'
export { profileBundleInventory, profileMinifyHang } from './bundle-profile'
export { isPerfHarnessEnabled } from './flags'
export { installRendererPerfHarness } from './install'
export { installSessionIpcProbe } from './probe'
export { attachLongTaskObserver, createReactCommitOnRender } from './observers'
export {
  warmRendererCache,
  switchCachedSession,
  switchWithFullReload,
  pickSwitchTargets,
} from './switch-sim'
export type { BenchmarkReport, BudgetVerdict, SessionIndexEntry } from './types'
