import { describe, expect, test } from 'bun:test'
import { emptyMeeting } from '@craft-agent/core/meetings'
import { queryMeetings } from '../queries.ts'

describe('meeting queries (RMA-I012)', () => {
  const items = Array.from({ length: 5 }, (_, i) => ({
    ...emptyMeeting({ workspaceId: 'ws', meetingId: `m${i}`, title: `Meet ${i}`, now: i }),
    private: i === 4,
  }))

  test('pagination, denied workspace, private source, stale cursor', () => {
    const page = queryMeetings({ items, workspaceId: 'ws', readableWorkspaceId: 'ws', limit: 2 })
    expect(page.page).toHaveLength(2)
    expect(page.continueCursor).toBe('2')
    const next = queryMeetings({ items, workspaceId: 'ws', readableWorkspaceId: 'ws', cursor: '2', limit: 2 })
    expect(next.page.map((item) => item.meetingId)).toEqual(['m2', 'm3'])
    expect(queryMeetings({ items, workspaceId: 'ws', readableWorkspaceId: 'other', limit: 10 }).denied).toBe(true)
    expect(queryMeetings({ items, workspaceId: 'ws', readableWorkspaceId: 'ws', limit: 10 }).page.some((item) => item.meetingId === 'm4')).toBe(false)
    expect(queryMeetings({ items, workspaceId: 'ws', readableWorkspaceId: 'ws', cursor: 'nope', limit: 2 }).page).toEqual([])
  })

  test('query filters journal titles and does not invent a live catalog', () => {
    const page = queryMeetings({
      items,
      workspaceId: 'ws',
      readableWorkspaceId: 'ws',
      query: 'meet 1',
      limit: 10,
    })
    expect(page.page.map((item) => item.meetingId)).toEqual(['m1'])
    expect(page.denied).toBe(false)
    expect(queryMeetings({
      items,
      workspaceId: 'ws',
      readableWorkspaceId: 'ws',
      query: 'live-sfu',
      limit: 10,
    }).page).toEqual([])
  })
})
