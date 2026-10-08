/** W1-06 (#1503) — Reference ops: goals & OKR, check-ins, projects, milestones, reviews, spaces, KPIs. */

import { CommandRejection } from '@rox/core/commands'
import type { ReferenceTx } from '../engine'
import {
  addLink, assoc, childCreate, childDelete, childUpdate, create, omit, patchMany, payloadFields, removeLink, requireChild,
  softDelete, targetRef, transition, unassoc, update, type Mapper,
} from '../ops'
import type { ReferenceOutcome } from '../engine'
import type { RecordData } from '../types'
import type { ReferenceSpecMap } from './types'

const sortDefault = () => ({ sortKey: 'a0' })

/** Check-in on the target goal / project (TECH-SPEC §4.9); updates the subject's summary fields. */
function createCheckIn(subjectType: 'goal' | 'project') {
  return async (tx: ReferenceTx): Promise<ReferenceOutcome> => {
    const subject = await tx.requireTarget(subjectType)
    const p = tx.payload
    const id = tx.createId()
    const state = p.state ?? 'published'
    const record = await tx.insert('check-in', id, {
      subjectType, subjectId: subject.id, authorId: tx.actor, status: p.status, message: p.message,
      ...(p.targetValues ? { targetSnapshot: p.targetValues } : {}), ...(p.checkValues ? { checkSnapshot: p.checkValues } : {}),
      ...(p.dueDateChange ? { dueDateChange: { from: subject.data.dueOn ?? null, ...p.dueDateChange } } : {}),
      source: p.source ?? 'form', state, notify: p.notify ?? 'everyone', ...(p.notifyIds ? { notifyIds: p.notifyIds } : {}),
      ...(p.scheduledAt ? { scheduledAt: p.scheduledAt } : {}), ...(state === 'published' ? { publishedAt: tx.now } : {}),
    })
    if (subjectType === 'goal') {
      for (const { targetId, value } of (p.targetValues ?? []) as Array<{ targetId: string; value: number | null }>) {
        const target = await tx.get('goal-target', targetId)
        if (target?.data.goalId === subject.id) await tx.update('goal-target', target, { value, measuredAt: tx.now })
      }
      for (const { checkId, done } of (p.checkValues ?? []) as Array<{ checkId: string; done: boolean }>) {
        const check = await tx.get('goal-check', checkId)
        if (check?.data.goalId === subject.id) await tx.update('goal-check', check, { done, doneAt: done ? tx.now : null, doneBy: done ? tx.actor : null })
      }
    }
    if (state === 'published') {
      await tx.update(subjectType, await tx.require(subjectType, subject.id), {
        lastCheckInId: id, lastCheckInStatus: p.status, ...(p.dueDateChange ? { [subjectType === 'goal' ? 'dueOn' : 'deadline']: p.dueDateChange.to } : {}),
      })
    }
    return { collection: 'check-in', id, revision: record.revision, changes: ['status', 'message'] }
  }
}

const acknowledge: Mapper = tx => ({ acknowledgedBy: tx.actor, acknowledgedAt: tx.now })

function createGoal(tx: ReferenceTx): Promise<ReferenceOutcome> {
  return (async () => {
    const p = tx.payload
    const id = tx.createId()
    if (p.parentGoalId) await tx.require('goal', p.parentGoalId)
    if (p.okrCycleId) await tx.require('okr-cycle', p.okrCycleId)
    const data = omit(p, ['id', 'targets', 'checks'])
    const targets = ((p.targets ?? []) as RecordData[]).map((target, index) => ({ id: (target.id as string | undefined) ?? tx.newId(`target-${index}`), target, index }))
    const checks = ((p.checks ?? []) as RecordData[]).map((check, index) => ({ id: (check.id as string | undefined) ?? tx.newId(`check-${index}`), check, index }))
    // Validate every id before the first write (local writes are not transactional).
    await tx.assertAbsent('goal', id)
    await tx.assertAbsent('goal-target', ...targets.map(t => t.id))
    await tx.assertAbsent('goal-check', ...checks.map(c => c.id))
    if (new Set(targets.map(t => t.id)).size !== targets.length || new Set(checks.map(c => c.id)).size !== checks.length) throw new CommandRejection('VALIDATION', 'duplicate target / check id')
    const record = await tx.insert('goal', id, { scope: p.spaceId ? 'space' : 'company', goalKind: p.okrCycleId ? 'objective' : 'goal', publishState: 'published', creatorId: tx.actor, ...data })
    for (const { id: targetId, target, index } of targets) await tx.insert('goal-target', targetId, { ...omit(target, ['id']), goalId: id, sortKey: `a${index}` })
    for (const { id: checkId, check, index } of checks) await tx.insert('goal-check', checkId, { ...omit(check, ['id']), goalId: id, done: false, sortKey: `a${index}` })
    return { collection: 'goal', id, revision: record.revision, changes: Object.keys(data).sort() }
  })()
}

