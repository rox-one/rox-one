import { describe, expect, it } from 'bun:test'
import {
  buildAutomationsOverview,
  buildMeetingsOverview,
  buildWeekCalendar,
  formatDuration,
  recentCalls,
  taskTrackerStats,
  buildUsageOverview,
  connectionUsage,
  radarSignals,
  startOfLocalDay,
  topOpenTasks,
  usageByModel,
} from '../home/home-data'

const NOW = new Date(2026, 8, 29, 15, 0).getTime()
const DAY = 86_400_000

describe('home usage', () => {
  const sessions = [
    { model: 'rox/standard', llmConnection: 'rox', lastMessageAt: NOW - 60_000, tokenUsage: { totalTokens: 1000, costUsd: 0.5 } },
    { model: 'rox/max', llmConnection: 'rox', lastMessageAt: NOW - 2 * DAY, tokenUsage: { totalTokens: 3000, costUsd: 1 } },
    { llmConnection: 'rox', lastMessageAt: NOW - 3 * DAY },
    { model: 'old', lastMessageAt: NOW - 30 * DAY, tokenUsage: { totalTokens: 9999, costUsd: 9 } },
  ]

  it('buckets per local day over 7 days, attributing a session to its last activity', () => {
    const usage = buildUsageOverview(sessions, NOW, 7)
    expect(usage.days).toHaveLength(7)
    expect(usage.today.start).toBe(startOfLocalDay(NOW))
    expect(usage.today.tokens).toBe(1000)
    expect(usage.totalTokens).toBe(4000)
    expect(usage.totalCostUsd).toBeCloseTo(1.5)
    expect(usage.hasData).toBe(true)
  })

  it('reports no data honestly instead of zeros', () => {
    expect(buildUsageOverview([{ lastMessageAt: NOW }], NOW).hasData).toBe(false)
  })

  it('groups usage per model and per connection', () => {
    const since = NOW - 7 * DAY
    const models = usageByModel(sessions, since)
    expect(models.map((m) => m.model)).toEqual(['rox/max', 'rox/standard', ''])
    const conns = connectionUsage([
      { slug: 'rox', name: 'Rox', isAuthenticated: true, isDefault: true, defaultModel: 'rox/standard' },
      { slug: 'claude', name: 'Claude', isAuthenticated: false },
    ], sessions, since)
    expect(conns[0]).toMatchObject({ slug: 'rox', isDefault: true, sessions: 3, tokens: 4000 })
    expect(conns[1]).toMatchObject({ slug: 'claude', authenticated: false, sessions: 0 })
  })
})

describe('home automations / meetings / tasks / radar', () => {
  it('lists next scheduled runs and last failures', () => {
    const o = buildAutomationsOverview(
      [
        { id: 'a', name: 'Daily', enabled: true, cron: '0 9 * * *' },
        { id: 'b', name: 'Paused', enabled: false, cron: '0 9 * * *' },
        { id: 'c', name: 'Hook', enabled: true },
      ],
      { c: { ts: NOW - 1000, ok: false }, a: { ts: NOW - 5000, ok: true } },
      (a) => (a.cron ? NOW + 3600_000 : null),
      NOW,
    )
    expect(o.next.map((n) => n.id)).toEqual(['a'])
    expect(o.failures.map((f) => f.id)).toEqual(['c'])
    expect(o.enabled).toBe(2)
    expect(o.paused).toBe(1)
  })

  it('splits meetings into live, upcoming and the last finished one', () => {
    const o = buildMeetingsOverview([
      { id: 'p2', title: 'Later', status: 'planned', createdAt: 1, scheduledAt: NOW + 2 * DAY },
      { id: 'p1', title: 'Soon', status: 'planned', createdAt: 1, scheduledAt: NOW + 3600_000 },
      { id: 'old', title: 'Old', status: 'planned', createdAt: 1, scheduledAt: NOW - DAY },
      { id: 'r1', title: 'Done', status: 'ready', createdAt: 1, endedAt: NOW - 3600_000, transcript: { status: 'done' } },
      { id: 'r0', title: 'Older', status: 'ready', createdAt: 1, endedAt: NOW - DAY },
    ], NOW)
    expect(o.live).toBeNull()
    expect(o.upcoming.map((m) => m.id)).toEqual(['p1', 'p2'])
    expect(o.last?.id).toBe('r1')
  })

  it('ranks top open tasks: pinned, due, today list, priority', () => {
    const base = { list: 'anytime', priority: 'none', createdAt: 1 }
    const r = topOpenTasks([
      { ...base, id: 'done', title: 'd', completedAt: 5 },
      { ...base, id: 'high', title: 'h', priority: 'high' },
      { ...base, id: 'today', title: 't', list: 'today' },
      { ...base, id: 'overdue', title: 'o', dueAt: NOW - 2 * DAY },
      { ...base, id: 'pinned', title: 'p' },
    ], ['pinned'], NOW)
    expect(r.open).toBe(4)
    expect(r.overdue).toBe(1)
    expect(r.top.map((t) => t.id)).toEqual(['pinned', 'overdue', 'today', 'high'])
  })

  it('shows signals of the latest parsed sweep minus dismissed ones', () => {
    const r = radarSignals({
      topics: [{}],
      dismissed: ['x2'],
      sweeps: [
        { startedAt: 2, parsedAt: 3, items: [{ id: 'x1', title: 'A', bucket: 'changed', source: 's' }, { id: 'x2', title: 'B', bucket: 'reaction', source: 's' }, { id: 'x3', title: 'C', bucket: 'reaction', source: 's' }] },
        { startedAt: 1, parsedAt: 2, items: [{ id: 'old', title: 'O', bucket: 'reaction', source: 's' }] },
      ],
    })
    expect(r.items.map((i) => i.id)).toEqual(['x3', 'x1'])
    expect(r.sweptAt).toBe(2)
  })
})

