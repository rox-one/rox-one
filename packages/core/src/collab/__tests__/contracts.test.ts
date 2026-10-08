/**
 * W1-14 (#1511) — Collaboration contract tests (TECH-SPEC §11).
 *
 * The frozen rules, each with the case that makes it non-trivial: presence TTL
 * and throttling, stable peer colours, anchor fallback, the suggestion decision
 * matrix, per-field conflict detection, receipt monotonicity and privacy, and
 * the free-busy redaction.
 */

import { describe, expect, test } from 'bun:test'
import {
  CALENDAR_ROLE_RANK, DOC_VIEW_DEBOUNCE_MS, FOLLOW_SCROLL_THROTTLE_MS, OBJECT_PRESENCE_TTL_SECONDS, PRESENCE_CHANGED_THROTTLE_MS,
  READ_RECEIPT_MEMBER_CAP, READ_RECEIPT_THROTTLE_MS, aclRoleForCalendarMember, anchorIsCollapsed, anchorResolution, applyFieldPatch,
  awarenessCapabilityFor, awarenessPeers, awarenessReadOnly, canDecideSuggestion, conflictingFields, decideFieldPatch, decodeBase64,
  decodeYAnchor, docViewers, effectiveCalendarRole, encodeBase64, encodeYAnchor, eventBlocksTime, followViewport, freeBusyBlocks,
  freeSlots, isFieldPatch, isPresenceStatus, liveViewers, mergeBusyBlocks, mergePresenceStatus, nextFieldRevisions, nextLastReadSeq,
  objectPresenceKey, peerColorFor, presenceAudience, presenceChangedAllowed, presenceKey, presenceTransition, readBy, readChangedAllowed,
  readChangedVisible, recordDocView, redactCalendarFrame, redactEventFields, redactForFreeBusy, staleSuggestionIds, statusForHeartbeat,
  suggestionStatusAfterSync, suggestionSummary,
} from '../index'
import type { RealtimeEventFrame } from '../../events/topics'
import type { CalendarEventTiming, DocSuggestion } from '../index'

const NOW = Date.parse('2026-10-08T12:00:00.000Z')
const doc = { kind: 'note' as const, id: 'doc-1' }

describe('presence (§11.1)', () => {
  test('keys, TTL and cadence are the spec values', () => {
    expect(presenceKey('ws', 'p')).toBe('presence:ws:p')
    expect(objectPresenceKey(doc)).toBe('presence:obj:note:doc-1')
    expect(OBJECT_PRESENCE_TTL_SECONDS).toBe(60)
    expect(PRESENCE_CHANGED_THROTTLE_MS).toBe(5_000)
  })

  test('a heartbeat derives the status: dnd wins, 5 idle minutes mean away', () => {
    expect(statusForHeartbeat('online', 0)).toBe('online')
    expect(statusForHeartbeat('online', 5 * 60_000)).toBe('away')
    expect(statusForHeartbeat('dnd', 10 * 60_000)).toBe('dnd')
    expect(isPresenceStatus('dnd')).toBe(true)
    expect(isPresenceStatus('busy')).toBe(false)
  })

  test('a transition needs a change; an expired record reads as coming online', () => {
    const stored = { status: 'online' as const, device: 'desktop' as const, lastActiveAt: new Date(NOW).toISOString() }
    expect(presenceTransition('p', stored, 'online', NOW)).toBeNull()
    expect(presenceTransition('p', stored, 'away', NOW)).toEqual({ principalId: 'p', from: 'online', to: 'away' })
    // 60 s later the record is gone: the same status is a change from offline.
    const expired = NOW + 61_000
    expect(presenceTransition('p', stored, 'online', expired)).toEqual({ principalId: 'p', from: null, to: 'online' })
  })

  test('presence.changed is throttled to one event per 5 s per principal', () => {
    const transition = { principalId: 'p', from: 'online' as const, to: 'away' as const }
    expect(presenceChangedAllowed(null, transition, NOW)).toBe(true)
    expect(presenceChangedAllowed(NOW, transition, NOW + 1_000)).toBe(false)
    expect(presenceChangedAllowed(NOW, transition, NOW + PRESENCE_CHANGED_THROTTLE_MS)).toBe(true)
  })

  test('an audience never contains the actor, and viewers expire with the TTL', () => {
    expect(presenceAudience('a', ['b', 'a', 'c', 'b'])).toEqual(['b', 'c'])
    expect(liveViewers([{ principalId: 'a', seenAt: NOW }, { principalId: 'b', seenAt: NOW - 61_000 }], NOW)).toEqual(['a'])
  })

  test('the merged status of two sources takes the strongest', () => {
    expect(mergePresenceStatus(['away', 'online'])).toBe('online')
    expect(mergePresenceStatus(['dnd', 'online'])).toBe('dnd')
    expect(mergePresenceStatus([])).toBe('offline')
  })
})

