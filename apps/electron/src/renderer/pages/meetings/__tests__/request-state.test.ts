import { describe, expect, it } from 'bun:test'
import { EMPTY_MEETING_DRAFT, MeetingRequestTracker, clearSubmittedDraftFields, meetingStatusKey } from '../request-state'

describe('meeting request ownership', () => {
  it('coalesces duplicate clicks but allows independent meeting operations', () => {
    const tracker = new MeetingRequestTracker()
    tracker.setScope('workspace-a')
    const first = tracker.begin('note:first')!
    expect(tracker.begin('note:first')).toBeNull()
    expect(tracker.begin('note:second')).not.toBeNull()
    expect(first.finish()).toBe(true)
    expect(tracker.isPending('note:first')).toBe(false)
    expect(tracker.isPending('note:second')).toBe(true)
  })

  it('ignores results after switching away and back to the same workspace', () => {
    const tracker = new MeetingRequestTracker()
    tracker.setScope('a')
    const old = tracker.begin('start')!
    tracker.setScope('b')
    tracker.setScope('a')
    const current = tracker.begin('start')!
    expect(old.isCurrent()).toBe(false)
    expect(old.finish()).toBe(false)
    expect(current.isCurrent()).toBe(true)
  })

  it('lets a cleared search restart and prevents its old completion clearing the new request', () => {
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

  it('releases a rejected request for retry and invalidates unfinished work on unmount', async () => {
    const tracker = new MeetingRequestTracker()
    tracker.setScope('a')
    const token = tracker.begin('import')!
    try { await Promise.reject(new Error('Unavailable')) } catch {} finally { token.finish() }
    expect(tracker.isPending('import')).toBe(false)
    const retry = tracker.begin('import')!
    tracker.cancelAll()
    expect(retry.isCurrent()).toBe(false)
    expect(retry.finish()).toBe(false)
    expect(tracker.isPending('import')).toBe(false)
  })
})

describe('meeting form drafts and status labels', () => {
  it('only clears fields still equal to the successfully submitted text', () => {
    const draft = { ...EMPTY_MEETING_DRAFT, title: 'Task', noteText: 'Edited while saving', segmentId: 'segment-1', replacement: 'new correction' }
    const next = clearSubmittedDraftFields(draft, { title: 'Task', noteText: 'Old note', segmentId: 'segment-1', replacement: 'old correction' })
    expect(next).toEqual({ ...draft, title: '', segmentId: '' })
    expect(draft.title).toBe('Task')
  })

  it('maps known states to localizable labels and unknown states to a safe fallback', () => {
    expect(meetingStatusKey('capturing')).toBe('meetings.state.capturing')
    expect(meetingStatusKey('permission_required')).toBe('meetings.state.permission_required')
    expect(meetingStatusKey('<unsafe>')).toBe('common.unknown')
  })
})
