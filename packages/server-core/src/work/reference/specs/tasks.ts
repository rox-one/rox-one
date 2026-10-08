/** W1-06 (#1503) — Reference ops: tasks, task lists / sections / groups / statuses (TECH-SPEC §4.3). */

import { statusLifecycle } from '@rox/core/tasks/personal'
import { CommandRejection } from '@rox/core/commands'
import type { EntityRef } from '@rox/core/entities'
import type { ReferenceOp, ReferenceTx } from '../engine'
import { addLink, assoc, authorizeBound, authorizeId, authorizeOrigin, authorizeRef, authorizeTaskContainers, authorizeWorkspace, create, omit, payloadFields, refString, softDelete, transition, unassoc, update, validateLink, type Mapper } from '../ops'
import type { RecordData } from '../types'
import type { ReferenceSpecMap } from './types'

/** Defaults of a new WorkItem (v3), matching a fresh PersonalTask in the Inbox. */
export const taskDefaults: Mapper = tx => ({
  ownerPrincipalId: tx.actor,
  authority: tx.ctx.authority,
  notes: '',
  list: 'inbox',
  evening: false,
  order: Date.parse(tx.now),
  statusKey: 'pending',
  priority: 'normal',
  assigneeIds: [],
  tags: [],
})

function lifecycleFields(tx: ReferenceTx, statusKey: string): RecordData {
  const lifecycle = statusLifecycle(statusKey)
  if (lifecycle === 'done') return { statusKey, completedAt: tx.now, cancelledAt: null }
  if (lifecycle === 'canceled') return { statusKey, cancelledAt: tx.now, completedAt: null }
  return { statusKey, completedAt: null, cancelledAt: null }
}

/**
 * The origin a task is derived from is only referenced (`read`); a target of
 * its kind must be that origin. The list it lands in needs `write`.
 */
async function authorizeTaskOrigin(tx: ReferenceTx, ref: EntityRef): Promise<void> {
  await authorizeOrigin(tx, ref)
  await authorizeTaskContainers(tx, { listId: tx.payload.listId })
}

function createTaskFrom(origin: (tx: ReferenceTx) => EntityRef, map: Mapper, relation = 'derived-from') {
  const base = create('task', map, { defaults: taskDefaults })
  return async (tx: ReferenceTx) => {
    const ref = origin(tx)
    await authorizeTaskOrigin(tx, ref)
    // Everything that can fail is checked before the first (non-transactional on local) write.
    validateLink({ kind: 'task', id: tx.createId() }, ref, relation)
    await tx.assertAbsent('task', tx.createId())
    const result = await base(tx)
    await addLink(tx, { kind: 'task', id: result.id }, ref, relation, { role: 'origin' })
    return result
  }
}

const originFields = (title: (tx: ReferenceTx) => string, origin: (tx: ReferenceTx) => EntityRef): Mapper => tx => ({
  title: tx.payload.title ?? title(tx),
  ...(tx.payload.listId ? { listId: tx.payload.listId } : {}),
  ...(tx.payload.assigneeIds ? { assigneeIds: tx.payload.assigneeIds } : {}),
  ...(tx.payload.dueAt ? { dueAt: tx.payload.dueAt } : {}),
  origin: { kind: origin(tx).kind, id: origin(tx).id, ...(origin(tx).fragment ? { fragment: origin(tx).fragment } : {}) },
})

const selectionOrigin = (tx: ReferenceTx): EntityRef => ({ ...tx.payload.docRef, fragment: tx.payload.docRef.fragment ?? `block-${tx.payload.blockId}` })
const messageOrigin = (tx: ReferenceTx): EntityRef => ({ kind: 'channel-message', id: `${tx.payload.chatId}:${tx.payload.seq}` })
const mailOrigin = (tx: ReferenceTx): EntityRef => ({ kind: 'mail-thread', id: tx.payload.threadId })

/**
 * Task sections and list groups have no local store until TSK-1: on the local
 * authority they answer UNAVAILABLE (lists themselves are the PersonalTask
 * projects, see `task_lists.*`).
 */
function workspaceOnly(specs: Record<string, ReferenceOp>): Record<string, ReferenceOp> {
  return Object.fromEntries(Object.entries(specs).map(([type, op]) => [type, async (tx: ReferenceTx) => {
    if (tx.ctx.authority === 'local') throw new CommandRejection('UNAVAILABLE', `${type} is not available on the local authority yet (TSK-1)`)
    return op(tx)
  }]))
}

