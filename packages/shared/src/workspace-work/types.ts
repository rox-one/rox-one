/** Workspace-owned work. PersonalTask remains a separate personal namespace. */
export const WORKSPACE_TASK_STATUSES = ['backlog', 'todo', 'in-progress', 'needs-review', 'done', 'canceled'] as const
export type WorkspaceTaskStatus = (typeof WORKSPACE_TASK_STATUSES)[number]
export interface WorkspaceEntityRef { workspaceId: string; id: string }
export interface WorkspaceTaskLink extends WorkspaceEntityRef {
  kind: 'task' | 'project' | 'session' | 'page' | 'meeting' | 'note' | 'automation'
  /** Canonical action ID when this is a meeting action origin. */
  anchor?: string
}
export interface AgentProfileInput {
  name: string
  role: string
  sourceSlugs: string[]
  skillSlugs: string[]
  memoryScope?: 'none' | 'workspace'
  automationEnabled?: boolean
}
export interface AgentProfile extends AgentProfileInput {
  id: string
  workspaceId: string
  ownerId: string
  revision: number
  memoryScope: 'none' | 'workspace'
  automationEnabled: boolean
  createdAt: number
  updatedAt: number
}
/** Captured once when a new dialog is created; later profile edits do not retarget it. */
export interface AgentProfileSnapshot {
  profileId: string
  workspaceId: string
  revision: number
  name: string
  role: string
  sourceSlugs: string[]
  skillSlugs: string[]
  memoryScope: 'none' | 'workspace'
  automationEnabled: boolean
  capturedAt: number
}
export interface WorkspaceTaskInput {
  title: string
  description?: string
  status?: WorkspaceTaskStatus
  assigneeId?: string | null
  project?: WorkspaceEntityRef | null
  dueAt?: number | null
  links?: WorkspaceTaskLink[]
}
export interface WorkspaceTask {
  id: string
  workspaceId: string
  authorId: string
  assigneeId: string | null
  title: string
  description: string
  status: WorkspaceTaskStatus
  project: WorkspaceEntityRef | null
  dueAt: number | null
  links: WorkspaceTaskLink[]
  revision: number
  createdAt: number
  updatedAt: number
}
export interface WorkspaceTaskComment {
  id: string
  workspaceId: string
  taskId: string
  authorId: string
  text: string
  createdAt: number
}
export interface WorkBlockInput { taskId: string; startAt: number; endAt: number }
export interface WorkBlock extends WorkBlockInput {
  id: string
  workspaceId: string
  authorId: string
  revision: number
  createdAt: number
  updatedAt: number
}
export interface WorkBlockConflict {
  firstBlockId: string
  secondBlockId: string
  assigneeId: string
  startAt: number
  endAt: number
}
export interface WorkspaceWorkTombstone {
  kind: 'task' | 'profile' | 'workBlock'
  id: string
  workspaceId: string
  deletedBy: string
  deletedAt: number
  /** Retains stable meeting origins so an unknown-result retry cannot resurrect deleted work. */
  originLinks?: WorkspaceTaskLink[]
}
export interface WorkspaceWorkState {
  schemaVersion: 1
  workspaceId: string
  revision: number
  defaultProfileId: string | null
  profiles: AgentProfile[]
  tasks: WorkspaceTask[]
  comments: WorkspaceTaskComment[]
  workBlocks: WorkBlock[]
  tombstones: WorkspaceWorkTombstone[]
}
export interface WorkspaceWorkAccess {
  actorId: string
  canWrite: boolean
  canDelete: boolean
  canManage: boolean
}
export interface WorkspaceWorkSnapshot extends WorkspaceWorkState {
  access: WorkspaceWorkAccess
  members: Array<{ id: string; name: string }>
  conflicts: WorkBlockConflict[]
}
export interface WorkspaceWorkReceipt {
  id: string
  workspaceId: string
  entityId: string
  revision: number
  sha256: string
  verifiedAt: number
}
export interface WorkspaceWorkResult {
  snapshot: WorkspaceWorkSnapshot
  receipt: WorkspaceWorkReceipt
}
/** expectedRevision is the snapshot revision (not the entity revision). */
export type WorkspaceWorkWrite = { expectedRevision: number } & (
  | { kind: 'createTask'; input: WorkspaceTaskInput }
  | { kind: 'updateTask'; id: string; patch: Partial<WorkspaceTaskInput> }
  | { kind: 'commentTask'; taskId: string; text: string }
  | { kind: 'createProfile'; input: AgentProfileInput }
  | { kind: 'updateProfile'; id: string; patch: Partial<AgentProfileInput> }
  | { kind: 'setDefaultProfile'; profileId: string | null }
  | { kind: 'createWorkBlock'; input: WorkBlockInput }
  | { kind: 'updateWorkBlock'; id: string; patch: Partial<WorkBlockInput> }
)
export interface WorkspaceWorkDelete {
  expectedRevision: number
  kind: 'task' | 'profile' | 'workBlock'
  id: string
}
