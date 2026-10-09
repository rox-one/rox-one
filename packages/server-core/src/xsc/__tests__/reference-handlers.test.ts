/**
 * W1-14 (#1511) — Cross-surface handler tests (TECH-SPEC §12).
 *
 * The rules that only the handlers can keep: the `derived-from` link with its
 * anchor, the deterministic id that makes a replayed block command conflict
 * instead of duplicating, the card posted back into the origin chat, and the
 * ref-not-a-copy rule for checklist items.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { Authorizer } from '@rox/core/commands'
import { InMemoryCommandStore } from '../../commands/store'
import { configureReferenceRuntime, referenceMemoryRecords, resetReferenceMemory, resetReferenceRuntime } from '../../work/reference'
import { createHarness } from '../../work/__tests__/reference-harness'
import { ACTOR_ID, BOB, U, WORKSPACE_ID } from '../../work/__tests__/reference-scenario'

const NOW = new Date('2026-10-08T12:00:00.000Z')
const ALLOW_ALL: Authorizer = { can: async () => true }

function memoryHarness(options: { authorizer?: Authorizer } = {}) {
  return createHarness({ local: new InMemoryCommandStore(), workspace: new InMemoryCommandStore(), authorizer: options.authorizer ?? ALLOW_ALL })
}

beforeEach(() => {
  resetReferenceMemory()
  configureReferenceRuntime({ now: () => NOW })
})
afterEach(() => resetReferenceRuntime())

const records = (collection: string) => referenceMemoryRecords(WORKSPACE_ID, collection)
const docTarget = { kind: 'note' as const, id: U('doc') }

/** A doc and one message in a chat, the two origins every §12 command starts from. */
async function seeded(options: { authorizer?: Authorizer } = {}) {
  const harness = memoryHarness(options)
  await harness.run({ type: 'docs.create_document', payload: { id: U('doc'), title: 'Spec' } })
  await harness.run({ type: 'im.create_chat', payload: { id: U('chat'), kind: 'group', name: 'general', visibility: 'public', members: [BOB] } })
  await harness.run({ type: 'im.send_message', target: { kind: 'channel', id: U('chat') }, payload: { messageId: U('msg'), body: { doc: 'ship it' }, mentions: [], chatRef: { kind: 'channel', id: U('chat') } } })
  return harness
}

const linksFrom = (id: string) => records('entity-link').filter(link => link.data.fromId === id)

