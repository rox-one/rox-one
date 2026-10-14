import { describe, expect, it } from 'bun:test'
import { buildCalendarSidebarSections } from '../calendar-sidebar-sections'

const now = new Date(2026, 9, 14, 12, 0).getTime()
const at = (h: number, dayOffset = 0) => new Date(2026, 9, 14 + dayOffset, h, 0).getTime()
const counts = { all: 4, today: 2, upcoming: 1, past: 1, live: 1, needsAction: 2 }
const base = { counts, accounts: [], now, formatTime: (ts: number) => String(new Date(ts).getHours()) }

describe('buildCalendarSidebarSections', () => {
  it('Today: live first, then chronological; excludes other days', () => {
    const secs = buildCalendarSidebarSections({ ...base, meetings: [
      { id: 'b', title: 'Late', at: at(16), live: false },
      { id: 'a', title: 'Early', at: at(9), live: false },
      { id: 'y', title: 'Yesterday', at: at(9, -1), live: false },
      { id: 'l', title: '', at: at(8, -1), live: true },
    ] })
    const today = secs.find((s) => s.id === 'today')!
    expect(today.items.map((i) => i.id)).toEqual(['meeting:l', 'meeting:a', 'meeting:b'])
    expect(today.items[0]).toMatchObject({ badge: 'running', labelKey: 'screens.calendar.untitled' })
    expect(today.items[1]!.secondary).toBe('9')
  })
  it('recordings buckets carry counts and flag needs-action', () => {
    const rec = buildCalendarSidebarSections({ ...base, meetings: [] }).find((s) => s.id === 'recordings')!
    expect(rec.items.map((i) => [i.id, i.count])).toEqual([['bucket:all', 4], ['bucket:live', 1], ['bucket:needsAction', 2], ['bucket:upcoming', 1], ['bucket:past', 1]])
    expect(rec.items[2]!.badge).toBe('attention')
  })
  it('calendars list accounts (disconnected → status badge) plus a connect row', () => {
    const cal = buildCalendarSidebarSections({ ...base, meetings: [], accounts: [{ id: 'g', provider: 'google', displayName: 'Work', status: 'error' }] }).find((s) => s.id === 'calendars')!
    expect(cal.items.map((i) => i.id)).toEqual(['account:g', 'connect'])
    expect(cal.items[0]).toMatchObject({ label: 'Work', badge: 'status' })
    const none = buildCalendarSidebarSections({ ...base, meetings: [] }).find((s) => s.id === 'calendars')!
    expect(none.items[0]!.labelKey).toBe('meetings.screen.calendarsNone')
  })
})
