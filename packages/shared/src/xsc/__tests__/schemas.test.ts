/**
 * W1-14 (#1511) — Zod round-trips for the §12 cross-surface payloads.
 *
 * One valid round-trip and one rejection per command, so a schema cannot drift
 * away from the signature it implements without a red test.
 */

import { describe, expect, test } from 'bun:test'
import { XSC_COMMAND_TYPES } from '@rox/core/xsc'
import { XSC_COMMAND_SCHEMAS } from '../schemas'

const note = { kind: 'note' as const, id: 'd1' }
const messageOrigin = { kind: 'message' as const, chatRef: 'channel:c1', seq: 4 }
const docBlockOrigin = { kind: 'doc-block' as const, docRef: 'note:d1', blockId: 'b1' }
const valid: Record<string, Record<string, unknown>> = {
  'docs.insert_task_block': { docRef: note, blockId: 'b1', afterBlockId: 'b0', task: { title: 'Nested', assignee: 'p1' } },
  'tasks.create_from_selection': { origin: docBlockOrigin, title: 'From selection', due: '2026-10-10' },
  'tasks.create_many_from_checklist': { docRef: note, blockIds: ['b1', 'b2'], shared: { title: 'Item' } },
  'tasks.create_from_message': { origin: messageOrigin, title: 'From message', followers: ['p2'] },
  'docs.insert_event_block': { docRef: note, blockId: 'b1', event: { title: 'Kickoff', start: '2026-10-09T10:00:00Z', end: '2026-10-09T11:00:00Z' } },
  'calendar.create_event': { calendarRef: { kind: 'calendar', id: 'c1' }, title: 'Sync', start: '2026-10-09T10:00:00Z', end: '2026-10-09T11:00:00Z', tz: 'Europe/Moscow', attendees: [{ email: 'a@example.com' }] },
  'calendar.create_event_from_message': { origin: messageOrigin, attendees: 'chat' },
  'docs.insert_meeting_block': { docRef: note, blockId: 'b1', mode: 'now', event: { title: 'Standup', start: '2026-10-09T10:00:00Z', end: '2026-10-09T10:15:00Z' } },
  'vc.start_meeting': { participants: ['p1'], notesDocRef: 'note:d1' },
  'docs.embed_view': { docRef: note, blockId: 'b1', ref: { kind: 'saved-view', ref: { kind: 'base-view', id: 'v1' } } },
  'docs.create_from_messages': { chatRef: { kind: 'channel', id: 'c1' }, seqs: [1, 2], target: { new: { title: 'Digest' } }, format: 'quotes' },
  'im.create_chat': { kind: 'group', name: 'Team', visibility: 'private', members: ['p1', 'p2'], postingPolicy: 'admins' },
  'im.send_message': { chatRef: { kind: 'channel', id: 'c1' }, body: { type: 'doc' }, mentions: ['p1'], attribution: 'agent' },
  'agents.invoke': { agentRef: { kind: 'person', id: 'bot1' }, instruction: 'Summarise the thread', origin: messageOrigin, context: [note] },
}

describe('§12 payload schemas', () => {
  test('every command has a schema and a valid round-trip', () => {
    expect(Object.keys(XSC_COMMAND_SCHEMAS).sort()).toEqual([...XSC_COMMAND_TYPES].sort())
    for (const type of XSC_COMMAND_TYPES) {
      const schema = XSC_COMMAND_SCHEMAS[type]!
      const parsed = schema.parse(valid[type]!) as Record<string, unknown>
      for (const [key, value] of Object.entries(valid[type]!)) expect(parsed[key]).toEqual(value)
      // strict: an unknown member is a VALIDATION rejection
      expect(schema.safeParse({ ...valid[type]!, __unknown: 1 }).success).toBe(false)
      expect(schema.safeParse(null).success).toBe(false)
    }
  })

  test('a block command needs its client block id (rule 3)', () => {
    expect(XSC_COMMAND_SCHEMAS['docs.insert_task_block']!.safeParse({ docRef: note, task: { title: 'x' } }).success).toBe(false)
    expect(XSC_COMMAND_SCHEMAS['docs.embed_view']!.safeParse({ docRef: note, blockId: 'b1', ref: { kind: 'nope' } }).success).toBe(false)
  })

  test('an event cannot end before it starts', () => {
    const backwards = { title: 'x', start: '2026-10-09T11:00:00Z', end: '2026-10-09T10:00:00Z' }
    expect(XSC_COMMAND_SCHEMAS['calendar.create_event']!.safeParse({ ...backwards, tz: 'UTC' }).success).toBe(false)
    expect(XSC_COMMAND_SCHEMAS['docs.insert_event_block']!.safeParse({ docRef: note, blockId: 'b1', event: backwards }).success).toBe(false)
  })

  test('a message origin must carry its chat and seq', () => {
    expect(XSC_COMMAND_SCHEMAS['tasks.create_from_message']!.safeParse({ origin: { kind: 'message', chatRef: 'channel:c1' }, title: 'x' }).success).toBe(false)
    expect(XSC_COMMAND_SCHEMAS['docs.create_from_messages']!.safeParse({ seqs: [], target: { new: { title: 'x' } }, format: 'plain' }).success).toBe(false)
  })

  test('mentions and attendees are people, not free text', () => {
    expect(XSC_COMMAND_SCHEMAS['im.send_message']!.safeParse({ body: {}, mentions: [{ id: 'p1' }] }).success).toBe(false)
    expect(XSC_COMMAND_SCHEMAS['calendar.create_event']!.safeParse({ title: 'x', start: '2026-10-09T10:00:00Z', end: '2026-10-09T11:00:00Z', tz: 'UTC', attendees: [42] }).success).toBe(false)
    expect(XSC_COMMAND_SCHEMAS['calendar.create_event_from_message']!.safeParse({ origin: messageOrigin, attendees: [] }).success).toBe(false)
  })
})