type LinkRef = { kind: string; id: string }

/** Add / remove a link between the target goal and another entity (`from → to`). */
function linkGoal(add: boolean, relationOf: (tx: ReferenceTx) => string, ends: (tx: ReferenceTx, goalId: string) => Promise<[LinkRef, LinkRef]>) {
  return async (tx: ReferenceTx): Promise<ReferenceOutcome> => {
    const goal = await tx.requireTarget('goal')
    const [from, to] = (await ends(tx, goal.id)) as [never, never]
    const relation = relationOf(tx)
    const link = add ? await addLink(tx, from, to, relation) : await removeLink(tx, from, to, relation)
    if (!link) throw new CommandRejection('NOT_FOUND', 'link not found')
    return { collection: 'entity-link', id: link.id, revision: link.revision, ref: tx.rawTarget ?? null, changes: [relation] }
  }
}

async function alignEnds(tx: ReferenceTx, goalId: string): Promise<[LinkRef, LinkRef]> {
  if (tx.payload.toGoalId === goalId) throw new CommandRejection('VALIDATION', 'a goal cannot align to itself')
  await tx.require('goal', tx.payload.toGoalId)
  return [{ kind: 'goal', id: goalId }, { kind: 'goal', id: tx.payload.toGoalId }]
}

const workEnds = async (tx: ReferenceTx, goalId: string): Promise<[LinkRef, LinkRef]> => [tx.payload.work, { kind: 'goal', id: goalId }]

const member = (tx: ReferenceTx) => String(tx.payload.personId ?? tx.payload.principalId)

