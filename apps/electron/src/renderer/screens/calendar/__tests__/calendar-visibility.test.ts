import { describe, expect, it } from 'bun:test'
import { isMeetingShown, meetingAccountId, monthGrid, startOfDay, toggleHidden } from '../calendar-visibility'
import { buildCalendarSidebarSections } from '../calendar-sidebar-sections'

describe('calendar visibility', () => {
  const occ = new Map([['occ-1', 'acc-b']])
  it('joins recordings to accounts via identity JSON or occurrence id', () => {
    expect(meetingAccountId(JSON.stringify(['acc-a', 'primary', 'e1']), occ)).toBe('acc-a')
    expect(meetingAccountId('occ-1', occ)).toBe('acc-b')
    expect(meetingAccountId(undefined, occ)).toBeNull()
    expect(meetingAccountId('[broken', occ)).toBeNull()
  })
  it('hides only meetings of hidden calendars; ad-hoc always shown', () => {
    const hidden = new Set(['acc-a'])
    expect(isMeetingShown(JSON.stringify(['acc-a', 'p', 'e']), hidden, occ)).toBe(false)
    expect(isMeetingShown('occ-1', hidden, occ)).toBe(true)
    expect(isMeetingShown(undefined, hidden, occ)).toBe(true)
  })
  it('toggles hidden ids', () => {
    expect(toggleHidden(['a'], 'b')).toEqual(['a', 'b'])
    expect(toggleHidden(['a', 'b'], 'a')).toEqual(['b'])
  })
  it('month grid is 6 Monday-first weeks covering the month', () => {
    const grid = monthGrid(new Date(2026, 9, 14).getTime())
    expect(grid).toHaveLength(42)
    expect(new Date(grid[0]!).getDay()).toBe(1)
    expect(grid).toContain(startOfDay(new Date(2026, 9, 1).getTime()))
    expect(grid).toContain(startOfDay(new Date(2026, 9, 31).getTime()))
  })
  it('hidden calendars show "hidden" instead of the provider', () => {
    const secs = buildCalendarSidebarSections({
      meetings: [], counts: { all: 0, today: 0, upcoming: 0, past: 0, live: 0, needsAction: 0 },
      accounts: [{ id: 'a', provider: 'google', displayName: 'Work', status: 'connected' }],
      hiddenAccounts: new Set(['a']), now: 0, formatTime: String,
    })
    const row = secs.find((s) => s.id === 'calendars')!.items[0]!
    expect(row.secondaryKey).toBe('screens.calendar.hidden')
    expect(row.target).toEqual({ kind: 'source', sourceId: 'a' })
  })
})
