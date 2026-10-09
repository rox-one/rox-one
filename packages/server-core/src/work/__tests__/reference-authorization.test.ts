/**
 * W1-06 (#1503) review 2 — every payload-named resource a command writes to,
 * writes into, deletes, reorders or links FROM is authorized with the
 * executor's authorizer (at the verb the command would need if it were the
 * target); a merely referenced one needs `read`. A payload id of the target's
 * own kind may only repeat the target (FORBIDDEN otherwise).
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { Authorizer } from '@rox/core/commands'
import { InMemoryCommandStore } from '../../commands/store'
import { ReferenceTx, authorizeRef, configureReferenceRuntime, storedAclRole, referenceMemoryRecords, resetReferenceMemory, resetReferenceRuntime } from '../reference'
import { createHarness } from './reference-harness'
import { ACTOR_ID, BOB, U, WORKSPACE_ID } from './reference-scenario'

const NOW = new Date('2026-10-08T12:00:00.000Z')
const at = (hour: number) => `2026-10-09T${String(hour).padStart(2, '0')}:00:00.000Z`

interface Call { verb: string; ref: { kind: string; id: string } | null; workspaceId: string }

/** Records `can()` calls; allows only what `allow` accepts. */
function recording(allow: (call: Call) => boolean): { calls: Call[]; authorizer: Authorizer } {
  const calls: Call[] = []
  return {
    calls,
    authorizer: {
      can: async (principal, verb, ref) => {
        const call = { verb, ref: ref ? { kind: ref.kind, id: ref.id } : null, workspaceId: principal.workspaceId }
        calls.push(call)
        return allow(call)
      },
    },
  }
}

const denyId = (id: string) => recording(call => call.ref?.id !== id)

function harness(authorizer?: Authorizer) {
  return createHarness({ local: new InMemoryCommandStore(), workspace: new InMemoryCommandStore(), ...(authorizer ? { authorizer } : {}) })
}

const records = (collection: string) => referenceMemoryRecords(WORKSPACE_ID, collection)

beforeEach(() => {
  resetReferenceMemory()
  configureReferenceRuntime({ now: () => NOW })
})
afterEach(() => resetReferenceRuntime())