export const GOALS_REFERENCE_SPECS: ReferenceSpecMap = {
  'goals.create': { op: createGoal, event: 'goals.goal_created' },
  'goals.update_name': { op: update('goal'), event: 'goals.goal_name_updating' },
  'goals.update_description': { op: update('goal'), event: 'goals.goal_description_changed' },
  'goals.update_parent_goal': {
    event: 'goals.goal_reparent',
    op: update('goal', async (tx, current) => {
      const parent = tx.payload.parentGoalId
      if (parent) {
        if (parent === current!.id) throw new CommandRejection('VALIDATION', 'a goal cannot be its own parent')
        await tx.require('goal', parent)
      }
      return { parentGoalId: parent }
    }),
  },
  'goals.update_start_date': { op: update('goal'), event: 'goals.goal_start_date_updating' },
  'goals.update_due_date': { op: update('goal'), event: 'goals.goal_due_date_updating' },
  'goals.update_champion': { op: update('goal'), event: 'goals.goal_champion_updating' },
  'goals.update_reviewer': { op: update('goal'), event: 'goals.goal_reviewer_updating' },
  'goals.update_space': { op: update('goal', tx => ({ spaceId: tx.payload.spaceId, scope: tx.payload.spaceId ? 'space' : 'company' })), event: 'goals.goal_space_updating' },
  'goals.update_access_levels': update('goal', tx => ({ accessLevels: payloadFields()(tx) })),
  'goals.create_target': { op: childCreate('goal-target', 'goal', 'goalId', payloadFields(), sortDefault), event: 'goals.goal_target_adding' },
  'goals.update_target': { op: childUpdate('goal-target', 'goal', 'goalId', 'targetId'), event: 'goals.goal_target_updating' },
  'goals.update_target_value': { op: childUpdate('goal-target', 'goal', 'goalId', 'targetId', tx => ({ value: tx.payload.value, measuredAt: tx.payload.measuredAt ?? tx.now })), event: 'goals.goal_target_updating' },
  'goals.update_target_index': childUpdate('goal-target', 'goal', 'goalId', 'targetId'),
  'goals.delete_target': { op: childDelete('goal-target', 'goal', 'goalId', 'targetId'), event: 'goals.goal_target_deleting' },
  'goals.create_check': { op: childCreate('goal-check', 'goal', 'goalId', payloadFields(), () => ({ done: false, sortKey: 'a0' })), event: 'goals.goal_check_adding' },
  'goals.update_check': childUpdate('goal-check', 'goal', 'goalId', 'checkId'),
  'goals.toggle_check': { op: childUpdate('goal-check', 'goal', 'goalId', 'checkId', tx => ({ done: tx.payload.done, doneAt: tx.payload.done ? tx.now : null, doneBy: tx.payload.done ? tx.actor : null })), event: 'goals.goal_check_toggled' },
  'goals.update_check_index': childUpdate('goal-check', 'goal', 'goalId', 'checkId'),
  'goals.delete_check': { op: childDelete('goal-check', 'goal', 'goalId', 'checkId'), event: 'goals.goal_check_removing' },
  'goals.close': { op: transition('goal', tx => ({ successStatus: tx.payload.successStatus, closedAt: tx.payload.closedAt ?? tx.now, closedBy: tx.actor, ...(tx.payload.retrospective ? { retrospective: tx.payload.retrospective } : {}) })), event: 'goals.goal_closing' },
  'goals.reopen': { op: transition('goal', () => ({ successStatus: null, closedAt: null, closedBy: null })), event: 'goals.goal_reopening' },
  'goals.delete': softDelete('goal'),
  'goals.align': { op: linkGoal(true, () => 'aligned-to', alignEnds), event: 'goals.goal_aligned' },
  'goals.unalign': linkGoal(false, () => 'aligned-to', alignEnds),
  'goals.set_target_status_override': childUpdate('goal-target', 'goal', 'goalId', 'targetId', tx => ({ statusOverride: tx.payload.status })),
  'okr.create_cycle': create('okr-cycle', payloadFields(), { defaults: () => ({ status: 'draft', timeZone: 'UTC' }) }),
  'okr.publish_cycle': { op: transition('okr-cycle', () => ({ status: 'published' })), event: 'goals.okr_cycle_published' },
  'okr.publish_objectives': async tx => {
    const cycle = await tx.requireTarget('okr-cycle')
    const { updated, missing } = await patchMany(tx, 'goal', tx.payload.goalIds, () => ({ publishState: 'published' }))
    return { collection: 'okr-cycle', id: cycle.id, revision: cycle.revision, result: { updated, missing }, changes: ['publishState'] }
  },
  'okr.import_from_cycle': async tx => {
    const cycle = await tx.requireTarget('okr-cycle')
    await tx.require('okr-cycle', tx.payload.fromCycleId)
    const imported: string[] = []
    for (const [index, goalId] of ((tx.payload.goalIds ?? []) as string[]).entries()) {
      const source = await tx.get('goal', goalId)
      if (!source || source.data.okrCycleId !== tx.payload.fromCycleId) continue
      const id = tx.newId(`import-${index}`)
      await tx.insert('goal', id, { ...omit(source.data, ['createdAt', 'updatedAt', 'createdBy', 'lastCommandId', 'closedAt', 'successStatus', 'lastCheckInId', 'lastCheckInStatus']), okrCycleId: cycle.id, publishState: 'draft' })
      imported.push(id)
    }
    return { collection: 'okr-cycle', id: cycle.id, revision: cycle.revision, result: { imported }, changes: ['goals'] }
  },
  'goals.create_check_in': { op: createCheckIn('goal'), event: 'goals.goal_check_in' },
  'goals.update_check_in': { op: update('check-in', tx => omit(tx.payload, ['targetValues', 'checkValues'])), event: 'goals.goal_check_in_edit' },
  'goals.delete_check_in': softDelete('check-in'),
  'goals.acknowledge_check_in': { op: transition('check-in', acknowledge), event: 'goals.goal_check_in_acknowledgement' },
  /** Denormalised summary on the goal (written by CHK through GOAL's command, PLAN §1.3). */
  'goals.record_check_in_summary': update('goal', tx => ({ lastCheckInId: tx.payload.checkInId, lastCheckInStatus: tx.payload.status, ...(tx.payload.nextCheckInDueAt !== undefined ? { nextCheckInDueAt: tx.payload.nextCheckInDueAt } : {}) })),
  'checkins.draft_from_activity': async tx => {
    const target = targetRef(tx)
    const subjectType = target.kind === 'project' ? 'project' : 'goal'
    const subject = await tx.require(subjectType, tx.target(subjectType))
    const id = tx.createId()
    const record = await tx.insert('check-in', id, { subjectType, subjectId: subject.id, authorId: tx.actor, status: 'pending', message: '', source: 'agent_draft', state: 'draft', notify: 'none', ...(tx.payload.since ? { activitySince: tx.payload.since } : {}) })
    return { collection: 'check-in', id, revision: record.revision, changes: ['state'] }
  },
  'goals.link_work': linkGoal(true, tx => tx.payload.relation ?? 'aligned-to', workEnds),
  'goals.unlink_work': linkGoal(false, tx => tx.payload.relation ?? 'aligned-to', workEnds),
}

