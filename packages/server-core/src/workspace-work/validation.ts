import { z } from 'zod'
import { CodedError } from '@rox/shared/protocol'
import { WORKSPACE_TASK_STATUSES } from '@rox/shared/workspace-work'
import type { WorkspaceWorkState, WorkspaceWorkWrite, WorkspaceWorkDelete } from '@rox/shared/workspace-work'

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/)
const text = (max: number) => z.string().trim().min(1).max(max).refine(value => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))
const time = z.number().int().min(0).max(8_640_000_000_000_000)
const revision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const ref = z.object({ workspaceId: id, id }).strict()
const link = ref.extend({ kind: z.enum(['task', 'project', 'session', 'page', 'meeting', 'note', 'automation']), anchor: id.optional() }).strict()
  .refine(value => value.anchor === undefined || value.kind === 'meeting')
const profileInput = z.object({ name: text(120), role: text(4000),
  sourceSlugs: z.array(id).max(100).refine(a => new Set(a).size === a.length),
  skillSlugs: z.array(id).max(100).refine(a => new Set(a).size === a.length),
  memoryScope: z.enum(['none', 'workspace']).optional(), automationEnabled: z.boolean().optional() }).strict()
const taskInput = z.object({ title: text(500), description: z.string().max(20_000).optional(),
  status: z.enum(WORKSPACE_TASK_STATUSES).optional(), assigneeId: id.nullable().optional(),
  project: ref.nullable().optional(), dueAt: time.nullable().optional(), links: z.array(link).max(100).optional() }).strict()
const blockInput = z.object({ taskId: id, startAt: time, endAt: time }).strict()
const base = { expectedRevision: revision }
const writeSchema = z.discriminatedUnion('kind', [
  z.object({ ...base, kind: z.literal('createTask'), input: taskInput }).strict(),
  z.object({ ...base, kind: z.literal('updateTask'), id, patch: taskInput.partial() }).strict(),
  z.object({ ...base, kind: z.literal('commentTask'), taskId: id, text: text(10_000) }).strict(),
  z.object({ ...base, kind: z.literal('createProfile'), input: profileInput }).strict(),
  z.object({ ...base, kind: z.literal('updateProfile'), id, patch: profileInput.partial() }).strict(),
  z.object({ ...base, kind: z.literal('setDefaultProfile'), profileId: id.nullable() }).strict(),
  z.object({ ...base, kind: z.literal('createWorkBlock'), input: blockInput }).strict(),
  z.object({ ...base, kind: z.literal('updateWorkBlock'), id, patch: blockInput.partial() }).strict(),
])
const deleteSchema = z.object({ ...base, kind: z.enum(['task', 'profile', 'workBlock']), id }).strict()
const common = { id, workspaceId: id, revision, createdAt: time, updatedAt: time }
const stateSchema = z.object({ schemaVersion: z.literal(1), workspaceId: id, revision,
  defaultProfileId: id.nullable(),
  profiles: z.array(profileInput.extend({ ...common, ownerId: id, memoryScope: z.enum(['none', 'workspace']), automationEnabled: z.boolean() }).strict()),
  tasks: z.array(taskInput.extend({ ...common, authorId: id, description: z.string().max(20_000), status: z.enum(WORKSPACE_TASK_STATUSES),
    assigneeId: id.nullable(), project: ref.nullable(), dueAt: time.nullable(), links: z.array(link).max(100) }).strict()),
  comments: z.array(z.object({ id, workspaceId: id, taskId: id, authorId: id, text: text(10_000), createdAt: time }).strict()),
  workBlocks: z.array(blockInput.extend({ ...common, authorId: id }).strict()),
  tombstones: z.array(z.object({ id, workspaceId: id, kind: z.enum(['task', 'profile', 'workBlock']), deletedBy: id, deletedAt: time,
    originLinks: z.array(link).max(100).optional() }).strict()),
}).strict()

function parse<T>(schema: z.ZodType, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) throw new CodedError('INVALID_PAYLOAD', 'Invalid workspace work payload')
  return result.data as T
}
export function parseWorkspaceWorkWrite(value: unknown): WorkspaceWorkWrite { return parse(writeSchema, value) }
export function parseWorkspaceWorkDelete(value: unknown): WorkspaceWorkDelete { return parse(deleteSchema, value) }
export function validateWorkspaceId(value: unknown): string { return parse(id, value) }
export function validateEntityId(value: unknown): string { return parse(id, value) }
export function validateWorkspaceWorkState(value: unknown, workspaceId: string): WorkspaceWorkState {
  const state = parse<WorkspaceWorkState>(stateSchema, value)
  if (state.workspaceId !== workspaceId) throw new CodedError('WORKSPACE_MISMATCH', 'Workspace mismatch')
  const entities = [...state.profiles, ...state.tasks, ...state.comments, ...state.workBlocks, ...state.tombstones]
  const origins = [...state.tasks.flatMap(task => task.links), ...state.tombstones.flatMap(tombstone => tombstone.originLinks ?? [])]
    .filter(link => link.kind === 'meeting' && link.anchor).map(link => JSON.stringify([link.workspaceId, link.id, link.anchor]))
  if (entities.some(entity => entity.workspaceId !== workspaceId) ||
    new Set(entities.map(entity => entity.id)).size !== entities.length ||
    state.tasks.some(task => (task.project && task.project.workspaceId !== workspaceId) || task.links.some(link => link.workspaceId !== workspaceId)) ||
    state.tombstones.some(tombstone => tombstone.originLinks && (tombstone.kind !== 'task' || tombstone.originLinks.some(link => link.workspaceId !== workspaceId || link.kind !== 'meeting' || !link.anchor))) ||
    new Set(origins).size !== origins.length ||
    state.workBlocks.some(block => block.endAt <= block.startAt || !state.tasks.some(task => task.id === block.taskId)) ||
    state.comments.some(comment => !state.tasks.some(task => task.id === comment.taskId)) ||
    (state.defaultProfileId !== null && !state.profiles.some(profile => profile.id === state.defaultProfileId))) {
    throw new CodedError('INVALID_PAYLOAD', 'Invalid workspace work state')
  }
  return state
}