describe('block commands (rule 1, rule 3)', () => {
  test('docs.insert_task_block nests the task, writes the derived-from link and the embeds link', async () => {
    const harness = await seeded()
    const receipt = await harness.run({ type: 'docs.insert_task_block', target: docTarget, payload: { docRef: docTarget, blockId: 'block-1', task: { title: 'Nested', assignee: BOB } } })
    expect(receipt).toMatchObject({ status: 'applied', result: { taskRef: { kind: 'task' } } })
    const blockId = (receipt.result as { blockId: string }).blockId
    const taskId = (receipt.result as { taskRef: { id: string } }).taskRef.id
    expect(records('doc-block').find(row => row.id === blockId)!.data).toMatchObject({ docId: U('doc'), kind: 'task', taskRef: `task:${taskId}` })
    const derived = linksFrom(taskId)
    expect(derived).toHaveLength(1)
    expect(derived[0]!.data).toMatchObject({ toKind: 'note', toId: U('doc'), relation: 'derived-from', role: 'origin', anchor: { blockId: 'block-1' } })
    expect(records('entity-link').find(link => link.data.fromKind === 'note' && link.data.relation === 'embeds')!.data).toMatchObject({ toKind: 'task', toId: taskId })
  })

  test('a replayed docs.insert_task_block conflicts instead of creating a second task', async () => {
    const harness = await seeded()
    const payload = { docRef: docTarget, blockId: 'block-1', task: { title: 'Nested' } }
    await harness.run({ type: 'docs.insert_task_block', target: docTarget, payload })
    const replay = await harness.run({ type: 'docs.insert_task_block', target: docTarget, payload })
    expect(replay).toMatchObject({ status: 'conflict' })
    expect(records('task')).toHaveLength(1)
    expect(records('doc-block')).toHaveLength(1)
  })

  test('docs.insert_event_block and docs.insert_meeting_block create their entities and blocks', async () => {
    const harness = await seeded()
    const event = await harness.run({
      type: 'docs.insert_event_block',
      target: docTarget,
      payload: { docRef: docTarget, blockId: 'block-e', event: { title: 'Kickoff', start: '2026-10-09T10:00:00Z', end: '2026-10-09T11:00:00Z', attendees: [BOB] } },
    })
    expect(event).toMatchObject({ status: 'applied', result: { eventRef: { kind: 'calendar-event' } } })
    expect(records('calendar-event')[0]!.data).toMatchObject({ title: 'Kickoff', organizerId: ACTOR_ID })
    expect(records('event-rsvp').map(row => row.data.principalId).sort()).toEqual([ACTOR_ID, BOB].sort())

    const meeting = await harness.run({ type: 'docs.insert_meeting_block', target: docTarget, payload: { docRef: docTarget, blockId: 'block-m', mode: 'now' } })
    expect(meeting).toMatchObject({ status: 'applied', result: { callRef: { kind: 'call' } } })
    expect(records('call')[0]!.data).toMatchObject({ hostId: ACTOR_ID, state: 'live' })
    expect(records('doc-block').map(row => row.data.kind).sort()).toEqual(['event', 'meeting'])
  })

  test('docs.embed_view stores the view reference from the ref, not a copy', async () => {
    const harness = await seeded()
    const receipt = await harness.run({ type: 'docs.embed_view', target: docTarget, payload: { docRef: docTarget, blockId: 'block-v', ref: { kind: 'saved-view', ref: { kind: 'base-view', id: U('view') } } } })
    expect(receipt).toMatchObject({ status: 'applied' })
    const block = records('doc-block')[0]!
    expect(block.data).toMatchObject({ kind: 'view', viewRef: `base-view:${U('view')}`, viewKind: 'saved-view' })
    expect((block.data.view as { ref: { id: string } }).ref.id).toBe(U('view'))
  })
})

describe('tasks from a selection, a checklist or a message', () => {
  test('tasks.create_from_selection links the task to the doc block it came from', async () => {
    const harness = await seeded()
    const receipt = await harness.run({
      type: 'tasks.create_from_selection',
      target: docTarget,
      payload: { id: U('sel-task'), origin: { kind: 'doc-block', docRef: `note:${U('doc')}`, blockId: 'block-1' }, title: 'From selection', assignee: BOB },
    })
    expect(receipt).toMatchObject({ status: 'applied', result: { taskRef: { kind: 'task', id: U('sel-task') } } })
    expect(records('task').find(row => row.id === U('sel-task'))!.data).toMatchObject({ title: 'From selection', assigneeIds: [BOB], origin: `note:${U('doc')}` })
    expect(linksFrom(U('sel-task'))[0]!.data).toMatchObject({ relation: 'derived-from', role: 'origin', anchor: { blockId: 'block-1' } })
  })

  test('tasks.create_many_from_checklist keeps the anchor as the title source (rule 2)', async () => {
    const harness = await seeded()
    const receipt = await harness.run({ type: 'tasks.create_many_from_checklist', target: docTarget, payload: { docRef: docTarget, blockIds: ['b1', 'b2'] } })
    expect(receipt).toMatchObject({ status: 'applied' })
    expect((receipt.result as { taskRefs: unknown[] }).taskRefs).toHaveLength(2)
    const tasks = records('task')
    expect(tasks).toHaveLength(2)
    // No copy of the checklist text: the doc block is what renders the title.
    for (const task of tasks) expect(task.data.title).toBe('')
    expect(records('entity-link').filter(link => link.data.relation === 'derived-from').map(link => (link.data.anchor as { blockId: string }).blockId).sort()).toEqual(['b1', 'b2'])
  })

  test('tasks.create_from_message posts the card and returns its seq', async () => {
    const harness = await seeded()
    const receipt = await harness.run({
      type: 'tasks.create_from_message',
      target: { kind: 'task', id: U('msg-task') },
      payload: { id: U('msg-task'), origin: { kind: 'message', chatRef: `channel:${U('chat')}`, seq: 1 }, title: 'From message', followers: [BOB] },
    })
    expect(receipt).toMatchObject({ status: 'applied' })
    expect((receipt.result as { cardMessageSeq: number }).cardMessageSeq).toBe(2)
    const card = records('channel-message').find(message => message.data.seq === 2)!
    expect(JSON.stringify(card.data.content)).toContain(U('msg-task'))
    expect(records('subscription')[0]!.data).toMatchObject({ kind: 'follower', principalId: BOB })
    expect(linksFrom(U('msg-task'))[0]!.data).toMatchObject({ toKind: 'channel-message', relation: 'derived-from', anchor: { seq: 1 } })
  })

  test('a closed chat refuses a card: tasks.create_from_message is FORBIDDEN for a non-member', async () => {
    const harness = await seeded()
    await harness.run({ type: 'im.leave_chat', target: { kind: 'channel', id: U('chat') }, payload: {} })
    const receipt = await harness.run({
      type: 'tasks.create_from_message',
      payload: { id: U('msg-task'), origin: { kind: 'message', chatRef: `channel:${U('chat')}`, seq: 1 }, title: 'From message' },
    })
    expect(receipt).toMatchObject({ status: 'rejected', error: { code: 'FORBIDDEN' } })
    expect(records('task').filter(task => task.id === U('msg-task'))).toEqual([])
  })
})

