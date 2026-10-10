/**
 * W1-14 (#1511) — Collaboration handler tests (TECH-SPEC §11).
 *
 * Every case here is a rule the spec states and a hand-written handler could
 * get wrong: the ephemeral presence write (no `domain_event`), the monotonic
 * read receipt, one decision per suggestion, the debounced doc view, and the
 * redaction of other people's calendars.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { Authorizer } from '@rox/core/commands'
import { InMemoryCommandStore } from '../../commands/store'
import { collabPresenceStore, configureCollabRuntime, resetCollabRuntime } from '../reference-handlers'
import { configureReferenceRuntime, referenceMemoryRecords, resetReferenceMemory, resetReferenceRuntime } from '../../work/reference'
import { createHarness, seedReferenceChat } from '../../work/__tests__/reference-harness'
import { ACTOR_ID, BOB, U, WORKSPACE_ID } from '../../work/__tests__/reference-scenario'

const NOW = new Date('2026-10-08T12:00:00.000Z')
const ALLOW_ALL: Authorizer = { can: async () => true }

let clock = NOW
function memoryHarness(options: { authorizer?: Authorizer } = {}) {
  return createHarness({ local: new InMemoryCommandStore(), workspace: new InMemoryCommandStore(), authorizer: options.authorizer ?? ALLOW_ALL })
}

beforeEach(() => {
  clock = NOW
  resetReferenceMemory()
  resetCollabRuntime()
  configureReferenceRuntime({ now: () => clock })
})
afterEach(() => {
  resetCollabRuntime()
  resetReferenceRuntime()
})

const records = (collection: string) => referenceMemoryRecords(WORKSPACE_ID, collection)

describe('presence (§11.1)', () => {
  test('presence.heartbeat writes the ephemeral store and no domain event', async () => {
    const harness = memoryHarness()
    const receipt = await harness.run({ type: 'presence.heartbeat', payload: { status: 'online', device: 'desktop' } })
    expect(receipt.status).toBe('applied')
    expect(receipt.result).toMatchObject({ status: 'online', topic: `user:${ACTOR_ID}` })
    expect(receipt.eventIds ?? []).toEqual([])
    // 60 s of no heartbeat: the record is gone.
    expect(collabPresenceStore().statusOf(WORKSPACE_ID, ACTOR_ID, NOW.getTime())).toBe('online')
    expect(collabPresenceStore().statusOf(WORKSPACE_ID, ACTOR_ID, NOW.getTime() + 61_000)).toBe('offline')
  })

  test('presence.changed is throttled: the second transition inside 5 s notifies nobody', async () => {
    const harness = memoryHarness()
    collabPresenceStore().setAudienceLookup(async () => [BOB])
    const online = await harness.run({ type: 'presence.heartbeat', payload: { status: 'online', device: 'web' } })
    expect(online.result).toMatchObject({ status: 'online', notify: [BOB] })
    // The very next transition is inside the 5 s window: nobody is told.
    const away = await harness.run({ type: 'presence.heartbeat', payload: { status: 'away', device: 'web' } })
    expect(away.result).toMatchObject({ status: 'away', notify: [] })
    // After the window the transition is published again.
    clock = new Date(NOW.getTime() + 5_000)
    const back = await harness.run({ type: 'presence.heartbeat', payload: { status: 'online', device: 'web' } })
    expect(back.result).toMatchObject({ notify: [BOB] })
  })

  test('presence.join and presence.leave keep the object viewer set', async () => {
    const harness = memoryHarness()
    const ref = { kind: 'note' as const, id: U('doc') }
    const joined = await harness.run({ type: 'presence.join', payload: { ref } })
    expect(joined.result).toMatchObject({ viewers: [ACTOR_ID], topic: `entity:note:${U('doc')}` })
    const bob = await harness.run({ type: 'presence.join', payload: { ref }, actor: BOB })
    expect((bob.result as { viewers: string[] }).viewers).toEqual([ACTOR_ID, BOB].sort())
    const left = await harness.run({ type: 'presence.leave', payload: { ref }, actor: BOB })
    expect(left.result).toMatchObject({ viewers: [ACTOR_ID] })
  })
})

describe('read receipts (§11.7)', () => {
  async function chat(): Promise<ReturnType<typeof memoryHarness>> {
    const harness = memoryHarness()
    // W1-11 (#1508) owns `im.create_chat` on the agent runtime, which this
    // reference harness does not back, so the channel and membership rows are
    // seeded straight into the reference store `im.mark_read` reads
    // (see `seedReferenceChat`).
    await seedReferenceChat({ id: U('chat'), ownerId: ACTOR_ID, memberIds: [BOB], kind: 'group', name: 'general', visibility: 'public' })
    return harness
  }

  test('im.mark_read: last_read_seq is a monotonic max, and read.changed is throttled', async () => {
    const harness = await chat()
    const target = { kind: 'channel' as const, id: U('chat') }
    expect(await harness.run({ type: 'im.mark_read', target, payload: { seq: 5 } })).toMatchObject({ status: 'applied', result: { lastReadSeq: 5, emitted: true } })
    // An older seq never moves the mark back.
    expect(await harness.run({ type: 'im.mark_read', target, payload: { seq: 2 } })).toMatchObject({ result: { lastReadSeq: 5, emitted: false } })
    clock = new Date(NOW.getTime() + 2_000)
    expect(await harness.run({ type: 'im.mark_read', target, payload: { seq: 9 } })).toMatchObject({ result: { lastReadSeq: 9, emitted: true } })
    const member = records('channel-member').find(row => row.data.chatId === U('chat') && row.data.principalId === ACTOR_ID)!
    expect(member.data).toMatchObject({ lastReadSeq: 9 })
  })

  test('im.mark_read on a chat you are not a member of is FORBIDDEN and writes nothing', async () => {
    const harness = memoryHarness()
    // W1-11 owns `im.create_chat`; the chat is seeded without BOB so the
    // non-member path runs against the store `im.mark_read` reads.
    await seedReferenceChat({ id: U('closed'), ownerId: ACTOR_ID, kind: 'group', name: 'closed', visibility: 'public' })
    const target = { kind: 'channel' as const, id: U('closed') }
    const receipt = await harness.run({ type: 'im.mark_read', target, payload: { seq: 3 }, actor: BOB })
    expect(receipt).toMatchObject({ status: 'rejected', error: { code: 'FORBIDDEN' } })
    expect(records('channel-member').filter(row => row.data.chatId === U('closed') && row.data.principalId === BOB)).toEqual([])
  })
})

describe('suggestions and doc views (§11.3, §11.4)', () => {
  async function doc(): Promise<ReturnType<typeof memoryHarness>> {
    const harness = memoryHarness()
    await harness.run({ type: 'docs.create_document', payload: { id: U('doc'), title: 'Spec' } })
    return harness
  }
  const target = { kind: 'note' as const, id: U('doc') }

  test('a suggestion mark opens a row, sync stales the ones that vanished', async () => {
    const harness = await doc()
    await harness.run({ type: 'docs.suggest_changes', target, payload: { id: U('sugg-1'), kind: 'insert', anchor: { start: 'AAE=', end: 'AAI=', quote: 'x' }, summary: 'Insert «x»' } })
    await harness.run({ type: 'docs.suggest_changes', target, payload: { id: U('sugg-2'), kind: 'delete', anchor: { start: 'AAE=', end: 'AAI=', quote: 'y' }, summary: 'Delete «y»' } })
    const synced = await harness.run({ type: 'docs.sync_suggestions', target, payload: { suggestionIds: [U('sugg-1')] } })
    expect(synced).toMatchObject({ status: 'applied', result: { staled: [U('sugg-2')] } })
    expect(records('doc-suggestion').find(row => row.id === U('sugg-2'))!.data.status).toBe('stale')
    // The mark is back: the row opens again.
    const again = await harness.run({ type: 'docs.sync_suggestions', target, payload: { suggestionIds: [U('sugg-1'), U('sugg-2')] } })
    expect(again).toMatchObject({ result: { updated: [U('sugg-2')] } })
    expect(records('doc-suggestion').find(row => row.id === U('sugg-2'))!.data.status).toBe('open')
  })

  test('docs.decide_suggestion rejects a second decision', async () => {
    const harness = await doc()
    await harness.run({ type: 'docs.suggest_changes', target, payload: { id: U('sugg'), kind: 'insert', anchor: { start: 'AAE=', end: 'AAI=' }, summary: 'Insert «x»' } })
    expect(await harness.run({ type: 'docs.decide_suggestion', target, payload: { suggestionId: U('sugg'), decision: 'accepted' } })).toMatchObject({ status: 'applied', result: { status: 'accepted' } })
    const twice = await harness.run({ type: 'docs.decide_suggestion', target, payload: { suggestionId: U('sugg'), decision: 'rejected' } })
    expect(twice).toMatchObject({ status: 'rejected', error: { code: 'VALIDATION' } })
    expect(twice.error!.message).toContain('already')
  })

  test('docs.decide_suggestion: a commenter cannot accept someone else\'s suggestion (FORBIDDEN)', async () => {
    const harness = await doc()
    await harness.run({ type: 'docs.suggest_changes', target, payload: { id: U('sugg'), kind: 'insert', anchor: { start: 'AAE=', end: 'AAI=' }, summary: 'Insert «x»' } })
    // BOB may read the doc (commenter) but not write it (editor).
    const commenter: Authorizer = { can: async (_p, verb) => verb !== 'write' && verb !== 'share' && verb !== 'destroy' }
    const guarded = memoryHarness({ authorizer: commenter })
    const receipt = await guarded.run({ type: 'docs.decide_suggestion', target, payload: { suggestionId: U('sugg'), decision: 'accepted' }, actor: BOB })
    expect(receipt).toMatchObject({ status: 'rejected', error: { code: 'FORBIDDEN' } })
    expect(records('doc-suggestion').find(row => row.id === U('sugg'))!.data.status).toBe('open')
  })

  test('docs.record_view is debounced and never moves first_viewed_at', async () => {
    const harness = await doc()
    expect(await harness.run({ type: 'docs.record_view', target, payload: {} })).toMatchObject({ result: { written: true, viewCount: 1 } })
    clock = new Date(NOW.getTime() + 60_000)
    expect(await harness.run({ type: 'docs.record_view', target, payload: {} })).toMatchObject({ result: { written: false, viewCount: 1 } })
    clock = new Date(NOW.getTime() + 11 * 60_000)
    expect(await harness.run({ type: 'docs.record_view', target, payload: {} })).toMatchObject({ result: { written: true, viewCount: 2 } })
    const view = records('doc-view')[0]!
    expect(view.data).toMatchObject({ viewCount: 2, firstViewedAt: NOW.toISOString() })
  })
})

describe('free-busy (§11.9)', () => {
  const range = { start: '2026-10-09T00:00:00.000Z', end: '2026-10-10T00:00:00.000Z' }

  test('calendar.free_busy returns busy blocks only, never the title', async () => {
    const harness = memoryHarness()
    await harness.run({ type: 'calendar.create_calendar', payload: { id: U('cal'), name: 'Team' } })
    await harness.run({
      type: 'calendar.create_event',
      target: { kind: 'calendar', id: U('cal') },
      payload: { id: U('ev'), calendarRef: { kind: 'calendar', id: U('cal') }, title: 'Salary review', start: '2026-10-09T10:00:00Z', end: '2026-10-09T11:00:00Z', tz: 'UTC' },
    })
    // The reference query reads the default calendar index, so seed it under the caller's own calendar id.
    configureCollabRuntime({
      freeBusyEvents: async () => [{ startAt: '2026-10-09T10:00:00.000Z', endAt: '2026-10-09T11:00:00.000Z', transparency: 'opaque' }, { startAt: '2026-10-09T12:00:00.000Z', endAt: '2026-10-09T13:00:00.000Z', transparency: 'free' }],
    })
    const receipt = await harness.run({ type: 'calendar.free_busy', payload: { principals: [ACTOR_ID], range } })
    expect(receipt.status).toBe('applied')
    const result = receipt.result as { principals: Record<string, unknown[]> }
    expect(result.principals[ACTOR_ID]).toEqual([{ start: '2026-10-09T10:00:00.000Z', end: '2026-10-09T11:00:00.000Z', busy: true }])
    expect(JSON.stringify(receipt)).not.toContain('Salary review')
  })

  test('calendar.free_busy on a principal whose calendar you cannot read is FORBIDDEN', async () => {
    const denyPerson: Authorizer = { can: async (_p, verb, ref) => !(verb === 'read' && ref?.kind === 'person' && ref.id === BOB) }
    const harness = memoryHarness({ authorizer: denyPerson })
    const receipt = await harness.run({ type: 'calendar.free_busy', payload: { principals: [ACTOR_ID, BOB], range } })
    expect(receipt).toMatchObject({ status: 'rejected', error: { code: 'FORBIDDEN' } })
  })
})

describe('negative paths (PLAN §1.4)', () => {
  const denyAll: Authorizer = { can: async () => false }

  test('presence.heartbeat is FORBIDDEN without access to the workspace', async () => {
    const receipt = await memoryHarness({ authorizer: denyAll }).run({ type: 'presence.heartbeat', payload: { status: 'online', device: 'web' } })
    expect(receipt).toMatchObject({ status: 'rejected', error: { code: 'FORBIDDEN' } })
    expect(collabPresenceStore().statusOf(WORKSPACE_ID, ACTOR_ID, NOW.getTime())).toBe('offline')
  })

  test('presence.join is FORBIDDEN without access to the workspace', async () => {
    const receipt = await memoryHarness({ authorizer: denyAll }).run({ type: 'presence.join', payload: { ref: { kind: 'note', id: U('doc') } } })
    expect(receipt).toMatchObject({ status: 'rejected', error: { code: 'FORBIDDEN' } })
  })

  test('presence.leave is FORBIDDEN without access to the workspace', async () => {
    const receipt = await memoryHarness({ authorizer: denyAll }).run({ type: 'presence.leave', payload: { ref: { kind: 'note', id: U('doc') } } })
    expect(receipt).toMatchObject({ status: 'rejected', error: { code: 'FORBIDDEN' } })
  })

  test('docs.suggest_changes on a doc the caller cannot write is FORBIDDEN and writes nothing', async () => {
    const readOnly: Authorizer = { can: async (_p, verb) => verb === 'read' }
    const harness = memoryHarness({ authorizer: readOnly })
    await harness.run({ type: 'docs.create_document', payload: { id: U('doc'), title: 'Spec' } })
    const receipt = await harness.run({ type: 'docs.suggest_changes', target: { kind: 'note', id: U('doc') }, payload: { id: U('sugg'), kind: 'insert', anchor: { start: 'AAE=', end: 'AAI=' }, summary: 'Insert «x»' } })
    expect(receipt).toMatchObject({ status: 'rejected', error: { code: 'FORBIDDEN' } })
    expect(records('doc-suggestion')).toEqual([])
  })

  test('docs.sync_suggestions on a document the caller cannot read is FORBIDDEN', async () => {
    const noNote: Authorizer = { can: async (_p, _verb, ref) => ref?.kind !== 'note' }
    const harness = memoryHarness({ authorizer: noNote })
    const receipt = await harness.run({ type: 'docs.sync_suggestions', target: { kind: 'note', id: U('doc') }, payload: { suggestionIds: [] } })
    expect(receipt).toMatchObject({ status: 'rejected', error: { code: 'FORBIDDEN' } })
    expect(records('note')).toEqual([])
  })

  test('docs.record_view on a document the caller cannot read is FORBIDDEN', async () => {
    const noNote: Authorizer = { can: async (_p, _verb, ref) => ref?.kind !== 'note' }
    const harness = memoryHarness({ authorizer: noNote })
    const receipt = await harness.run({ type: 'docs.record_view', target: { kind: 'note', id: U('doc') }, payload: {} })
    expect(receipt).toMatchObject({ status: 'rejected', error: { code: 'FORBIDDEN' } })
    expect(records('doc-view')).toEqual([])
  })
})
