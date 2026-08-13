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
