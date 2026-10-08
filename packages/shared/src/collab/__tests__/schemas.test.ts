/**
 * W1-14 (#1511) — Zod round-trips for the collaboration payloads (§11).
 */

import { describe, expect, test } from 'bun:test'
import {
  COLLAB_COMMAND_SCHEMAS, busyBlockSchema, calendarMemberSchema, docSuggestionSchema, docViewSchema, fieldRevisionsSchema, freeBusySchema,
  markReadSchema, presenceHeartbeatSchema, presenceObjectSchema, yAnchorSchema,
} from '../schemas'

const anchor = { start: 'AAEC', end: 'AAED', quote: 'hello', blockId: 'b1' }

describe('collab payload schemas', () => {
  test('presence.heartbeat round-trips and rejects a bad status or device', () => {
    const parsed = presenceHeartbeatSchema.parse({ status: 'dnd', device: 'desktop', activeRef: { kind: 'task', id: 't1' } })
    expect(parsed).toEqual({ status: 'dnd', device: 'desktop', activeRef: { kind: 'task', id: 't1' } })
    expect(presenceHeartbeatSchema.safeParse({ status: 'online', device: 'toaster' }).success).toBe(false)
    expect(presenceHeartbeatSchema.safeParse({ status: 'busy', device: 'web' }).success).toBe(false)
    expect(presenceHeartbeatSchema.safeParse({ status: 'online', device: 'web', extra: 1 }).success).toBe(false)
  })

  test('presence.join / leave carry one ref', () => {
    expect(presenceObjectSchema.parse({ ref: { kind: 'note', id: 'd1' } })).toEqual({ ref: { kind: 'note', id: 'd1' } })
    expect(presenceObjectSchema.safeParse({ ref: { kind: 'nope', id: 'd1' } }).success).toBe(false)
    expect(presenceObjectSchema.safeParse({}).success).toBe(false)
  })

  test('calendar.free_busy needs a range that ends after it starts', () => {
    const ok = freeBusySchema.parse({ principals: ['p1'], range: { start: '2026-10-09T09:00:00Z', end: '2026-10-09T18:00:00Z' } })
    expect(ok.principals).toEqual(['p1'])
    expect(freeBusySchema.safeParse({ principals: [], range: { start: '2026-10-09T09:00:00Z', end: '2026-10-09T18:00:00Z' } }).success).toBe(false)
    expect(freeBusySchema.safeParse({ principals: ['p1'], range: { start: '2026-10-09T18:00:00Z', end: '2026-10-09T09:00:00Z' } }).success).toBe(false)
    expect(freeBusySchema.safeParse({ principals: ['p1'], range: { start: '2026-10-09T09:00:00Z', end: '2026-10-09T18:00:00Z' }, slotMinutes: 1 }).success).toBe(false)
  })

  test('im.mark_read takes only a seq', () => {
    expect(markReadSchema.parse({ seq: 12 })).toEqual({ seq: 12 })
    expect(markReadSchema.safeParse({ seq: -1 }).success).toBe(false)
    expect(markReadSchema.safeParse({ seq: 1, chatId: 'c' }).success).toBe(false)
  })

  test('the suggestion observer and the decision schemas', () => {
    expect(COLLAB_COMMAND_SCHEMAS['docs.sync_suggestions']!.parse({ suggestionIds: ['s1', 's2'] })).toEqual({ suggestionIds: ['s1', 's2'] })
    expect(COLLAB_COMMAND_SCHEMAS['docs.sync_suggestions']!.safeParse({ suggestionIds: 's1' }).success).toBe(false)
    expect(COLLAB_COMMAND_SCHEMAS['docs.decide_suggestion']!.parse({ suggestionId: 's1', decision: 'accepted' })).toEqual({ suggestionId: 's1', decision: 'accepted' })
    expect(COLLAB_COMMAND_SCHEMAS['docs.decide_suggestion']!.safeParse({ suggestionId: 's1', decision: 'maybe' }).success).toBe(false)
    expect(COLLAB_COMMAND_SCHEMAS['docs.record_view']!.parse({})).toEqual({})
    expect(COLLAB_COMMAND_SCHEMAS['docs.record_view']!.safeParse({ docId: 'd' }).success).toBe(false)
  })

  test('a suggestion mark needs a Y anchor', () => {
    const parsed = COLLAB_COMMAND_SCHEMAS['docs.suggest_changes']!.parse({ kind: 'insert', anchor, summary: 'add intro' })
    expect(parsed).toMatchObject({ kind: 'insert', summary: 'add intro' })
    expect(COLLAB_COMMAND_SCHEMAS['docs.suggest_changes']!.safeParse({ kind: 'block', anchor, summary: 'x' }).success).toBe(false)
    expect(COLLAB_COMMAND_SCHEMAS['docs.suggest_changes']!.safeParse({ kind: 'insert', anchor: { start: '', end: '' }, summary: 'x' }).success).toBe(false)
  })
})

describe('collab stored shapes', () => {
  test('the Y anchor keeps its quote bounded', () => {
    expect(yAnchorSchema.parse(anchor)).toEqual(anchor)
    expect(yAnchorSchema.safeParse({ start: 'AAEC', end: 'AAED', quote: 'x'.repeat(201) }).success).toBe(false)
    expect(yAnchorSchema.safeParse({ start: 'AAEC' }).success).toBe(false)
  })

  test('doc_suggestion / doc_view / calendar_member rows round-trip', () => {
    const suggestion = docSuggestionSchema.parse({
      suggestionId: 's1', docId: 'd1', authorId: 'a1', kind: 'insert', anchor, summary: 'Insert «x»',
      status: 'open', createdAt: '2026-10-08T12:00:00Z',
    })
    expect(suggestion.status).toBe('open')
    expect(docSuggestionSchema.safeParse({ ...suggestion, status: 'maybe' }).success).toBe(false)

    const view = docViewSchema.parse({ docId: 'd1', principalId: 'p1', firstViewedAt: '2026-10-08T12:00:00Z', lastViewedAt: '2026-10-08T12:05:00Z', viewCount: 2 })
    expect(view.viewCount).toBe(2)
    expect(docViewSchema.safeParse({ ...view, viewCount: 0 }).success).toBe(false)

    expect(calendarMemberSchema.parse({ calendarId: 'c1', subjectType: 'principal', subjectId: 'p1', role: 'free_busy', visible: true, notify: true, createdAt: '2026-10-08T12:00:00Z' }).role).toBe('free_busy')
    expect(calendarMemberSchema.safeParse({ calendarId: 'c1', subjectType: 'team', subjectId: 'p1', role: 'viewer', visible: true, notify: true, createdAt: '2026-10-08T12:00:00Z' }).success).toBe(false)
  })

  test('field_revisions and busy blocks', () => {
    expect(fieldRevisionsSchema.parse({ title: 3, dueAt: 1 })).toEqual({ title: 3, dueAt: 1 })
    expect(fieldRevisionsSchema.safeParse({ title: -1 }).success).toBe(false)
    expect(busyBlockSchema.parse({ start: '2026-10-09T10:00:00Z', end: '2026-10-09T11:00:00Z', busy: true }).busy).toBe(true)
    expect(busyBlockSchema.safeParse({ start: '2026-10-09T10:00:00Z', end: '2026-10-09T11:00:00Z', title: 'x', busy: true }).success).toBe(false)
  })
})