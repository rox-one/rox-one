import { describe, expect, it } from 'bun:test'
import {
  buildAutomationsOverview,
  buildMeetingsOverview,
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