describe('awareness (§11.2)', () => {
  test('a peer colour is stable per principal and inside the 8-hue palette', () => {
    const first = peerColorFor('principal-1')
    expect(peerColorFor('principal-1')).toBe(first)
    expect(first).toMatch(/^oklch\(0\.62 0\.15 \d+\)$/)
    expect(new Set(Array.from({ length: 40 }, (_, index) => peerColorFor(`p-${index}`))).size).toBeGreaterThan(1)
  })

  test('roles decide what the connection may write', () => {
    expect(awarenessCapabilityFor('viewer')).toBe('view')
    expect(awarenessCapabilityFor('commenter')).toBe('suggest')
    expect(awarenessCapabilityFor('manager')).toBe('edit')
    expect(awarenessCapabilityFor(null)).toBeNull()
    expect(awarenessReadOnly('view')).toBe(true)
    expect(awarenessReadOnly('edit')).toBe(false)
  })

  test('peers are deduplicated and follow viewports are throttled', () => {
    const peers = awarenessPeers([
      { user: { id: 'a', name: 'Ann', color: '' }, viewport: { topBlockId: 'b1', offset: 10 } },
      { user: { id: 'a', name: 'Ann', color: '' } },
    ])
    expect(peers).toHaveLength(1)
    expect(peers[0]!.color).toBe(peerColorFor('a'))
    expect(followViewport(peers, 'a', null, NOW)).toEqual({ topBlockId: 'b1', offset: 10 })
    expect(followViewport(peers, 'a', NOW, NOW + FOLLOW_SCROLL_THROTTLE_MS - 1)).toBeNull()
    expect(followViewport(peers, 'missing', null, NOW)).toBeNull()
  })
})

describe('comment anchors (§11.3)', () => {
  test('base64 survives a round trip, including padding and high bytes', () => {
    for (const bytes of [new Uint8Array(0), new Uint8Array([0]), new Uint8Array([255, 254, 253]), new Uint8Array(Array.from({ length: 40 }, (_, index) => (index * 37) % 256))]) {
      expect(decodeBase64(encodeBase64(bytes))).toEqual(bytes)
    }
    expect(decodeBase64('****')).toBeNull()
    expect(decodeBase64('A')).toBeNull()
  })

  test('an anchor stores both relative positions, a quote and a block id', () => {
    const anchor = encodeYAnchor(new Uint8Array([1, 2, 3]), new Uint8Array([4, 5]), { quote: 'x'.repeat(400), blockId: 'b1' })
    expect(anchor.start).toBe(encodeBase64(new Uint8Array([1, 2, 3])))
    expect(anchor.quote!.length).toBe(200)
    expect(decodeYAnchor(anchor)).toEqual({ start: new Uint8Array([1, 2, 3]), end: new Uint8Array([4, 5]) })
    expect(decodeYAnchor({ start: '***', end: 'AAE=' })).toBeNull()
  })

  test('a collapsed range is the "text deleted" state', () => {
    expect(anchorIsCollapsed(7, 7)).toBe(true)
    expect(anchorResolution(7, 7)).toBe('deleted')
    expect(anchorResolution(7, 8)).toBe('resolved')
  })
})

