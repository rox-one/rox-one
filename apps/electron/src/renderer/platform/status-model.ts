export type WorkspaceRuntimeMode = 'local' | 'remote' | 'offline'

export interface StatusBarInput {
  transportMode?: 'local' | 'remote'
  transportStatus?: string
  runCount?: number
  approvalCount?: number
  permissionMode?: string | null
  peopleCount?: number
  agentCount?: number
}

export interface StatusBarModel {
  workspaceMode: WorkspaceRuntimeMode
  syncOk: boolean
  runCount: number
  approvalCount: number
  permissionMode: string | null
  peopleCount: number
  agentCount: number
}

const ACTIVE_RUN_STATUSES = new Set(['running', 'stale'])

export function countPendingApprovals(
  pending: ReadonlyMap<string, readonly unknown[]> | null | undefined,
): number {
  if (!pending) return 0
  let total = 0
  for (const requests of pending.values()) total += requests.length
  return total
}

export function countActiveRuns(
  tasks: readonly { status: string }[] | null | undefined,
): number {
  if (!tasks) return 0
  return tasks.filter((task) => ACTIVE_RUN_STATUSES.has(task.status)).length
}

export function buildStatusBarModel(input: StatusBarInput): StatusBarModel {
  let workspaceMode: WorkspaceRuntimeMode = 'local'
  if (input.transportMode === 'remote') {
    workspaceMode =
      input.transportStatus === 'connected' || input.transportStatus === 'idle' ? 'remote' : 'offline'
  }
  return {
    workspaceMode,
    syncOk: workspaceMode !== 'offline',
    runCount: input.runCount ?? 0,
    approvalCount: input.approvalCount ?? 0,
    permissionMode: input.permissionMode ?? null,
    peopleCount: input.peopleCount ?? 0,
    agentCount: input.agentCount ?? 0,
  }
}