describe('task tracker / calls / week calendar', () => {
  const now = new Date(2026, 8, 29, 14, 0).getTime()
  const day = 86_400_000
  const today = startOfLocalDay(now)
  const task = (id: string, extra: Record<string, unknown> = {}) => ({ id, title: id, list: 'anytime', priority: 'none', createdAt: now - 10 * day, ...extra })

  it('counts open / overdue / today / done and open tasks by list', () => {
    const stats = taskTrackerStats([
      task('a', { list: 'today' }),
      task('b', { dueAt: today - day }),
      task('c', { list: 'inbox', dueAt: today + 3600_000 }),
      task('d', { completedAt: now - 3600_000 }),
      task('e', { completedAt: now - 3 * day }),
      task('f', { cancelledAt: now }),
      task('g', { list: 'someday' }),
      task('trashed', { list: 'today', dueAt: today - day, completedAt: now, trashedAt: now }),
      task('trashed-open', { list: 'today', dueAt: today - day, trashedAt: now }),
    ], now)
    expect(stats).toEqual({ open: 4, overdue: 1, today: 2, doneToday: 1, doneWeek: 2, byList: { inbox: 1, today: 1, upcoming: 0, anytime: 1, someday: 1 } })
  })

  it('calls are recorded/imported meetings, newest first; planned-only meetings are not calls', () => {
    const m = (id: string, extra: Record<string, unknown>) => ({ id, title: id, status: 'ready' as const, createdAt: now, source: 'none', audio: null, durationMs: 0, ...extra })
    const calls = recentCalls([
      m('planned', { status: 'planned', scheduledAt: now + day }),
      m('old', { source: 'microphone', audio: {}, startedAt: now - 2 * day }),
      m('new', { source: 'import', audio: {}, startedAt: now - day }),
      m('live', { status: 'recording', source: 'microphone', startedAt: now }),
    ])
    expect(calls.map((c) => c.id)).toEqual(['live', 'new', 'old'])
    expect(formatDuration(65_000)).toBe('1:05')
    expect(formatDuration(3_725_000)).toBe('1:02:05')
  })

  it('builds 7 days from today: meetings, due tasks (overdue pinned to today), automation runs, notes', () => {
    const days = buildWeekCalendar({
      meetings: [{ id: 'm1', title: 'Sync', status: 'planned', createdAt: now - day, scheduledAt: today + day + 10 * 3600_000 }],
      tasks: [task('binned', { dueAt: today, trashedAt: now }), task('late', { dueAt: today - 2 * day }), task('soon', { dueAt: today + 2 * day }), task('done', { dueAt: today + day, completedAt: now }), task('far', { dueAt: today + 30 * day })],
      automationRuns: [{ id: 'a1', title: 'Digest', at: today + 9 * 3600_000 }, { id: 'a1', title: 'Digest', at: today + 8 * day }],
      notes: [{ id: 'n1', title: 'Idea', createdAt: now - 60_000 }, { id: 'n0', title: 'Old', createdAt: now - 5 * day }],
    }, now)
    expect(days).toHaveLength(7)
    expect(days[0]!.start).toBe(today)
    expect(days[0]!.events.map((e) => `${e.kind}:${e.title}`)).toEqual(['task:late', 'automation:Digest', 'note:Idea'])
    expect(days[0]!.events[0]!.overdue).toBe(true)
    expect(days[1]!.events.map((e) => e.id)).toEqual(['m1'])
    expect(days[2]!.events.map((e) => e.id)).toEqual(['soon'])
    expect(days.flatMap((d) => d.events).length).toBe(5)
  })
})