describe('payload containers and destinations are authorized', () => {
  test('tasks.create: a payload list is written into (write), a list target bounds it', async () => {
    const setup = harness()
    await setup.run({ type: 'task_lists.create', payload: { id: U('list-a'), name: 'A' } })
    await setup.run({ type: 'task_lists.create', payload: { id: U('list-b'), name: 'B' } })
    const { calls, authorizer } = denyId(U('list-b'))
    const guarded = harness(authorizer)
    expect(await guarded.run({ type: 'tasks.create', payload: { id: U('t-b'), title: 'x', listId: U('list-b') } })).toMatchObject({ error: { code: 'FORBIDDEN' } })
    expect(calls).toContainEqual(expect.objectContaining({ verb: 'write', ref: { kind: 'task-list', id: U('list-b') } }))
    expect(await setup.run({ type: 'tasks.create', target: { kind: 'task-list', id: U('list-a') }, payload: { id: U('t-ab'), title: 'x', listId: U('list-b') } })).toMatchObject({ error: { code: 'FORBIDDEN' } })
    expect(records('task')).toEqual([])
    expect(await guarded.run({ type: 'tasks.create', payload: { id: U('t-a'), title: 'x', listId: U('list-a') } })).toMatchObject({ status: 'applied' })
    expect(await guarded.run({ type: 'tasks.create', target: { kind: 'task-list', id: U('list-a') }, payload: { id: U('t-a2'), title: 'y' } })).toMatchObject({ status: 'applied' })
    expect(records('task').find(task => task.id === U('t-a2'))!.data.listId).toBe(U('list-a'))
  })

  test('tasks.move / add_to_list: the destination list is written into', async () => {
    const setup = harness()
    await setup.run({ type: 'task_lists.create', payload: { id: U('list-b'), name: 'B' } })
    await setup.run({ type: 'tasks.create', payload: { id: U('t'), title: 'x' } })
    const guarded = harness(denyId(U('list-b')).authorizer)
    expect(await guarded.run({ type: 'tasks.add_to_list', target: { kind: 'task', id: U('t') }, payload: { listId: U('list-b') } })).toMatchObject({ error: { code: 'FORBIDDEN' } })
    expect(await guarded.run({ type: 'tasks.move', target: { kind: 'task', id: U('t') }, payload: { listId: U('list-b') } })).toMatchObject({ error: { code: 'FORBIDDEN' } })
    expect(await setup.run({ type: 'tasks.move', target: { kind: 'task', id: U('t') }, payload: { parentId: U('t') } })).toMatchObject({ error: { code: 'VALIDATION' } })
    expect(records('task')[0]!.data.listId).toBeUndefined()
  })

  test('tasks.share: the destination workspace is authorized (write, workspace-level)', async () => {
    const setup = harness()
    await setup.run({ type: 'tasks.create', payload: { id: U('t'), title: 'x' } })
    const { calls, authorizer } = recording(call => call.workspaceId !== U('ws-other'))
    expect(await harness(authorizer).run({ type: 'tasks.share', target: { kind: 'task', id: U('t') }, payload: { workspaceId: U('ws-other') } })).toMatchObject({ error: { code: 'FORBIDDEN' } })
    expect(calls).toContainEqual({ verb: 'write', ref: null, workspaceId: U('ws-other') })
  })

  test('calendar.create_event: a payload calendar repeats a calendar target and is written into', async () => {
    const setup = harness()
    await setup.run({ type: 'calendar.create_calendar', payload: { id: U('cal-a'), name: 'A' } })
    await setup.run({ type: 'calendar.create_calendar', payload: { id: U('cal-b'), name: 'B' } })
    const event = { title: 'Sync', startAt: at(10), endAt: at(11) }
    expect(await setup.run({ type: 'calendar.create_event', target: { kind: 'calendar', id: U('cal-a') }, payload: { ...event, calendarId: U('cal-b') } })).toMatchObject({ error: { code: 'FORBIDDEN' } })
    const { calls, authorizer } = denyId(U('cal-b'))
    const guarded = harness(authorizer)
    expect(await guarded.run({ type: 'calendar.create_event', payload: { ...event, calendarId: U('cal-b') } })).toMatchObject({ error: { code: 'FORBIDDEN' } })
    expect(calls).toContainEqual(expect.objectContaining({ verb: 'write', ref: { kind: 'calendar', id: U('cal-b') } }))
    expect(records('calendar-event')).toEqual([])
    expect(await guarded.run({ type: 'calendar.create_event', payload: { ...event, calendarId: U('cal-a') } })).toMatchObject({ status: 'applied' })
  })

  test('comments.create: the parent is the target; a thread must be on the same entity (kind and id)', async () => {
    const setup = harness()
    const noteA = { kind: 'note', id: U('n-a') }
    expect(await setup.run({ type: 'comments.create', payload: { parent: noteA, content: 'x' } })).toMatchObject({ error: { code: 'VALIDATION' } })
    expect(await setup.run({ type: 'comments.create', target: noteA, payload: { parent: { kind: 'note', id: U('n-b') }, content: 'x' } })).toMatchObject({ error: { code: 'FORBIDDEN' } })
    expect(await setup.run({ type: 'comments.create', target: noteA, payload: { id: U('c'), content: 'root' } })).toMatchObject({ status: 'applied' })
    // Same id, other kind: not this entity's thread.
    expect(await setup.run({ type: 'comments.create', target: { kind: 'task', id: U('n-a') }, payload: { content: 'r', threadId: U('c') } })).toMatchObject({ error: { code: 'NOT_FOUND' } })
    expect(await setup.run({ type: 'comments.create', target: noteA, payload: { content: 'r', threadId: U('c') } })).toMatchObject({ status: 'applied' })
  })

  test('docs blocks and apply_patch: the document is the target', async () => {
    const setup = harness()
    const docA = { kind: 'note', id: U('d-a') }
    const docB = { kind: 'note', id: U('d-b') }
    await setup.run({ type: 'docs.create_document', payload: { id: docA.id, title: 'A' } })
    await setup.run({ type: 'docs.create_document', payload: { id: docB.id, title: 'B' } })
    expect(await setup.run({ type: 'docs.append_block', payload: { docRef: docB, markdown: 'x' } })).toMatchObject({ error: { code: 'VALIDATION' } })
    expect(await setup.run({ type: 'docs.append_block', target: docA, payload: { docRef: docB, markdown: 'x' } })).toMatchObject({ error: { code: 'FORBIDDEN' } })
    expect(await setup.run({ type: 'docs.insert_task_block', target: docA, payload: { docRef: docB, taskRef: { kind: 'task', id: U('t') } } })).toMatchObject({ error: { code: 'FORBIDDEN' } })
    expect(await setup.run({ type: 'docs.apply_patch', payload: { noteId: 'Notes/b.md', patch: '@@' } })).toMatchObject({ error: { code: 'VALIDATION' } })
    expect(await setup.run({ type: 'docs.apply_patch', target: { kind: 'note', id: 'Notes/a.md' }, payload: { noteId: 'Notes/b.md', patch: '@@' } })).toMatchObject({ error: { code: 'FORBIDDEN' } })
    // The embedded task is only referenced: read.
    const { calls, authorizer } = recording(call => !(call.ref?.id === U('t') && call.verb === 'read'))
    expect(await harness(authorizer).run({ type: 'docs.insert_task_block', target: docA, payload: { docRef: docA, taskRef: { kind: 'task', id: U('t') } } })).toMatchObject({ error: { code: 'FORBIDDEN' } })
    expect(calls).toContainEqual(expect.objectContaining({ verb: 'read', ref: { kind: 'task', id: U('t') } }))
    expect(await setup.run({ type: 'docs.append_block', target: docA, payload: { docRef: docA, markdown: 'x' } })).toMatchObject({ status: 'applied' })
  })

  test('forms.configure_on_submit: the form is the target', async () => {
    const setup = harness()
    const action = { actions: [{ type: 'tasks.create' }] }
    expect(await setup.run({ type: 'forms.configure_on_submit', payload: { formRef: { kind: 'form', id: U('f-b') }, ...action } })).toMatchObject({ error: { code: 'VALIDATION' } })
    expect(await setup.run({ type: 'forms.configure_on_submit', target: { kind: 'form', id: U('f-a') }, payload: { formRef: { kind: 'form', id: U('f-b') }, ...action } })).toMatchObject({ error: { code: 'FORBIDDEN' } })
    expect(await setup.run({ type: 'forms.configure_on_submit', target: { kind: 'form', id: U('f-a') }, payload: { formRef: { kind: 'form', id: U('f-a') }, ...action } })).toMatchObject({ status: 'applied' })
  })
})