describe('events, calls and chats', () => {
  test('calendar.create_event_from_message invites the chat and posts the card', async () => {
    const harness = await seeded()
    const receipt = await harness.run({
      type: 'calendar.create_event_from_message',
      payload: { id: U('ev'), origin: { kind: 'message', chatRef: `channel:${U('chat')}`, seq: 1 }, title: 'Sync', start: '2026-10-09T10:00:00Z', end: '2026-10-09T11:00:00Z', attendees: 'chat' },
    })
    expect(receipt).toMatchObject({ status: 'applied' })
    expect(records('event-rsvp').map(row => row.data.principalId).sort()).toEqual([ACTOR_ID, BOB].sort())
    expect((receipt.result as { cardMessageSeq: number }).cardMessageSeq).toBe(2)
    expect(linksFrom(U('ev'))[0]!.data).toMatchObject({ relation: 'derived-from', toKind: 'channel-message' })
  })

  test('vc.start_meeting creates the call, its participants and the notes link', async () => {
    const harness = await seeded()
    const receipt = await harness.run({ type: 'vc.start_meeting', payload: { id: U('call'), participants: [BOB], notesDocRef: `note:${U('doc')}` } })
    expect(receipt).toMatchObject({ status: 'applied', result: { callRef: { kind: 'call', id: U('call') }, joinUrl: `rox://call/${U('call')}` } })
    expect(records('call')[0]!.data).toMatchObject({ hostId: ACTOR_ID, state: 'live', notesDocRef: `note:${U('doc')}` })
    expect(records('call-participant')).toHaveLength(2)
  })

  test('im.create_chat carries the last messages of the origin chat into the new one', async () => {
    const harness = await seeded()
    const receipt = await harness.run({
      type: 'im.create_chat',
      payload: { id: U('carry'), kind: 'group', name: 'Carry', visibility: 'private', members: [BOB], from: { kind: 'message', chatRef: `channel:${U('chat')}`, seq: 1 }, carryContext: { lastN: 1 } },
    })
    expect(receipt).toMatchObject({ status: 'applied', result: { chatRef: { kind: 'channel', id: U('carry') } } })
    const carried = records('channel-message').filter(message => message.data.chatId === U('carry'))
    expect(carried).toHaveLength(1)
    expect(carried[0]!.data).toMatchObject({ seq: 1, content: { doc: 'ship it' }, carriedFrom: { chatId: U('chat'), seq: 1 } })
    // The origin is untouched (a carry, not a move).
    expect(records('channel-message').filter(message => message.data.chatId === U('chat'))).toHaveLength(1)
  })

  test('docs.create_from_messages appends a quoted block and links every message', async () => {
    const harness = await seeded()
    const receipt = await harness.run({
      type: 'docs.create_from_messages',
      target: { kind: 'channel', id: U('chat') },
      payload: { id: U('digest'), chatRef: { kind: 'channel', id: U('chat') }, seqs: [1], target: { new: { title: 'Digest' } }, format: 'quotes' },
    })
    expect(receipt).toMatchObject({ status: 'applied', result: { docRef: { kind: 'note', id: U('digest') } } })
    expect(records('note').find(note => note.id === U('digest'))!.data).toMatchObject({ title: 'Digest', markdownSnapshot: '> ship it' })
    const link = linksFrom(U('digest'))[0]!
    expect(link.data).toMatchObject({ toKind: 'channel-message', relation: 'derived-from', anchor: { seq: 1 } })
  })

  test('docs.create_from_messages on a sequence that does not exist is NOT_FOUND', async () => {
    const harness = await seeded()
    const receipt = await harness.run({
      type: 'docs.create_from_messages',
      target: { kind: 'channel', id: U('chat') },
      payload: { id: U('digest'), chatRef: { kind: 'channel', id: U('chat') }, seqs: [99], target: { new: { title: 'Digest' } }, format: 'plain' },
    })
    expect(receipt).toMatchObject({ status: 'rejected', error: { code: 'NOT_FOUND' } })
    expect(records('note').find(note => note.id === U('digest'))).toBeUndefined()
  })

  test('agents.invoke queues the invocation with its origin and session ref', async () => {
    const harness = await seeded()
    await harness.run({ type: 'agents.provision_personal_agent', payload: { id: U('agent'), ownerId: ACTOR_ID } })
    const receipt = await harness.run({
      type: 'agents.invoke',
      payload: { id: U('inv'), agentRef: { kind: 'person', id: U('agent') }, instruction: 'Summarise', origin: { kind: 'comment', commentId: U('comment') } },
    })
    expect(receipt).toMatchObject({ status: 'applied', result: { sessionRef: `session:${U('inv')}`, replyThread: { kind: 'comment', id: U('comment') } } })
    expect(records('agent-invocation')[0]!.data).toMatchObject({ agentId: U('agent'), instruction: 'Summarise', origin: `comment:${U('comment')}`, status: 'queued' })
    expect(records('agent-approval')[0]!.data).toMatchObject({ status: 'pending', invocationId: U('inv'), approverIds: [ACTOR_ID] })
  })
})

