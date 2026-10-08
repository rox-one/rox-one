import { describe, expect, test } from 'bun:test'
import { EMPTY_MEETING_DRAFT, MeetingRequestTracker, clearSubmittedDraftFields, meetingStatusKey } from '../request-state'

describe('committed meeting request ownership', () => {
  test('coalesces duplicate writes while unrelated work remains independent', () => {
    const tracker = new MeetingRequestTracker()
    expect(tracker.begin('plan')).toBeNull()
    tracker.setScope('a')
    const first = tracker.begin('plan', 'a')!
    expect(tracker.begin('plan', 'a')).toBeNull()
    expect(tracker.begin('record', 'a')).not.toBeNull()
    expect(first.finish()).toBe(true)
    expect(tracker.isPending('plan')).toBe(false)
    expect(tracker.isPending('record')).toBe(true)
  })
  test('A → B → A and disposal never revive an old visit', () => {
    const tracker = new MeetingRequestTracker()
    tracker.setScope('a')
    const old = tracker.begin('plan')!
    tracker.setScope('b'); tracker.setScope('a')
    const current = tracker.begin('plan')!
    expect(old.isCurrent()).toBe(false)
    expect(old.finish()).toBe(false)
    expect(current.isCurrent()).toBe(true)
    tracker.setScope(undefined)
    expect(current.isCurrent()).toBe(false)
    expect(tracker.begin('plan', 'a')).toBeNull()
  })
  test('a foreign old callback cannot cancel a current latest read', () => {
    const tracker = new MeetingRequestTracker()
    tracker.setScope('b')
    const current = tracker.beginLatest('update:one', 'b')!
    expect(tracker.beginLatest('update:one', 'a')).toBeNull()
    expect(current.isCurrent()).toBe(true)
    const newer = tracker.beginLatest('update:one', 'b')!
    expect(current.isCurrent()).toBe(false)
    expect(current.finish()).toBe(false)
    expect(newer.isCurrent()).toBe(true)
  })
  test('a cancelled request can restart and its old completion never clears the new owner', () => {
    const tracker = new MeetingRequestTracker()
    tracker.setScope('a')
    const old = tracker.begin('search')!
    tracker.cancel('search')
    const current = tracker.begin('search')!
    expect(old.isCurrent()).toBe(false)
    expect(old.finish()).toBe(false)
    expect(tracker.isPending('search')).toBe(true)
    expect(current.finish()).toBe(true)
  })
  test('finishing rejected work permits retry without clearing a later owner', () => {
    const tracker = new MeetingRequestTracker()
    tracker.setScope(null)
    const first = tracker.begin('import')!
    expect(first.finish()).toBe(true)
    const retry = tracker.begin('import')!
    expect(first.finish()).toBe(false)
    expect(retry.isCurrent()).toBe(true)
    tracker.cancelAll()
    expect(retry.isCurrent()).toBe(false)
  })
})

describe('meeting form drafts and status labels', () => {
  test('only clears fields still equal to the successfully submitted text', () => {
    const draft = { ...EMPTY_MEETING_DRAFT, title: 'Task', noteText: 'Edited while saving', segmentId: 'segment-1', replacement: 'new correction' }
    const next = clearSubmittedDraftFields(draft, { title: 'Task', noteText: 'Old note', segmentId: 'segment-1', replacement: 'old correction' })
    expect(next).toEqual({ ...draft, title: '', segmentId: '' })
    expect(draft.title).toBe('Task')
  })

  test('maps known states to localizable labels and unknown states to a safe fallback', () => {
    expect(meetingStatusKey('capturing')).toBe('meetings.state.capturing')
    expect(meetingStatusKey('permission_required')).toBe('meetings.state.permission_required')
    expect(meetingStatusKey('<unsafe>')).toBe('common.unknown')
  })
})
