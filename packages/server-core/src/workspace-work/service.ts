import { randomUUID } from 'node:crypto'
import { CodedError } from '@rox/shared/protocol'
import { workBlockConflicts } from '@rox/shared/workspace-work'
import type { AgentProfile, AgentProfileInput, AgentProfileSnapshot, WorkspaceTask, WorkspaceTaskInput,
  WorkspaceTaskLink, WorkspaceWorkAccess, WorkspaceWorkResult, WorkspaceWorkSnapshot, WorkspaceWorkState, WorkBlockInput } from '@rox/shared/workspace-work'
import { WorkspaceWorkStore } from './store.ts'
import { parseWorkspaceWorkDelete, parseWorkspaceWorkWrite, validateEntityId } from './validation.ts'

/** These capabilities are server-composed; they are never parsed from the request. */
export interface WorkspaceWorkActor extends WorkspaceWorkAccess {
  assertCurrent(action: 'read' | 'write' | 'delete'): void
}
export interface WorkspaceWorkCatalog {
  members(): Array<{ id: string; name: string }>
  hasMember(id: string): boolean
  hasProject(id: string): boolean
  hasSource(slug: string): boolean
  hasSkill(slug: string): boolean
  hasReference(link: WorkspaceTaskLink): boolean
}
function forbidden(): never { throw new CodedError('FORBIDDEN', 'Workspace work action denied') }
function missing(): never { throw new CodedError('NOT_FOUND', 'Workspace work entity unavailable') }
function taskEditor(actor: WorkspaceWorkActor, task: WorkspaceTask): boolean {
  return actor.canManage || actor.actorId === task.authorId || actor.actorId === task.assigneeId
}
function profileEditor(actor: WorkspaceWorkActor, profile: AgentProfile): boolean {
  return actor.canManage || actor.actorId === profile.ownerId
}
function sameMeetingOrigin(left: WorkspaceTaskLink, right: WorkspaceTaskLink): boolean {
  return left.kind === 'meeting' && !!left.anchor && right.kind === 'meeting' && left.anchor === right.anchor &&
    left.id === right.id && left.workspaceId === right.workspaceId
}
function sameTaskLink(left: WorkspaceTaskLink, right: WorkspaceTaskLink): boolean {
  return left.kind === right.kind && left.workspaceId === right.workspaceId && left.id === right.id && left.anchor === right.anchor
}