/** Owner of a task list → the resource its creator must be able to write (`user` lists are the actor's own). */
async function authorizeListOwner(tx: ReferenceTx): Promise<void> {
  const { ownerType, ownerId } = tx.payload
  if (ownerId === undefined) return
  if (ownerType === undefined || ownerType === 'user') {
    if (ownerId !== tx.actor) throw new CommandRejection('FORBIDDEN', 'a personal task list belongs to its creator')
    return
  }
  const kind = ownerType === 'chat' ? 'channel' : ownerType
  await authorizeBound(tx, { kind, id: ownerId } as EntityRef, 'write')
}

export const TASKS_REFERENCE_SPECS: ReferenceSpecMap = {
  'tasks.create': {
    event: 'task.task_adding',
    op: async tx => {
      // Every container the payload names needs `write`; a container-kind target is the container.
      await authorizeTaskContainers(tx, tx.payload, { bound: true })
      const listTarget = tx.targetOf('task-list')
      return create('task', t => ({ ...payloadFields()(t) as RecordData, ...(t.payload.listId === undefined && listTarget ? { listId: listTarget } : {}) }), { defaults: taskDefaults })(tx)
    },
  },
  'tasks.update': update('task'),
  'tasks.update_status': { op: transition('task', tx => lifecycleFields(tx, tx.payload.statusKey)), event: 'task.task_status_change' },
  'tasks.complete': { op: transition('task', tx => ({ statusKey: 'done', completedAt: tx.payload.completedAt ?? tx.now, cancelledAt: null })), event: 'task.task_closing' },
  'tasks.reopen': { op: transition('task', tx => ({ statusKey: 'pending', completedAt: null, cancelledAt: null, reopenedAt: tx.now })), event: 'task.task_reopening' },
  'tasks.cancel': { op: transition('task', tx => ({ statusKey: 'canceled', cancelledAt: tx.payload.cancelledAt ?? tx.now, completedAt: null })), event: 'task.task_closing' },
  'tasks.archive': transition('task', tx => ({ archivedAt: tx.payload.archived === false ? null : tx.now })),
  'tasks.delete': {
    event: 'task.task_deleting',
    op: async tx => {
      const current = await tx.requireTarget('task', { allowDeleted: true })
      if (tx.payload.hard) {
        await tx.remove('task', current.id)
        return { collection: 'task', id: current.id, changes: ['deleted'] }
      }
      const record = await tx.update('task', current, { trashedAt: tx.now, deletedAt: tx.now })
      return { collection: 'task', id: record.id, revision: record.revision, changes: ['deletedAt', 'trashedAt'] }
    },
  },
  'tasks.duplicate': {
    event: 'task.task_adding',
    op: async tx => {
      const source = await tx.requireTarget('task')
      // A copy is a new local item: no provider identity, no place in a repeat chain, no delivered reminder.
      const copy = omit(source.data, [
        'createdAt', 'updatedAt', 'createdBy', 'lastCommandId', 'completedAt', 'cancelledAt', 'reopenedAt', 'archivedAt', 'trashedAt', 'deletedAt',
        'nativeId', 'sourceStoreId', 'repeatOf', 'repeatOccurrenceAt', 'repeatNextId', 'reminderDeliveredFor', 'reminderRetryAt', 'reminderError',
      ])
      const record = await tx.insert('task', tx.createId(), { ...copy, title: tx.payload.title ?? source.data.title, statusKey: 'pending', ownerPrincipalId: tx.actor })
      await addLink(tx, { kind: 'task', id: record.id }, { kind: 'task', id: source.id }, 'derived-from', { role: 'duplicate' })
      return { collection: 'task', id: record.id, revision: record.revision, changes: ['title'], result: { sourceId: source.id } }
    },
  },
  'tasks.move': {
    event: 'task.task_moving',
    op: async tx => {
      if (tx.payload.parentId && tx.payload.parentId === tx.rawTarget?.id) throw new CommandRejection('VALIDATION', 'a task cannot be its own parent')
      await authorizeTaskContainers(tx, tx.payload)
      return update('task')(tx)
    },
  },
  'tasks.update_assignees': {
    event: 'task.task_assignee_assignment',
    op: update('task', (tx, current) => {
      const before = Array.isArray(current?.data.assigneeIds) ? (current!.data.assigneeIds as string[]) : []
      const next = tx.payload.set ? [...tx.payload.set] : [...before, ...(tx.payload.add ?? []).filter((id: string) => !before.includes(id))]
      const removed = new Set<string>(tx.payload.remove ?? [])
      return { assigneeIds: [...new Set(next)].filter(id => !removed.has(id)) }
    }),
  },
  /** Local: the per-user fields live on the PersonalTask itself; server: `work_item_user_state`. */
  'tasks.set_user_state': async tx => {
    if (tx.ctx.authority === 'local') return update('task', payloadFields())(tx)
    return assoc('task-user-state', 'task', () => tx.actor, payloadFields(), 'taskId')(tx)
  },
  'tasks.add_to_list': {
    event: 'task.task_list_added',
    op: async tx => {
      const task = await tx.requireTarget('task')
      await tx.require('task-list', tx.payload.listId)
      await authorizeTaskContainers(tx, { listId: tx.payload.listId, sectionId: tx.payload.sectionId })
      if (tx.ctx.authority === 'local') {
        // Local: a task sits in one PersonalTask project (= list); no association rows.
        const record = await tx.update('task', task, { listId: tx.payload.listId, ...(tx.payload.sectionId ? { sectionId: tx.payload.sectionId } : task.data.listId === tx.payload.listId ? {} : { sectionId: null }) })
        return { collection: 'task', id: record.id, revision: record.revision, changes: ['listId'] }
      }
      const entry = await tx.upsert('task-list-entry', `${task.id}:${tx.payload.listId}`, payloadFields()(tx) as RecordData, { taskId: task.id })
      if (!task.data.listId) await tx.update('task', task, { listId: tx.payload.listId, ...(tx.payload.sectionId ? { sectionId: tx.payload.sectionId } : {}) })
      return { collection: 'task-list-entry', id: entry.id, revision: entry.revision, ref: tx.rawTarget ?? null, changes: ['listId'] }
    },
  },
  'tasks.remove_from_list': async tx => {
    await authorizeId(tx, 'task-list', tx.payload.listId, 'write')
    if (tx.ctx.authority === 'local') {
      const task = await tx.requireTarget('task')
      if (task.data.listId !== tx.payload.listId) throw new CommandRejection('NOT_FOUND', 'the task is not in this list')
      const record = await tx.update('task', task, { listId: null, sectionId: null })
      return { collection: 'task', id: record.id, revision: record.revision, changes: ['listId'] }
    }
    const result = await unassoc('task-list-entry', 'task', t => t.payload.listId)(tx)
    const task = await tx.require('task', tx.target('task'))
    if (task.data.listId === tx.payload.listId) await tx.update('task', task, { listId: null, sectionId: null })
    return result
  },
  'tasks.share': {
    event: 'task.task_shared',
    op: async tx => {
      await authorizeWorkspace(tx, tx.payload.workspaceId)
      await authorizeId(tx, 'task-list', tx.payload.listId, 'write')
      return transition('task', t => ({ sharedWorkspaceId: t.payload.workspaceId, ...(t.payload.listId ? { listId: t.payload.listId } : {}) }))(tx)
    },
  },
  'tasks.add_dependency': async tx => {
    const task = await tx.requireTarget('task')
    const other = tx.payload.blocks ?? tx.payload.blockedBy
    await tx.require('task', other)
    if (other === task.id) throw new CommandRejection('VALIDATION', 'a task cannot depend on itself')
    // The other task is only referenced by the dependency.
    await authorizeRef(tx, { kind: 'task', id: other }, 'read')
    const [from, to] = tx.payload.blocks ? [task.id, other] : [other, task.id]
    const link = await addLink(tx, { kind: 'task', id: from }, { kind: 'task', id: to }, 'blocks')
    return { collection: 'entity-link', id: link.id, revision: link.revision, ref: tx.rawTarget ?? null, changes: ['blocks'] }
  },
  'tasks.update_reminders': update('task'),
  'task_lists.create': async tx => {
    if (tx.ctx.authority === 'local' && tx.payload.ownerType !== undefined && tx.payload.ownerType !== 'user') {
      throw new CommandRejection('VALIDATION', 'local task lists are personal (ownerType user)')
    }
    await authorizeListOwner(tx)
    await authorizeId(tx, 'task-list-group', tx.payload.groupId, 'write')
    return create('task-list', payloadFields(), { defaults: tx => ({ ownerType: 'user', ownerId: tx.actor, sortKey: 'a0', statusSetEnabled: false }) })(tx)
  },
  'task_lists.update': async tx => {
    // v2 project.completedAt is the archive state: a local list is completed with task_lists.archive.
    if (tx.ctx.authority === 'local' && tx.payload.completedAt !== undefined) throw new CommandRejection('VALIDATION', 'completedAt is set with task_lists.archive on the local authority')
    await authorizeId(tx, 'task-list-group', tx.payload.groupId, 'write')
    return update('task-list')(tx)
  },
  'task_lists.archive': transition('task-list', tx => ({ archivedAt: tx.payload.archived === false ? null : tx.now })),
  'task_lists.delete': softDelete('task-list'),
  ...workspaceOnly({
    'task_sections.create': async tx => {
      await tx.require('task-list', tx.payload.taskListId)
      return create('task-section', payloadFields(), { defaults: () => ({ sortKey: 'a0' }), container: { kind: 'task-list', field: 'taskListId' } })(tx)
    },
    'task_sections.update': update('task-section'),
    'task_sections.move': async tx => {
      if (tx.payload.taskListId) await tx.require('task-list', tx.payload.taskListId)
      await authorizeId(tx, 'task-list', tx.payload.taskListId, 'write')
      return update('task-section')(tx)
    },
    'task_sections.delete': softDelete('task-section'),
    'task_list_groups.create': create('task-list-group', payloadFields(), { defaults: tx => ({ principalId: tx.actor, sortKey: 'a0', collapsed: false }) }),
    'task_list_groups.update': update('task-list-group'),
    'task_list_groups.delete': softDelete('task-list-group'),
  }),
  /** Status set per owner (target list / project / space, or the workspace default). */
  'task_statuses.update_set': async tx => {
    const target = tx.rawTarget
    const owner = target ? `${target.kind}:${target.id}` : 'workspace'
    const row = await tx.upsert('task-status-set', owner, { statuses: tx.payload.statuses }, { ownerType: target?.kind ?? 'workspace', ownerId: target?.id ?? tx.ctx.workspaceId })
    return { collection: 'task-status-set', id: row.id, revision: row.revision, ref: target ?? null, changes: ['statuses'] }
  },
  'tasks.create_from_selection': { op: createTaskFrom(selectionOrigin, originFields(tx => tx.payload.text, selectionOrigin)), event: 'task.task_adding' },
  'tasks.create_many_from_checklist': {
    event: 'task.task_adding',
    op: async tx => {
      await authorizeTaskOrigin(tx, tx.payload.docRef as EntityRef)
      const items = (tx.payload.items as Array<{ blockId: string; text: string }>).map((item, index) => ({
        item, id: tx.newId(`item-${index}`), origin: { ...tx.payload.docRef, fragment: `block-${item.blockId}` } as EntityRef,
      }))
      // Validate every item before the first write.
      for (const { id, origin } of items) validateLink({ kind: 'task', id }, origin, 'derived-from')
      await tx.assertAbsent('task', ...items.map(entry => entry.id))
      const ids: string[] = []
      for (const { item, id, origin } of items) {
        await tx.insert('task', id, { ...(await taskDefaults(tx)), title: item.text, ...(tx.payload.listId ? { listId: tx.payload.listId } : {}), origin: { kind: origin.kind, id: origin.id, fragment: origin.fragment } })
        await addLink(tx, { kind: 'task', id }, origin, 'derived-from', { role: 'origin' })
        ids.push(id)
      }
      return { collection: 'task', id: ids[0]!, ref: { kind: 'task', id: ids[0]! }, result: { ids }, changes: ['title'] }
    },
  },
  'tasks.create_from_message': { op: createTaskFrom(messageOrigin, originFields(tx => refString(messageOrigin(tx)), messageOrigin)), event: 'task.task_adding' },
  'tasks.create_from_email': { op: createTaskFrom(mailOrigin, originFields(tx => refString(mailOrigin(tx)), mailOrigin)), event: 'task.task_adding' },
}