describe('suggestions (§11.4)', () => {
  const suggestion = { status: 'open' as const, authorId: 'author' }

  test('an editor decides anything, the author withdraws, a commenter never decides', () => {
    expect(canDecideSuggestion('editor-1', suggestion, 'editor', 'accepted')).toEqual({ allowed: true })
    expect(canDecideSuggestion('author', suggestion, 'commenter', 'rejected')).toEqual({ allowed: true })
    expect(canDecideSuggestion('author', suggestion, 'commenter', 'accepted')).toEqual({ allowed: false, reason: 'not_commenter' })
    expect(canDecideSuggestion('other', suggestion, 'commenter', 'rejected')).toEqual({ allowed: false, reason: 'not_author' })
    expect(canDecideSuggestion('other', suggestion, 'viewer', 'rejected')).toEqual({ allowed: false, reason: 'forbidden' })
    expect(canDecideSuggestion('editor-1', { status: 'accepted', authorId: 'author' }, 'editor', 'rejected')).toEqual({ allowed: false, reason: 'already_decided' })
  })

  test('a mark that disappeared without a decision goes stale, and opens again', () => {
    const open: DocSuggestion[] = [
      { suggestionId: 's1', docId: 'd', authorId: 'a', kind: 'insert', anchor: { start: 'AAE=', end: 'AAI=' }, summary: 'Insert «x»', status: 'open', createdAt: 'now' },
      { suggestionId: 's2', docId: 'd', authorId: 'a', kind: 'delete', anchor: { start: 'AAE=', end: 'AAI=' }, summary: 'Delete «y»', status: 'accepted', createdAt: 'now' },
    ]
    expect(staleSuggestionIds(open, ['s2'])).toEqual(['s1'])
    expect(suggestionStatusAfterSync('open', false)).toBe('stale')
    expect(suggestionStatusAfterSync('stale', true)).toBe('open')
    expect(suggestionStatusAfterSync('accepted', false)).toBe('accepted')
  })

  test('the stored summary is the DDL shape', () => {
    expect(suggestionSummary('insert', '  quarterly review ')).toBe('Insert «quarterly review»')
    expect(suggestionSummary('format', '')).toBe('Format')
  })
})

describe('per-field conflicts (§11.6)', () => {
  test('only fields that moved after expectedRevision conflict', () => {
    const revisions = { title: 5, dueAt: 2, notes: 5 }
    expect(conflictingFields({ title: 'x', dueAt: 'y' }, revisions, 4)).toEqual(['title'])
    expect(conflictingFields({ dueAt: 'y' }, revisions, 4)).toEqual([])
    expect(conflictingFields({ title: 'x', notes: 'n' }, revisions, 5)).toEqual([])
  })

  test('the decision applies non-overlapping fields and rejects the overlapping one', () => {
    const applied = decideFieldPatch({ title: 'a', dueAt: 'd', assigneeIds: [] }, { title: 1, dueAt: 1 }, 2, { assigneeIds: ['bob'] }, 1)
    expect(applied).toEqual({ status: 'applied', merged: { title: 'a', dueAt: 'd', assigneeIds: ['bob'] } })

    const conflicted = decideFieldPatch({ title: 'theirs' }, { title: 4 }, 6, { title: 'mine' }, 3, { kind: 'task', id: 't1' })
    expect(conflicted.status).toBe('conflict')
    if (conflicted.status !== 'conflict') throw new Error('unreachable')
    expect(conflicted.conflict).toMatchObject({
      code: 'CONFLICT',
      currentRevision: 6,
      ref: { kind: 'task', id: 't1' },
      fields: [{ field: 'title', theirs: 'theirs', mine: 'mine', revision: 4 }],
    })
  })

  test('the field revisions advance only for the patched fields', () => {
    expect(nextFieldRevisions({ title: 1, dueAt: 1 }, { dueAt: 'x' }, 7)).toEqual({ title: 1, dueAt: 7 })
    expect(applyFieldPatch({ a: 1, b: 2 }, { b: null })).toEqual({ a: 1 })
    expect(isFieldPatch({ title: 'x' })).toBe(true)
    expect(isFieldPatch({ revision: 2 })).toBe(false)
  })
})