describe('chat destinations need membership, posting policy and write', () => {
  async function chats() {
    const setup = harness()
    await setup.run({ type: 'im.create_chat', payload: { id: U('src'), name: 'src', visibility: 'public' } })
    await setup.run({ type: 'im.send_message', target: { kind: 'channel', id: U('src') }, payload: { id: U('m'), content: { doc: 'hi' } } })
    // BOB's chat: the actor is not a member.
    await setup.run({ type: 'im.create_chat', payload: { id: U('bobs'), name: 'bobs', visibility: 'public' }, actor: BOB })
    // A chat the actor belongs to.
    await setup.run({ type: 'im.create_chat', payload: { id: U('dest'), name: 'dest', visibility: 'public', memberIds: [ACTOR_ID] }, actor: BOB })
    return setup
  }
  const messagesIn = (chatId: string) => records('channel-message').filter(message => message.data.chatId === chatId)

  test('im.forward_messages', async () => {
    const setup = await chats()
    expect(await setup.run({ type: 'im.forward_messages', target: { kind: 'channel', id: U('src') }, payload: { messageIds: [U('m')], toChatId: U('bobs') } })).toMatchObject({ error: { code: 'FORBIDDEN' } })
    const { calls, authorizer } = denyId(U('dest'))
    expect(await harness(authorizer).run({ type: 'im.forward_messages', target: { kind: 'channel', id: U('src') }, payload: { messageIds: [U('m')], toChatId: U('dest') } })).toMatchObject({ error: { code: 'FORBIDDEN' } })
    expect(calls).toContainEqual(expect.objectContaining({ verb: 'write', ref: { kind: 'channel', id: U('dest') } }))
    expect(messagesIn(U('bobs'))).toHaveLength(0)
    expect(messagesIn(U('dest'))).toHaveLength(0)
    await setup.run({ type: 'im.update_policy', target: { kind: 'channel', id: U('dest') }, payload: { postingPolicy: 'admins' }, actor: BOB })
    expect(await setup.run({ type: 'im.forward_messages', target: { kind: 'channel', id: U('src') }, payload: { messageIds: [U('m')], toChatId: U('dest') } })).toMatchObject({ error: { code: 'FORBIDDEN' } })
    await setup.run({ type: 'im.update_policy', target: { kind: 'channel', id: U('dest') }, payload: { postingPolicy: 'all' }, actor: BOB })
    expect(await setup.run({ type: 'im.forward_messages', target: { kind: 'channel', id: U('src') }, payload: { messageIds: [U('m')], toChatId: U('dest') } })).toMatchObject({ status: 'applied' })
    expect(messagesIn(U('dest'))).toHaveLength(1)
  })

  test('meetings.publish_outcomes', async () => {
    const setup = await chats()
    await setup.run({ type: 'vc.start_meeting', payload: { id: U('call'), title: 'Standup' } })
    const outcome = { decisions: [{ title: 'Ship' }] }
    expect(await setup.run({ type: 'meetings.publish_outcomes', target: { kind: 'call', id: U('call') }, payload: { ...outcome, toChatId: U('bobs') } })).toMatchObject({ error: { code: 'FORBIDDEN' } })
    const { calls, authorizer } = denyId(U('dest'))
    expect(await harness(authorizer).run({ type: 'meetings.publish_outcomes', target: { kind: 'call', id: U('call') }, payload: { ...outcome, toChatId: U('dest') } })).toMatchObject({ error: { code: 'FORBIDDEN' } })
    expect(calls).toContainEqual(expect.objectContaining({ verb: 'write', ref: { kind: 'channel', id: U('dest') } }))
    expect(messagesIn(U('bobs'))).toHaveLength(0)
    expect(await setup.run({ type: 'meetings.publish_outcomes', target: { kind: 'call', id: U('call') }, payload: { ...outcome, toChatId: U('dest') } })).toMatchObject({ status: 'applied' })
    expect(messagesIn(U('dest'))).toHaveLength(1)
  })

  test('im.send_message: a non-member cannot post in a public chat', async () => {
    const setup = await chats()
    expect(await setup.run({ type: 'im.send_message', target: { kind: 'channel', id: U('bobs') }, payload: { content: { doc: 'x' } } })).toMatchObject({ error: { code: 'FORBIDDEN' } })
    await setup.run({ type: 'im.join_chat', target: { kind: 'channel', id: U('bobs') }, payload: {} })
    expect(await setup.run({ type: 'im.send_message', target: { kind: 'channel', id: U('bobs') }, payload: { content: { doc: 'x' } } })).toMatchObject({ status: 'applied' })
  })
})

