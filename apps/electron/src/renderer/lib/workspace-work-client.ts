import type {
  AgentProfileSnapshot, WorkspaceWorkDelete, WorkspaceWorkResult, WorkspaceWorkSnapshot, WorkspaceWorkWrite,
} from '@rox/shared/workspace-work'

export interface WorkspaceWorkApi {
  workspaceWorkRead(workspaceId: string): Promise<WorkspaceWorkSnapshot>
  workspaceWorkWrite(workspaceId: string, input: WorkspaceWorkWrite): Promise<WorkspaceWorkResult>
  workspaceWorkDelete(workspaceId: string, input: WorkspaceWorkDelete): Promise<WorkspaceWorkResult>
  workspaceWorkSnapshotProfile(workspaceId: string, profileId?: string): Promise<AgentProfileSnapshot | null>
  onWorkspaceWorkChanged(callback: (workspaceId: string, revision: number) => void): () => void
}

export type WorkspaceWorkMutation = WorkspaceWorkWrite extends infer Write
  ? Write extends WorkspaceWorkWrite ? Omit<Write, 'expectedRevision'> : never : never
export type WorkspaceWorkRemoval = Omit<WorkspaceWorkDelete, 'expectedRevision'>
export type WorkspaceWorkErrorCode = 'unavailable' | 'conflict' | 'forbidden' | 'validation' | 'failed'

export function localDateTimeInput(at: number | null | undefined): string {
  if (at === null || at === undefined || !Number.isFinite(at)) return ''
  const date = new Date(at)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

export function parseLocalDateTime(value: string): number | null {
  if (!value.trim()) return null
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.getTime() : null
}

export type WorkspaceProjectOption = { id: string; name: string }

/** The legacy project transport is unknown; expose only named items from this workspace. */
export function workspaceProjectOptions(value: unknown, workspaceId: string): WorkspaceProjectOption[] {
  if (!Array.isArray(value)) throw new WorkspaceWorkClientError('failed', 'Project catalog was not a list')
  return value.flatMap((item: unknown) => {
    if (!item || typeof item !== 'object' || !('workspaceId' in item) || item.workspaceId !== workspaceId || !('config' in item)) return []
    const config = item.config
    if (!config || typeof config !== 'object' || !('id' in config) || typeof config.id !== 'string' || !('name' in config) || typeof config.name !== 'string') return []
    return [{ id: config.id, name: config.name }]
  })
}

export class WorkspaceWorkClientError extends Error {
  constructor(readonly code: WorkspaceWorkErrorCode, message: string) { super(message); this.name = 'WorkspaceWorkClientError' }
}

export function workspaceWorkFailure(error: unknown): { code: WorkspaceWorkErrorCode; message: string } {
  if (error instanceof WorkspaceWorkClientError) return { code: error.code, message: error.message }
  const message = error instanceof Error ? error.message : String(error)
  const value = `${typeof error === 'object' && error !== null && 'code' in error ? error.code : ''} ${message}`.toLowerCase()
  if (/revision|conflict|stale/.test(value)) return { code: 'conflict', message }
  if (/forbidden|permission|denied|read.only|unauthori|access/.test(value)) return { code: 'forbidden', message }
  if (/invalid|required|unknown|not.found|empty|validation|too.long|catalog/.test(value)) return { code: 'validation', message }
  if (/unavailable|not.connected|offline|connection|transport/.test(value)) return { code: 'unavailable', message }
  return { code: 'failed', message }
}

function validateWorkspace(snapshot: WorkspaceWorkSnapshot, workspaceId: string): WorkspaceWorkSnapshot {
  if (!snapshot || snapshot.workspaceId !== workspaceId || !Number.isSafeInteger(snapshot.revision)) {
    throw new WorkspaceWorkClientError('failed', 'Workspace response did not match the requested scope')
  }
  return snapshot
}

/** Uses the canonical host API. There is no renderer persistence or fallback state. */
export class WorkspaceWorkClient {
  constructor(private readonly api: WorkspaceWorkApi, readonly workspaceId: string) {}

  async read(): Promise<WorkspaceWorkSnapshot> {
    return validateWorkspace(await this.api.workspaceWorkRead(this.workspaceId), this.workspaceId)
  }

  async write(revision: number, input: WorkspaceWorkMutation): Promise<WorkspaceWorkResult> {
    const result = await this.api.workspaceWorkWrite(this.workspaceId, { ...input, expectedRevision: revision } as WorkspaceWorkWrite)
    validateWorkspace(result.snapshot, this.workspaceId)
    return result
  }

  async remove(revision: number, input: WorkspaceWorkRemoval): Promise<WorkspaceWorkResult> {
    const result = await this.api.workspaceWorkDelete(this.workspaceId, { ...input, expectedRevision: revision })
    validateWorkspace(result.snapshot, this.workspaceId)
    return result
  }

  async snapshotProfile(profileId?: string): Promise<AgentProfileSnapshot | null> {
    const snapshot = await this.api.workspaceWorkSnapshotProfile(this.workspaceId, profileId)
    if (snapshot && snapshot.workspaceId !== this.workspaceId) throw new WorkspaceWorkClientError('failed', 'Profile response did not match the requested workspace')
    return snapshot
  }

  subscribe(callback: (revision: number) => void): () => void {
    return this.api.onWorkspaceWorkChanged((workspaceId, revision) => {
      if (workspaceId === this.workspaceId) callback(revision)
    })
  }
}

export function getWorkspaceWorkClient(workspaceId: string): WorkspaceWorkClient {
  const api = typeof window !== 'undefined' ? window.electronAPI as unknown as Partial<WorkspaceWorkApi> : undefined
  if (!api || ['workspaceWorkRead', 'workspaceWorkWrite', 'workspaceWorkDelete', 'workspaceWorkSnapshotProfile', 'onWorkspaceWorkChanged']
    .some(method => typeof api[method as keyof WorkspaceWorkApi] !== 'function')) {
    throw new WorkspaceWorkClientError('unavailable', 'Workspace work is unavailable in this runtime')
  }
  return new WorkspaceWorkClient(api as WorkspaceWorkApi, workspaceId)
}