describe('read receipts and doc views (§11.7)', () => {
  test('last_read_seq only moves forward, and read.changed is throttled', () => {
    expect(nextLastReadSeq(3, 5)).toBe(5)
    expect(nextLastReadSeq(5, 3)).toBe(5)
    expect(nextLastReadSeq(undefined, 1)).toBe(1)
    expect(readChangedAllowed(null, NOW)).toBe(true)
    expect(readChangedAllowed(NOW, NOW + READ_RECEIPT_THROTTLE_MS - 1)).toBe(false)
  })

  test('"Read by" is computed per member and hidden above the cap', () => {
    const members = [
      { principalId: 'a', lastReadSeq: 5, readAt: 't' },
      { principalId: 'b', lastReadSeq: 4 },
      { principalId: 'c', lastReadSeq: 5, readAt: 't2' },
    ]
    expect(readBy(members, 5)).toEqual({ shown: true, read: ['a', 'c'], unread: ['b'], readAt: { a: 't', c: 't2' } })
    const many = Array.from({ length: READ_RECEIPT_MEMBER_CAP + 1 }, (_, index) => ({ principalId: `p${index}`, lastReadSeq: 1 }))
    expect(readBy(many, 1).shown).toBe(false)
  })

  test('the DM privacy switch hides both sides of the receipt', () => {
    expect(readChangedVisible('dm', { principalId: 'a', shareReadReceipts: true }, { principalId: 'b', shareReadReceipts: true })).toBe(true)
    expect(readChangedVisible('dm', { principalId: 'a', shareReadReceipts: false }, { principalId: 'b', shareReadReceipts: true })).toBe(false)
    expect(readChangedVisible('dm', { principalId: 'a', shareReadReceipts: true }, { principalId: 'b', shareReadReceipts: false })).toBe(false)
    expect(readChangedVisible('group', { principalId: 'a', shareReadReceipts: false }, null)).toBe(true)
  })

  test('a doc view is debounced to one write per 10 minutes and keeps first_viewed_at', () => {
    const first = recordDocView(null, 'd1', 'p1', new Date(NOW).toISOString())
    expect(first).toEqual({ docId: 'd1', principalId: 'p1', firstViewedAt: new Date(NOW).toISOString(), lastViewedAt: new Date(NOW).toISOString(), viewCount: 1 })
    expect(recordDocView(first, 'd1', 'p1', new Date(NOW + 1_000).toISOString())).toBeNull()
    const later = recordDocView(first, 'd1', 'p1', new Date(NOW + DOC_VIEW_DEBOUNCE_MS).toISOString())
    expect(later).toMatchObject({ firstViewedAt: first!.firstViewedAt, viewCount: 2 })
    expect(docViewers([first!, later!]).map(viewer => viewer.principalId)).toEqual(['p1', 'p1'])
  })
})