describe('deletes, reorders, ownership and approvals', () => {
  test('contacts.merge_cards: sources must share the owner and are destroyed (destroy)', async () => {
    const setup = harness()
    await setup.run({ type: 'contacts.create_card', payload: { id: U('card'), displayName: 'Eve' } })
    await setup.run({ type: 'contacts.create_card', payload: { id: U('card2'), displayName: 'Eve 2' } })
    await setup.run({ type: 'contacts.create_card', payload: { id: U('bobs-card'), displayName: 'Eve (Bob)' }, actor: BOB })
    const target = { kind: 'person', id: U('card') }
    expect(await setup.run({ type: 'contacts.merge_cards', target, payload: { sourceIds: [U('card2'), U('bobs-card')] } })).toMatchObject({ error: { code: 'FORBIDDEN' } })
    const { calls, authorizer } = recording(call => !(call.verb === 'destroy' && call.ref?.id === U('card2')))
    expect(await harness(authorizer).run({ type: 'contacts.merge_cards', target, payload: { sourceIds: [U('card2')] } })).toMatchObject({ error: { code: 'FORBIDDEN' } })
    expect(calls).toContainEqual(expect.objectContaining({ verb: 'destroy', ref: { kind: 'person', id: U('card2') } }))
    expect(records('contact-card').every(card => !card.data.mergedInto && !card.data.deletedAt)).toBe(true)
    expect(await setup.run({ type: 'contacts.merge_cards', target, payload: { sourceIds: [U('card2')] } })).toMatchObject({ status: 'applied' })
    expect(records('contact-card').find(card => card.id === U('card2'))!.data.mergedInto).toBe(U('card'))
  })

  test('milestones: create and reorder stay inside the target project', async () => {
    const setup = harness()
    await setup.run({ type: 'projects.create', payload: { id: U('p-a'), name: 'A' } })
    await setup.run({ type: 'projects.create', payload: { id: U('p-b'), name: 'B' } })
    expect(await setup.run({ type: 'milestones.create', target: { kind: 'project', id: U('p-a') }, payload: { id: U('ms-x'), projectId: U('p-b'), title: 'X' } })).toMatchObject({ error: { code: 'FORBIDDEN' } })
    expect(await setup.run({ type: 'milestones.create', payload: { id: U('ms-x'), projectId: U('p-b'), title: 'X' } })).toMatchObject({ error: { code: 'VALIDATION' } })
    await setup.run({ type: 'milestones.create', target: { kind: 'project', id: U('p-a') }, payload: { id: U('ms-a'), projectId: U('p-a'), title: 'A' } })
    await setup.run({ type: 'milestones.create', target: { kind: 'project', id: U('p-b') }, payload: { id: U('ms-b'), projectId: U('p-b'), title: 'B' } })
    const sortKeyOf = (id: string) => records('milestone').find(record => record.id === id)!.data.sortKey
    const before = sortKeyOf(U('ms-b'))
    const receipt = await setup.run({ type: 'milestones.reorder', target: { kind: 'project', id: U('p-a') }, payload: { order: [U('ms-b'), U('ms-a')] } })
    expect(receipt).toMatchObject({ status: 'applied', result: { updated: [U('ms-a')], missing: [U('ms-b')] } })
    expect(sortKeyOf(U('ms-b'))).toBe(before)
    expect(sortKeyOf(U('ms-a'))).toBe('a0001')
  })

  test('acl.transfer_ownership: only the owner transfers, and is demoted to full_access', async () => {
    const setup = harness()
    const doc = { kind: 'note', id: U('doc') }
    await setup.run({ type: 'docs.create_document', payload: { id: doc.id, title: 'D' } })
    await setup.run({ type: 'acl.grant', target: doc, payload: { principal: { kind: 'user', id: BOB }, role: 'editor' } })
    // An editor, and someone without any entry, cannot transfer.
    expect(await setup.run({ type: 'acl.transfer_ownership', target: doc, payload: { toPrincipalId: U('carol') }, actor: BOB })).toMatchObject({ error: { code: 'FORBIDDEN' } })
    expect(await setup.run({ type: 'acl.transfer_ownership', target: doc, payload: { toPrincipalId: BOB }, actor: U('carol') })).toMatchObject({ error: { code: 'FORBIDDEN' } })
    expect(await setup.run({ type: 'acl.transfer_ownership', target: doc, payload: { toPrincipalId: BOB } })).toMatchObject({ status: 'applied' })
    const roleOf = (principalId: string) => records('acl-entry').find(entry => entry.data.resourceId === doc.id && entry.data.subjectId === principalId)?.data.role
    expect(roleOf(BOB)).toBe(storedAclRole('owner'))
    expect(roleOf(ACTOR_ID)).toBe(storedAclRole('full_access'))
    // The demoted owner cannot make a second owner; the new owner can transfer back.
    expect(await setup.run({ type: 'acl.transfer_ownership', target: doc, payload: { toPrincipalId: U('carol') } })).toMatchObject({ error: { code: 'FORBIDDEN' } })
    expect(records('acl-entry').filter(entry => entry.data.resourceId === doc.id && entry.data.role === storedAclRole('owner'))).toHaveLength(1)
    expect(await setup.run({ type: 'acl.transfer_ownership', target: doc, payload: { toPrincipalId: ACTOR_ID }, actor: BOB })).toMatchObject({ status: 'applied' })
    expect(roleOf(ACTOR_ID)).toBe(storedAclRole('owner'))
    expect(roleOf(BOB)).toBe(storedAclRole('full_access'))
  })

  test('agents.decide_approval: an existing pending approval, decided once by an eligible approver', async () => {
    const setup = harness()
    expect(await setup.run({ type: 'agents.decide_approval', payload: { approvalId: U('nope'), decision: 'approve' } })).toMatchObject({ error: { code: 'NOT_FOUND' } })
    await setup.run({ type: 'agents.provision_personal_agent', payload: { id: U('agent'), ownerId: ACTOR_ID } })
    expect(await setup.run({ type: 'agents.invoke', payload: { id: U('inv'), agentId: U('agent'), prompt: 'x' } })).toMatchObject({ status: 'applied', result: { approvalId: U('inv') } })
    expect(records('agent-approval')[0]!.data).toMatchObject({ status: 'pending', approverIds: [ACTOR_ID], invocationId: U('inv') })
    expect(await setup.run({ type: 'agents.decide_approval', payload: { approvalId: U('inv'), decision: 'approve' }, actor: BOB })).toMatchObject({ error: { code: 'FORBIDDEN' } })
    expect(await setup.run({ type: 'agents.decide_approval', payload: { approvalId: U('inv'), decision: 'deny' } })).toMatchObject({ status: 'applied' })
    expect(records('agent-approval')[0]!.data).toMatchObject({ status: 'denied', decidedBy: ACTOR_ID })
    expect(await setup.run({ type: 'agents.decide_approval', payload: { approvalId: U('inv'), decision: 'approve' } })).toMatchObject({ error: { code: 'VALIDATION' } })
    // Someone else's agent cannot be invoked.
    expect(await setup.run({ type: 'agents.invoke', payload: { agentId: U('agent'), prompt: 'x' }, actor: BOB })).toMatchObject({ error: { code: 'FORBIDDEN' } })
  })

  test('entities.drop: link / attach write the source (FROM side); embed only references it', async () => {
    const setup = harness()
    const project = { kind: 'project', id: U('p') }
    const doc = { kind: 'note', id: U('d') }
    await setup.run({ type: 'projects.create', payload: { id: project.id, name: 'P' } })
    await setup.run({ type: 'docs.create_document', payload: { id: doc.id, title: 'D' } })
    const { calls, authorizer } = recording(call => !(call.ref?.id === doc.id && call.verb === 'write'))
    const guarded = harness(authorizer)
    expect(await guarded.run({ type: 'entities.drop', target: project, payload: { source: doc, intent: 'link' } })).toMatchObject({ error: { code: 'FORBIDDEN' } })
    expect(calls.at(-1)).toMatchObject({ verb: 'write', ref: doc })
    expect(await guarded.run({ type: 'entities.drop', target: project, payload: { source: doc, intent: 'embed' } })).toMatchObject({ status: 'applied' })
    expect(calls.at(-1)).toMatchObject({ verb: 'read', ref: doc })
    expect(records('entity-link').map(link => link.data)).toEqual([expect.objectContaining({ fromKind: 'project', fromId: project.id, toKind: 'note', toId: doc.id, relation: 'embeds' })])
  })
})