export const PROJECTS_REFERENCE_SPECS: ReferenceSpecMap = {
  'projects.create': { op: create('project', payloadFields('templateId'), { defaults: tx => ({ status: 'active', championId: tx.actor, privacy: 'members' }) }), event: 'projects.project_created' },
  'projects.update_name': { op: update('project'), event: 'projects.project_renamed' },
  'projects.update_description': update('project'),
  'projects.update_parent_goal': {
    event: 'projects.project_goal_connection',
    op: update('project', async tx => { if (tx.payload.parentGoalId) await tx.require('goal', tx.payload.parentGoalId); return { parentGoalId: tx.payload.parentGoalId } }),
  },
  'projects.update_champion': update('project'),
  'projects.update_reviewer': update('project'),
  'projects.add_contributor': { op: assoc('project-member', 'project', member, payloadFields(), 'projectId'), event: 'projects.project_contributor_addition' },
  'projects.update_contributor': {
    event: 'projects.project_contributor_edited',
    op: async tx => {
      await tx.requireTarget('project')
      await tx.require('project-member', `${tx.target('project')}:${member(tx)}`)
      return assoc('project-member', 'project', member, payloadFields(), 'projectId')(tx)
    },
  },
  'projects.remove_contributor': { op: unassoc('project-member', 'project', member), event: 'projects.project_contributor_removed' },
  'projects.update_dates': { op: update('project'), event: 'projects.project_timeline_edited' },
  'projects.pause': { op: transition('project', tx => ({ status: 'paused', pausedAt: tx.now })), event: 'projects.project_pausing' },
  'projects.resume': { op: transition('project', () => ({ status: 'active', pausedAt: null })), event: 'projects.project_resuming' },
  'projects.close': { op: transition('project', tx => ({ status: 'closed', successStatus: tx.payload.successStatus, closedAt: tx.payload.closedAt ?? tx.now, ...(tx.payload.retrospective ? { retrospective: tx.payload.retrospective } : {}) })), event: 'projects.project_closed' },
  'projects.move': { op: update('project'), event: 'projects.project_moved' },
  'projects.delete': softDelete('project'),
  'projects.share': transition('project', tx => ({ sharedWorkspaceId: tx.payload.workspaceId, ...(tx.payload.spaceId ? { spaceId: tx.payload.spaceId } : {}) })),
  'projects.add_resource': async tx => {
    const project = await tx.requireTarget('project')
    const link = await addLink(tx, tx.payload.resource, { kind: 'project', id: project.id }, 'resource-of', tx.payload.title ? { role: tx.payload.title } : {})
    return { collection: 'entity-link', id: link.id, revision: link.revision, ref: tx.rawTarget ?? null, changes: ['resource'] }
  },
  'projects.remove_resource': async tx => {
    const project = await tx.requireTarget('project')
    const removed = await removeLink(tx, tx.payload.resource, { kind: 'project', id: project.id }, 'resource-of')
    if (!removed) throw new CommandRejection('NOT_FOUND', 'resource not found')
    return { collection: 'entity-link', id: removed.id, revision: removed.revision, ref: tx.rawTarget ?? null, changes: ['resource'] }
  },
  'projects.update_task_statuses': async tx => {
    const project = await tx.requireTarget('project')
    const row = await tx.upsert('task-status-set', `project:${project.id}`, { statuses: tx.payload.statuses }, { ownerType: 'project', ownerId: project.id })
    return { collection: 'task-status-set', id: row.id, revision: row.revision, ref: tx.rawTarget ?? null, changes: ['statuses'] }
  },
  'milestones.create': {
    event: 'projects.project_milestone_creation',
    op: async tx => {
      const projectId = tx.payload.projectId
      await tx.require('project', projectId)
      return create('milestone', payloadFields(), { defaults: () => ({ status: 'pending', stages: [], sortKey: 'a0' }) })(tx)
    },
  },
  'milestones.update': { op: update('milestone'), event: 'projects.project_milestone_updating' },
  'milestones.complete': { op: transition('milestone', tx => ({ status: 'done', completedAt: tx.now, roadmapStatus: 'done', openTasks: tx.payload.openTasks, ...(tx.payload.moveToMilestoneId ? { movedTasksTo: tx.payload.moveToMilestoneId } : {}) })), event: 'projects.project_milestone_updating' },
  'milestones.reopen': { op: transition('milestone', () => ({ status: 'pending', completedAt: null, roadmapStatus: 'active' })), event: 'projects.project_milestone_updating' },
  'milestones.delete': softDelete('milestone'),
  'milestones.reorder': async tx => {
    const project = await tx.requireTarget('project')
    const { updated, missing } = await patchMany(tx, 'milestone', tx.payload.order, (_record, index) => ({ sortKey: `a${String(index).padStart(4, '0')}` }))
    return { collection: 'project', id: project.id, revision: project.revision, result: { updated, missing }, changes: ['sortKey'] }
  },
  'projects.create_check_in': { op: createCheckIn('project'), event: 'projects.project_check_in_submitted' },
  'projects.update_check_in': { op: update('check-in'), event: 'projects.project_check_in_edit' },
  'projects.delete_check_in': softDelete('check-in'),
  'projects.acknowledge_check_in': { op: transition('check-in', acknowledge), event: 'projects.project_check_in_acknowledged' },
  'reviews.create': async tx => {
    const subjectCollection = tx.payload.subjectType === 'okr_cycle' ? 'okr-cycle' : tx.payload.subjectType
    await tx.require(subjectCollection, tx.payload.subjectId)
    return create('review', tx => ({ ...payloadFields()(tx) as RecordData, authorId: tx.actor }))(tx)
  },
  'reviews.acknowledge': transition('review', acknowledge),
  'reviews.create_cycle_review': async tx => {
    await tx.require('okr-cycle', tx.payload.okrCycleId)
    return create('review', tx => ({ subjectType: 'okr_cycle', subjectId: tx.payload.okrCycleId, authorId: tx.actor, ...(tx.payload.notes ? { notes: tx.payload.notes } : {}), ...(tx.payload.score ? { score: tx.payload.score } : {}) }))(tx)
  },
}