describe('shared calendars and free-busy (§11.9)', () => {
  const range = { start: '2026-10-09T09:00:00.000Z', end: '2026-10-09T18:00:00.000Z' }

  test('the effective role is the strongest grant, and free_busy maps to the ACL special role', () => {
    expect(effectiveCalendarRole(['free_busy', 'viewer'])).toBe('viewer')
    expect(effectiveCalendarRole(['free_busy'])).toBe('free_busy')
    expect(effectiveCalendarRole([])).toBeNull()
    expect(CALENDAR_ROLE_RANK.owner).toBeGreaterThan(CALENDAR_ROLE_RANK.editor)
    expect(aclRoleForCalendarMember('free_busy')).toBe('free_busy')
    expect(aclRoleForCalendarMember('owner')).toBe('owner')
  })

  test('a free-busy viewer gets busy blocks: no title, no attendees', () => {
    const event: CalendarEventTiming & Record<string, unknown> = {
      startAt: '2026-10-09T10:00:00.000Z', endAt: '2026-10-09T11:00:00.000Z',
      title: '1:1 with Ann', description: 'secret', attendeeIds: ['ann'], location: 'Room 3', recap: 'private notes',
    }
    expect(redactForFreeBusy(event)).toEqual({ start: '2026-10-09T10:00:00.000Z', end: '2026-10-09T11:00:00.000Z', busy: true })
    const redacted = redactEventFields(event)
    expect(redacted).toMatchObject({ busy: true })
    expect(JSON.stringify(redacted)).not.toContain('Ann')
    expect(JSON.stringify(redacted)).not.toContain('secret')
    expect(JSON.stringify(redacted)).not.toContain('Room 3')
  })

  test('free and declined events do not block time; blocks are clipped to the range', () => {
    expect(eventBlocksTime({ startAt: '', endAt: '', transparency: 'free' })).toBe(false)
    expect(eventBlocksTime({ startAt: '', endAt: '', response: 'declined' })).toBe(false)
    const blocks = freeBusyBlocks([
      { startAt: '2026-10-09T08:00:00.000Z', endAt: '2026-10-09T10:00:00.000Z' },
      { startAt: '2026-10-09T17:00:00.000Z', endAt: '2026-10-09T20:00:00.000Z' },
      { startAt: '2026-10-09T12:00:00.000Z', endAt: '2026-10-09T13:00:00.000Z', transparency: 'transparent' },
      { startAt: '2026-10-10T12:00:00.000Z', endAt: '2026-10-10T13:00:00.000Z' },
    ], range)
    expect(blocks).toEqual([
      { start: '2026-10-09T09:00:00.000Z', end: '2026-10-09T10:00:00.000Z', busy: true },
      { start: '2026-10-09T17:00:00.000Z', end: '2026-10-09T18:00:00.000Z', busy: true },
    ])
  })

  test('overlapping blocks merge, and free slots avoid them', () => {
    const merged = mergeBusyBlocks([
      { start: '2026-10-09T10:00:00.000Z', end: '2026-10-09T11:00:00.000Z', busy: true },
      { start: '2026-10-09T10:30:00.000Z', end: '2026-10-09T12:00:00.000Z', busy: true },
    ])
    expect(merged).toEqual([{ start: '2026-10-09T10:00:00.000Z', end: '2026-10-09T12:00:00.000Z', busy: true }])
    const slots = freeSlots(merged, { start: '2026-10-09T10:00:00.000Z', end: '2026-10-09T13:00:00.000Z' }, 60)
    expect(slots).toEqual([{ start: '2026-10-09T12:00:00.000Z', end: '2026-10-09T13:00:00.000Z' }])
  })

  test('the calendar:{id} filter redacts event frames only for free_busy subscribers', () => {
    const frame: RealtimeEventFrame<Record<string, unknown>> = {
      frame: 'event', topic: 'calendar:c1', type: 'event.created', seq: 1, epoch: 'e', at: 'now',
      payload: { event: { startAt: '2026-10-09T10:00:00.000Z', endAt: '2026-10-09T11:00:00.000Z', title: 'Salary review' } },
    }
    const view = redactCalendarFrame(frame as RealtimeEventFrame, 'viewer')
    expect(JSON.stringify(view)).toContain('Salary review')
    const redacted = redactCalendarFrame(frame as RealtimeEventFrame, 'free_busy')
    expect(JSON.stringify(redacted)).not.toContain('Salary review')
    expect(redacted.payload).toEqual({ event: { startAt: '2026-10-09T10:00:00.000Z', endAt: '2026-10-09T11:00:00.000Z', busy: true } })
    const rsvp = redactCalendarFrame({ ...frame, type: 'rsvp.changed' } as RealtimeEventFrame, 'free_busy')
    expect(JSON.stringify(rsvp)).toContain('Salary review')
  })
})