describe('referenced resources need read', () => {
  test('tasks.add_dependency, goals.align, links.add: the other side is read', async () => {
    const setup = harness()
    await setup.run({ type: 'tasks.create', payload: { id: U('t1'), title: 'a' } })
    await setup.run({ type: 'tasks.create', payload: { id: U('t2'), title: 'b' } })
    await setup.run({ type: 'goals.create', payload: { id: U('g1'), name: 'G1' } })
    await setup.run({ type: 'goals.create', payload: { id: U('g2'), name: 'G2' } })
    const denyRead = (id: string) => recording(call => !(call.ref?.id === id && call.verb === 'read'))
    expect(await harness(denyRead(U('t2')).authorizer).run({ type: 'tasks.add_dependency', target: { kind: 'task', id: U('t1') }, payload: { blocks: U('t2') } })).toMatchObject({ error: { code: 'FORBIDDEN' } })
    expect(await harness(denyRead(U('g2')).authorizer).run({ type: 'goals.align', target: { kind: 'goal', id: U('g1') }, payload: { toGoalId: U('g2') } })).toMatchObject({ error: { code: 'FORBIDDEN' } })
    expect(await harness(denyRead(U('g2')).authorizer).run({ type: 'links.add', target: { kind: 'task', id: U('t1') }, payload: { to: { kind: 'goal', id: U('g2') }, relation: 'aligned-to' } })).toMatchObject({ error: { code: 'FORBIDDEN' } })
    expect(records('entity-link')).toEqual([])
    expect(await harness(denyRead(U('other')).authorizer).run({ type: 'goals.align', target: { kind: 'goal', id: U('g1') }, payload: { toGoalId: U('g2') } })).toMatchObject({ status: 'applied' })
  })

  test('without ctx.authorize (a host that does not pass one), payload checks fail closed', async () => {
    const envelope = { commandId: 'c', type: 'tasks.create', payload: {}, issuedAt: NOW.toISOString() }
    const ctx = { workspaceId: WORKSPACE_ID, actor: { principalId: ACTOR_ID, kind: 'user' }, envelope, payload: {} }
    const bare = new ReferenceTx(ctx as never, {} as never, NOW)
    await expect(authorizeRef(bare, { kind: 'task-list', id: U('l') }, 'write')).rejects.toMatchObject({ code: 'FORBIDDEN' })
    const wired = new ReferenceTx({ ...ctx, authorize: async () => true } as never, {} as never, NOW)
    await expect(authorizeRef(wired, { kind: 'task-list', id: U('l') }, 'write')).resolves.toEqual({ kind: 'task-list', id: U('l') })
  })
})