/** `spaces.create` also provisions the space chat and root folder (W1-05 FKs, TECH-SPEC §4.10). */
async function createSpace(tx: ReferenceTx): Promise<ReferenceOutcome> {
  const p = tx.payload
  const id = tx.createId()
  const chatId = tx.newId('chat')
  const folderId = tx.newId('folder')
  await tx.assertAbsent('space', id)
  await tx.assertAbsent('channel', chatId)
  await tx.assertAbsent('folder', folderId)
  await tx.insert('channel', chatId, { kind: 'space', visibility: 'private', name: p.name, spaceId: id })
  await tx.insert('folder', folderId, { ownerType: 'space', ownerId: id, name: p.name })
  const record = await tx.insert('space', id, {
    isCompanySpace: false, defaultAccess: 'members', tools: { goals_projects: true, discussions: true, docs: true, tasks: true, kpis: false, templates: false },
    ...omit(p, ['id', 'memberIds']), chatId, rootFolderId: folderId,
  })
  for (const principalId of new Set<string>([tx.actor, ...((p.memberIds ?? []) as string[])])) {
    await tx.upsert('space-member', `${id}:${principalId}`, { role: principalId === tx.actor ? 'owner' : 'editor' }, { spaceId: id, principalId })
  }
  return { collection: 'space', id, revision: record.revision, changes: Object.keys(omit(p, ['id'])).sort(), result: { chatId, rootFolderId: folderId } }
}

async function spaceMembers(tx: ReferenceTx, members: Array<{ principalId: string; role: string }>): Promise<ReferenceOutcome> {
  const space = await tx.requireTarget('space')
  for (const { principalId, role } of members) await tx.upsert('space-member', `${space.id}:${principalId}`, { role }, { spaceId: space.id, principalId })
  return { collection: 'space', id: space.id, revision: space.revision, changes: ['members'], result: { members: members.map(m => m.principalId) } }
}

