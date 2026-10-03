import { describe, expect, it } from 'bun:test'
import type { Meeting } from '@rox/core/meetings'
import {
  bucketCounts,
  durationMs,
  groupMeetings,
  inBucket,
  pendingProposalCount,
  sourceKey,
  statusBadge,
  toMeetingView,
  upsertMeeting,
  type MeetingView,
  type ProposalWithMeeting,
} from '../meetings-model'

const NOW = new Date(2026, 8, 29, 15, 0).getTime()
const HOUR = 3_600_000

function view(id: string, status: string, createdAt?: number, extra: Partial<MeetingView> = {}): MeetingView {
  return { id, title: id, status, createdAt, updatedAt: createdAt, ...extra }
}

function proposal(id: string, meetingId: string, status: ProposalWithMeeting['status'] = 'proposed'): ProposalWithMeeting {
  return { id, title: id, status, source: 'native', type: 'create_task', payload: {}, meetingId }
}

describe('meetings view model', () => {
  it('maps catalog meetings with timestamps and source binding', () => {
    const meeting = {
      meetingId: 'm1', title: 'Sync', status: 'completed', createdAt: 1, updatedAt: 2,
      sourceBinding: { provider: 'native-journal', accountId: 'a', remoteType: 'import-intent', remoteId: 'm1' },
    } as unknown as Meeting
    expect(toMeetingView(meeting)).toEqual({
      id: 'm1', title: 'Sync', status: 'completed', createdAt: 1, updatedAt: 2,
      provider: 'native-journal', remoteType: 'import-intent',
    })
    expect(sourceKey(toMeetingView(meeting))).toBe('meetings.sourceImport')
    expect(sourceKey(view('x', 'planned'))).toBe('meetings.sourceLocal')
  })

  it('buckets live, planned, past, today and needs-action meetings', () => {
    const views = [
      view('live', 'capturing', NOW - HOUR),
      view('plan', 'planned', NOW - 2 * HOUR),
      view('done', 'completed', NOW - 26 * HOUR),
      view('fail', 'failed', NOW - 50 * HOUR),
    ]
    const proposals = [proposal('p1', 'done'), proposal('p2', 'done', 'applied')]
    const counts = bucketCounts(views, proposals, NOW)
    expect(counts).toEqual({ today: 2, upcoming: 1, past: 2, live: 1, needsAction: 2, all: 4 })
    expect(inBucket(views[2], 'needsAction', proposals, NOW)).toBe(true)
    expect(pendingProposalCount(proposals, 'done')).toBe(1)
    expect(pendingProposalCount(proposals)).toBe(1)
  })

  it('groups: now → planned → days newest first, undated last', () => {
    const groups = groupMeetings([
      view('old', 'completed', NOW - 72 * HOUR),
      view('y', 'completed', NOW - 24 * HOUR),
      view('t', 'completed', NOW - HOUR),
      view('plan', 'planned', NOW),
      view('rec', 'paused', NOW),
      view('nodate', 'cancelled'),
    ], NOW)
    expect(groups.map((g) => g.label.kind)).toEqual(['now', 'planned', 'today', 'yesterday', 'date', 'undated'])
    expect(groups[0].items.map((m) => m.id)).toEqual(['rec'])
  })

  it('derives a status badge with the pending proposal count', () => {
    expect(statusBadge(view('a', 'capturing'), [])).toEqual({ key: 'meetings.badge.rec', tone: 'danger' })
    expect(statusBadge(view('a', 'completed'), [proposal('p', 'a'), proposal('q', 'a')])).toEqual({ key: 'meetings.badge.waiting', tone: 'warning', count: 2 })
    expect(statusBadge(view('a', 'completed'), []).key).toBe('meetings.badge.done')
    expect(statusBadge(view('a', 'planned'), []).key).toBe('meetings.badge.planned')
  })

  it('upserts thin RPC rows over known metadata', () => {
    const list = [view('a', 'planned', 100)]
    const updated = upsertMeeting(list, { id: 'a', title: 'A', status: 'capturing' }, 500)
    expect(updated).toEqual([{ id: 'a', title: 'A', status: 'capturing', createdAt: 100, updatedAt: 500 }])
    const added = upsertMeeting(list, { id: 'b', title: 'B', status: 'planned' }, 700)
    expect(added[0]).toEqual({ id: 'b', title: 'B', status: 'planned', createdAt: 700, updatedAt: 700 })
  })

  it('reports duration only for finished meetings', () => {
    expect(durationMs(view('a', 'completed', 0, { updatedAt: 60_000 }))).toBe(60_000)
    expect(durationMs(view('a', 'capturing', 0, { updatedAt: 60_000 }))).toBeNull()
  })
})
