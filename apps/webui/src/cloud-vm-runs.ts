/**
 * Web-only «Облачная ВМ» surface logic (R16 remainder).
 *
 * Pure helpers + host types for CloudVmSurface. Deliberately free of React/DOM
 * imports so the resolution is unit-testable in isolation and can be reused by
 * any web entry.
 *
 * Field shapes mirror the real RPC surface:
 *   - runs list  → packages/server-core/src/handlers/rpc/cloud-runs.ts LIST
 *   - run state  → apps/electron/src/renderer/components/cloud-runs/CloudRunsChip.tsx
 * No field is invented here.
 */

/** Every run state the cloud-runs list can report (provider RunStatus union). */
export type CloudRunState =
  | 'queued'
  | 'start'
  | 'ready'
  | 'running'
  | 'done'
  | 'failed'
  | 'cancelled'
  | 'expired'

/**
 * States where the provider can still be asked to cancel the run — the same
 * set CloudRunsChip offers «Отменить»/«Kill» for. Terminal states are excluded.
 */
export const CLOUD_RUN_ACTIVE_STATES = [
  'queued',
  'start',
  'ready',
  'running',
] as const satisfies readonly CloudRunState[]

export interface CloudRunProgress {
  completed: number
  total: number
}

/** Provider status attached to a listed run (`null` = registry ghost / provider blip). */
export interface CloudRunStatus {
  /** `CloudRunState` for live rows; kept as `string` so unknown states stay honest. */
  state: string
  failureReason?: string
  progress?: CloudRunProgress
}

/** One row of `host.listCloudRuns()` — fields the RPC list actually returns. */
export interface CloudRunListItem {
  id: string
  name?: string
  provider?: string
  createdAt?: number
  sessionId?: string
  topic?: string
  status?: CloudRunStatus | null
}

export interface CloudRunsListResult {
  enabled: boolean
  provider: string
  runs: CloudRunListItem[]
}

/**
 * Minimal submit payload — the SUBMIT handler requires a non-empty `topic`
 * and every other field is optional (provider defaults kick in). Keeping the
 * shape minimal avoids fabricating provider/preset choices the surface does
 * not offer.
 */
export interface SubmitCloudRunArgs {
  topic: string
}

/**
 * Dependency surface for the surface component; `window.electronAPI` satisfies
 * it structurally. `getCloudRunsConfig` matches `CloudRunsProbeHost` from
 * web-modes.ts, so the availability probe is reused verbatim.
 */
export interface CloudVmSurfaceHost {
  getCloudRunsConfig(): Promise<unknown>
  listCloudRuns(): Promise<CloudRunsListResult>
  submitCloudRun(args: SubmitCloudRunArgs): Promise<unknown>
  cancelCloudRun(id: string): Promise<unknown>
}

/** True when the run's provider state can still be cancelled. */
export function canCancelRun(run: CloudRunListItem): boolean {
  const state = run.status?.state
  return typeof state === 'string' && (CLOUD_RUN_ACTIVE_STATES as readonly string[]).includes(state)
}

/**
 * Validate + normalise a topic into SUBMIT args. Empty or whitespace-only
 * input is rejected (`null`) — the handler rejects it too, so the surface must
 * not send it.
 */
export function buildSubmitArgs(topic: string): SubmitCloudRunArgs | null {
  const trimmed = topic.trim()
  if (!trimmed) return null
  return { topic: trimmed }
}

/** i18n key for each known run state (reuses the existing cloudRuns.state.* keys). */
const RUN_STATE_MESSAGE_KEYS: Record<CloudRunState, string> = {
  queued: 'cloudRuns.state.queued',
  start: 'cloudRuns.state.start',
  ready: 'cloudRuns.state.ready',
  running: 'cloudRuns.state.running',
  done: 'cloudRuns.state.done',
  failed: 'cloudRuns.state.failed',
  cancelled: 'cloudRuns.state.cancelled',
  expired: 'cloudRuns.state.expired',
}

/**
 * i18n key for a run state, with a safe fallback for `null`/unknown states so
 * a row never renders an empty label.
 */
export function runStateMessageKey(state: string | null | undefined): string {
  if (typeof state === 'string' && Object.prototype.hasOwnProperty.call(RUN_STATE_MESSAGE_KEYS, state)) {
    return RUN_STATE_MESSAGE_KEYS[state as CloudRunState]
  }
  return 'cloudRuns.state.unknown'
}

/**
 * Newest-first ordering for the runs list. Deterministic: ties on `createdAt`
 * are broken by `id` ascending, so the order never depends on the input order
 * (or on a JS engine's stability guarantee). Does not mutate `runs`.
 */
export function sortRunsNewestFirst<T extends CloudRunListItem>(runs: readonly T[]): T[] {
  return [...runs].sort((a, b) => {
    const aCreated = typeof a.createdAt === 'number' ? a.createdAt : 0
    const bCreated = typeof b.createdAt === 'number' ? b.createdAt : 0
    if (aCreated !== bCreated) return bCreated - aCreated
    if (a.id === b.id) return 0
    return a.id < b.id ? -1 : 1
  })
}