export const SPACES_REFERENCE_SPECS: ReferenceSpecMap = {
  'spaces.create': { op: createSpace, event: 'spaces.space_added' },
  'spaces.update': { op: update('space'), event: 'spaces.group_edited' },
  'spaces.update_tools': update('space', (tx, current) => ({ tools: { ...(current!.data.tools as RecordData | undefined), ...tx.payload.tools } })),
  'spaces.add_members': { op: tx => spaceMembers(tx, tx.payload.members), event: 'spaces.space_members_added' },
  'spaces.remove_member': { op: unassoc('space-member', 'space', tx => tx.payload.principalId), event: 'spaces.space_member_removed' },
  'spaces.update_members_permissions': { op: tx => spaceMembers(tx, tx.payload.members), event: 'spaces.space_members_permissions_edited' },
  'spaces.update_general_access': { op: update('space'), event: 'spaces.space_permissions_edited' },
  'spaces.update_task_statuses': async tx => {
    const space = await tx.requireTarget('space')
    const row = await tx.upsert('task-status-set', `space:${space.id}`, { statuses: tx.payload.statuses }, { ownerType: 'space', ownerId: space.id })
    return { collection: 'task-status-set', id: row.id, revision: row.revision, ref: tx.rawTarget ?? null, changes: ['statuses'] }
  },
  'spaces.join': { op: assoc('space-member', 'space', tx => tx.actor, tx => ({ role: 'editor', principalId: tx.actor }), 'spaceId'), event: 'spaces.space_joining' },
  'spaces.leave': unassoc('space-member', 'space', tx => tx.actor),
  'spaces.delete': async tx => {
    const space = await tx.requireTarget('space')
    if (tx.payload.confirmName !== space.data.name) throw new CommandRejection('VALIDATION', 'confirmName does not match the space name')
    const record = await tx.update('space', space, { archivedAt: tx.now, deletedAt: tx.now })
    return { collection: 'space', id: space.id, revision: record.revision, changes: ['deletedAt'] }
  },
}

export const KPIS_REFERENCE_SPECS: ReferenceSpecMap = {
  'kpis.create': {
    event: 'kpis.kpi_created',
    op: async tx => {
      await tx.require('space', tx.payload.spaceId)
      return create('kpi', payloadFields(), { defaults: tx => ({ unit: '', direction: 'increase', championId: tx.actor }) })(tx)
    },
  },
  'kpis.update': { op: update('kpi'), event: 'kpis.kpi_edited' },
  'kpis.delete': { op: softDelete('kpi'), event: 'kpis.kpi_deleted' },
  'kpis.log_entry': { op: childCreate('kpi-entry', 'kpi', 'kpiId', payloadFields(), tx => ({ recordedBy: tx.actor })), event: 'kpis.kpi_entry_logged' },
  'kpis.edit_entry': {
    event: 'kpis.kpi_entry_edited',
    op: async tx => {
      const { child } = await requireChild(tx, 'kpi-entry', 'kpi', 'kpiId', 'entryId')
      const edits = [...((child.data.edits as RecordData[] | undefined) ?? []), { editedBy: tx.actor, previousValue: child.data.value, previousPeriod: child.data.period, editedAt: tx.now }]
      const record = await tx.update('kpi-entry', child, { ...omit(tx.payload, ['entryId']), edits })
      return { collection: 'kpi-entry', id: child.id, revision: record.revision, changes: Object.keys(omit(tx.payload, ['entryId'])).sort() }
    },
  },
  'kpis.delete_entry': { op: childDelete('kpi-entry', 'kpi', 'kpiId', 'entryId'), event: 'kpis.kpi_entry_deleted' },
  'kpis.add_annotation': { op: childCreate('kpi-annotation', 'kpi', 'kpiId'), event: 'kpis.kpi_annotation_added' },
  'kpis.edit_annotation': { op: childUpdate('kpi-annotation', 'kpi', 'kpiId', 'annotationId'), event: 'kpis.kpi_annotation_edited' },
  'kpis.delete_annotation': { op: childDelete('kpi-annotation', 'kpi', 'kpiId', 'annotationId'), event: 'kpis.kpi_annotation_deleted' },
}