describe('negative paths (PLAN §1.4)', () => {
  const denyAll: Authorizer = { can: async () => false }
  const docWriteDenied: Authorizer = { can: async (_p, verb, ref) => !(verb === 'write' && ref?.kind === 'note') }

  test('docs.insert_event_block on a doc the caller cannot write is FORBIDDEN and writes no event', async () => {
    const harness = await seeded({ authorizer: docWriteDenied })
    const receipt = await harness.run({ type: 'docs.insert_event_block', target: docTarget, payload: { docRef: docTarget, blockId: 'b1', event: { title: 'Kickoff', start: '2026-10-09T10:00:00Z', end: '2026-10-09T11:00:00Z' } } })
    expect(receipt).toMatchObject({ status: 'rejected', error: { code: 'FORBIDDEN' } })
    expect(records('calendar-event')).toEqual([])
    expect(records('doc-block')).toEqual([])
  })

  test('docs.insert_meeting_block on a doc the caller cannot write is FORBIDDEN and opens no call', async () => {
    const harness = await seeded({ authorizer: docWriteDenied })
    const receipt = await harness.run({ type: 'docs.insert_meeting_block', target: docTarget, payload: { docRef: docTarget, blockId: 'b1', mode: 'now' } })
    expect(receipt).toMatchObject({ status: 'rejected', error: { code: 'FORBIDDEN' } })
    expect(records('call')).toEqual([])
  })

  test('docs.embed_view with a ref that is neither a saved view nor a query is rejected as VALIDATION', async () => {
    const harness = await seeded()
    const receipt = await harness.run({ type: 'docs.embed_view', target: docTarget, payload: { docRef: docTarget, blockId: 'b1', ref: { kind: 'nonsense' } } })
    expect(receipt).toMatchObject({ status: 'rejected', error: { code: 'VALIDATION' } })
  })

  test('docs.embed_view on a view the caller cannot read is FORBIDDEN', async () => {
    const viewDenied: Authorizer = { can: async (_p, verb, ref) => !(verb === 'read' && ref?.kind === 'base-view') }
    const harness = await seeded({ authorizer: viewDenied })
    const receipt = await harness.run({ type: 'docs.embed_view', target: docTarget, payload: { docRef: docTarget, blockId: 'b1', ref: { kind: 'saved-view', ref: { kind: 'base-view', id: U('view') } } } })
    expect(receipt).toMatchObject({ status: 'rejected', error: { code: 'FORBIDDEN' } })
    expect(records('doc-block')).toEqual([])
  })

  test('docs.create_from_messages on a chat the caller cannot read is FORBIDDEN', async () => {
    await seeded()
    // No access to the origin chat at all: neither read nor write.
    const noChannelRead: Authorizer = { can: async (_p, _verb, ref) => ref?.kind !== 'channel' }
    const guarded = memoryHarness({ authorizer: noChannelRead })
    const receipt = await guarded.run({ type: 'docs.create_from_messages', target: { kind: 'channel', id: U('chat') }, payload: { id: U('digest'), chatRef: { kind: 'channel', id: U('chat') }, seqs: [1], target: { new: { title: 'Digest' } }, format: 'plain' } })
    expect(receipt).toMatchObject({ status: 'rejected', error: { code: 'FORBIDDEN' } })
    expect(records('note').find(note => note.id === U('digest'))).toBeUndefined()
  })

  test('tasks.create_from_selection from a doc the caller cannot read is FORBIDDEN', async () => {
    const harness = await seeded()
    const noRead: Authorizer = { can: async (_p, verb, ref) => !(verb === 'read' && ref?.kind === 'note') }
    const guarded = memoryHarness({ authorizer: noRead })
    await guarded.run({ type: 'docs.create_document', payload: { id: U('doc'), title: 'Spec' } })
    const receipt = await guarded.run({ type: 'tasks.create_from_selection', payload: { id: U('sel'), origin: { kind: 'doc-block', docRef: `note:${U('doc')}`, blockId: 'b1' }, title: 'x' } })
    expect(receipt).toMatchObject({ status: 'rejected', error: { code: 'FORBIDDEN' } })
    expect(records('task').find(task => task.id === U('sel'))).toBeUndefined()
    expect(harness).toBeDefined()
  })

  test('tasks.create_many_from_checklist on a doc the caller cannot write is FORBIDDEN and creates no task', async () => {
    const harness = await seeded({ authorizer: docWriteDenied })
    const receipt = await harness.run({ type: 'tasks.create_many_from_checklist', target: docTarget, payload: { docRef: docTarget, blockIds: ['b1'] } })
    expect(receipt).toMatchObject({ status: 'rejected', error: { code: 'FORBIDDEN' } })
    expect(records('task')).toEqual([])
  })

  test('calendar.create_event_from_message in a chat the caller left is FORBIDDEN', async () => {
    const harness = await seeded()
    await harness.run({ type: 'im.leave_chat', target: { kind: 'channel', id: U('chat') }, payload: {} })
    const receipt = await harness.run({ type: 'calendar.create_event_from_message', payload: { id: U('ev'), origin: { kind: 'message', chatRef: `channel:${U('chat')}`, seq: 1 }, attendees: 'chat' } })
    expect(receipt).toMatchObject({ status: 'rejected', error: { code: 'FORBIDDEN' } })
    expect(records('calendar-event')).toEqual([])
  })

  test('im.create_chat without access to the workspace is FORBIDDEN', async () => {
    const receipt = await memoryHarness({ authorizer: denyAll }).run({ type: 'im.create_chat', payload: { id: U('c'), kind: 'group', name: 'n', visibility: 'public', members: [] } })
    expect(receipt).toMatchObject({ status: 'rejected', error: { code: 'FORBIDDEN' } })
  })

  test('vc.start_meeting with a participant the caller cannot read is FORBIDDEN and opens no call', async () => {
    const noRead: Authorizer = { can: async (_p, verb, ref) => !(verb === 'read' && ref?.kind === 'person') }
    const harness = memoryHarness({ authorizer: noRead })
    const receipt = await harness.run({ type: 'vc.start_meeting', payload: { id: U('call'), participants: [BOB] } })
    expect(receipt).toMatchObject({ status: 'rejected', error: { code: 'FORBIDDEN' } })
    expect(records('call')).toEqual([])
  })
})