export class WorkspaceWorkService {
  constructor(readonly store: WorkspaceWorkStore, readonly catalog: WorkspaceWorkCatalog) {}
  private projection(state: WorkspaceWorkState, actor: WorkspaceWorkActor): WorkspaceWorkSnapshot {
    return { ...structuredClone(state), access: { actorId: actor.actorId, canWrite: actor.canWrite,
      canDelete: actor.canDelete, canManage: actor.canManage }, members: this.catalog.members(), conflicts: workBlockConflicts(state) }
  }
  read(actor: WorkspaceWorkActor): WorkspaceWorkSnapshot {
    actor.assertCurrent('read')
    return this.projection(this.store.read(), actor)
  }
  snapshotProfile(actor: WorkspaceWorkActor, profileId?: string): AgentProfileSnapshot | null {
    actor.assertCurrent('read')
    const state = this.store.read()
    const id = profileId === undefined ? state.defaultProfileId : validateEntityId(profileId)
    if (!id) return null
    const profile = state.profiles.find(profile => profile.id === id) ?? missing()
    this.validateProfile(profile)
    return { profileId: profile.id, workspaceId: profile.workspaceId, revision: profile.revision,
      name: profile.name, role: profile.role, sourceSlugs: [...profile.sourceSlugs], skillSlugs: [...profile.skillSlugs],
      memoryScope: profile.memoryScope, automationEnabled: profile.automationEnabled, capturedAt: Date.now() }
  }
  private validateProfile(input: AgentProfileInput): void {
    if (input.sourceSlugs.some(slug => !this.catalog.hasSource(slug)) || input.skillSlugs.some(slug => !this.catalog.hasSkill(slug))) missing()
  }
  private validateTask(input: WorkspaceTaskInput, state: WorkspaceWorkState): void {
    if (input.assigneeId && !this.catalog.hasMember(input.assigneeId)) missing()
    if (input.project) {
      if (input.project.workspaceId !== this.store.workspaceId) throw new CodedError('WORKSPACE_MISMATCH', 'Workspace mismatch')
      if (!this.catalog.hasProject(input.project.id)) missing()
    }
    for (const link of input.links ?? []) {
      if (link.workspaceId !== this.store.workspaceId) throw new CodedError('WORKSPACE_MISMATCH', 'Workspace mismatch')
      if (link.kind === 'task' ? !state.tasks.some(task => task.id === link.id) : !this.catalog.hasReference(link)) missing()
    }
  }
  private validateBlock(input: WorkBlockInput, state: WorkspaceWorkState, actor: WorkspaceWorkActor): WorkspaceTask {
    if (input.endAt <= input.startAt) throw new CodedError('INVALID_PAYLOAD', 'Work block must end after its start')
    const task = state.tasks.find(task => task.id === input.taskId) ?? missing()
    if (!taskEditor(actor, task)) forbidden()
    return task
  }
  write(actor: WorkspaceWorkActor, value: unknown): WorkspaceWorkResult {
    const command = parseWorkspaceWorkWrite(value)
    if (!actor.canWrite) forbidden()
    const committed = this.store.commit(command.expectedRevision, state => {
      const now = Date.now()
      switch (command.kind) {
        case 'createProfile': {
          this.validateProfile(command.input)
          const profile: AgentProfile = { ...command.input, id: `profile_${randomUUID()}`, workspaceId: state.workspaceId,
            ownerId: actor.actorId, revision: 1, memoryScope: command.input.memoryScope ?? 'workspace',
            automationEnabled: command.input.automationEnabled ?? false, createdAt: now, updatedAt: now }
          state.profiles.push(profile)
          return profile.id
        }
        case 'updateProfile': {
          const profile = state.profiles.find(profile => profile.id === command.id) ?? missing()
          if (!profileEditor(actor, profile)) forbidden()
          this.validateProfile({ ...profile, ...command.patch })
          Object.assign(profile, command.patch, { updatedAt: now, revision: profile.revision + 1 })
          return profile.id
        }
        case 'setDefaultProfile': {
          if (!actor.canManage) forbidden()
          if (command.profileId && !state.profiles.some(profile => profile.id === command.profileId)) missing()
          state.defaultProfileId = command.profileId
          return command.profileId ?? state.workspaceId
        }
        case 'createTask': {
          this.validateTask(command.input, state)
          const origins = (command.input.links ?? []).filter(link => link.kind === 'meeting' && link.anchor)
          const existing = state.tasks.find(task => origins.some(origin => task.links.some(link => sameMeetingOrigin(origin, link))))
          if (existing) return existing.id
          if (state.tombstones.some(tombstone => origins.some(origin => tombstone.originLinks?.some(link => sameMeetingOrigin(origin, link))))) missing()
          const task: WorkspaceTask = { id: `task_${randomUUID()}`, workspaceId: state.workspaceId, authorId: actor.actorId,
            assigneeId: command.input.assigneeId ?? null, title: command.input.title, description: command.input.description ?? '',
            status: command.input.status ?? 'todo', project: command.input.project ?? null, dueAt: command.input.dueAt ?? null,
            links: command.input.links ?? [], revision: 1, createdAt: now, updatedAt: now }
          state.tasks.push(task)
          return task.id
        }
        case 'updateTask': {
          const task = state.tasks.find(task => task.id === command.id) ?? missing()
          if (!taskEditor(actor, task)) forbidden()
          if (command.patch.links) {
            const origins = task.links.filter(link => link.kind === 'meeting' && link.anchor)
            if (origins.some(origin => !command.patch.links!.some(link => sameMeetingOrigin(origin, link))) ||
              command.patch.links.some(link => link.kind === 'meeting' && link.anchor &&
                (state.tasks.some(other => other.id !== task.id && other.links.some(origin => sameMeetingOrigin(origin, link))) ||
                 state.tombstones.some(tombstone => tombstone.originLinks?.some(origin => sameMeetingOrigin(origin, link)))))) {
              throw new CodedError('INVALID_PAYLOAD', 'Meeting action task origin cannot be retargeted')
            }
          }
          // A retained association may outlive its provider or source. Verify
          // availability only for a new selection, while the canonical schema,
          // workspace and immutable meeting origins remain enforced above.
          const patch = command.patch
          this.validateTask({ title: patch.title ?? task.title,
            ...(patch.assigneeId !== undefined && patch.assigneeId !== task.assigneeId ? { assigneeId: patch.assigneeId } : {}),
            ...(patch.project !== undefined && (patch.project?.workspaceId !== task.project?.workspaceId || patch.project?.id !== task.project?.id) ? { project: patch.project } : {}),
            links: (patch.links ?? []).filter(link => !task.links.some(current => sameTaskLink(current, link))),
          }, state)
          Object.assign(task, command.patch, { updatedAt: now, revision: task.revision + 1 })
          return task.id
        }
        case 'commentTask': {
          if (!state.tasks.some(task => task.id === command.taskId)) missing()
          const id = `comment_${randomUUID()}`
          state.comments.push({ id, workspaceId: state.workspaceId, taskId: command.taskId, authorId: actor.actorId, text: command.text, createdAt: now })
          return id
        }
        case 'createWorkBlock': {
          this.validateBlock(command.input, state, actor)
          const id = `block_${randomUUID()}`
          state.workBlocks.push({ ...command.input, id, workspaceId: state.workspaceId, authorId: actor.actorId, revision: 1, createdAt: now, updatedAt: now })
          return id
        }
        case 'updateWorkBlock': {
          const block = state.workBlocks.find(block => block.id === command.id) ?? missing()
          this.validateBlock(block, state, actor)
          this.validateBlock({ ...block, ...command.patch }, state, actor)
          Object.assign(block, command.patch, { updatedAt: now, revision: block.revision + 1 })
          return block.id
        }
      }
    }, () => actor.assertCurrent('write'))
    return { snapshot: this.projection(committed.state, actor), receipt: committed.receipt }
  }
  delete(actor: WorkspaceWorkActor, value: unknown): WorkspaceWorkResult {
    const command = parseWorkspaceWorkDelete(value)
    if (!actor.canDelete) forbidden()
    const committed = this.store.commit(command.expectedRevision, state => {
      const deletedAt = Date.now()
      const tombstone = (kind: 'task' | 'profile' | 'workBlock', id: string, originLinks?: WorkspaceTaskLink[]) => state.tombstones.push({ kind, id,
        workspaceId: state.workspaceId, deletedAt, deletedBy: actor.actorId, ...(originLinks?.length ? { originLinks } : {}) })
      let taskOriginLinks: WorkspaceTaskLink[] | undefined
      if (command.kind === 'task') {
        const task = state.tasks.find(task => task.id === command.id) ?? missing()
        if (!taskEditor(actor, task)) forbidden()
        taskOriginLinks = task.links.filter(link => link.kind === 'meeting' && link.anchor)
        state.tasks = state.tasks.filter(task => task.id !== command.id)
        for (const block of state.workBlocks.filter(block => block.taskId === command.id)) tombstone('workBlock', block.id)
        state.workBlocks = state.workBlocks.filter(block => block.taskId !== command.id)
        state.comments = state.comments.filter(comment => comment.taskId !== command.id)
        // References remain typed links to a tombstoned entity; do not silently retarget them.
      } else if (command.kind === 'profile') {
        const profile = state.profiles.find(profile => profile.id === command.id) ?? missing()
        if (!profileEditor(actor, profile)) forbidden()
        if (state.defaultProfileId === command.id && !actor.canManage) forbidden()
        state.profiles = state.profiles.filter(profile => profile.id !== command.id)
        if (state.defaultProfileId === command.id) state.defaultProfileId = null
      } else {
        const block = state.workBlocks.find(block => block.id === command.id) ?? missing()
        this.validateBlock(block, state, actor)
        state.workBlocks = state.workBlocks.filter(block => block.id !== command.id)
      }
      tombstone(command.kind, command.id, taskOriginLinks)
      return command.id
    }, () => actor.assertCurrent('delete'))
    return { snapshot: this.projection(committed.state, actor), receipt: committed.receipt }
  }
}
