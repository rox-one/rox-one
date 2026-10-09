import { describe, expect, test } from 'bun:test'
import {
  activityTotals,
  dailyTrend,
  formatCompactCount,
  primaryProjectId,
  sessionsInWindow,
  startOfLocalDay,
  startOfLocalWeek,
  topProjects,
  topSources,
  weeklyTrend,
  type ActivitySession,
} from '../activity-model'

const NOW = new Date(2026, 8, 29, 14, 0).getTime() // Tue 29 Sep 2026, 14:00 local
const DAY = 86_400_000

function session(id: string, patch: Partial<ActivitySession> = {}): ActivitySession {
  return { id, createdAt: NOW, lastMessageAt: NOW, messageCount: 1, ...patch }
}

describe('activity totals', () => {
  test('sums messages/tools/commits and nullable fields as zero', () => {
    const totals = activityTotals([
      session('a', { messageCount: 3, toolCallCount: 2, commitCount: 1, tokenUsage: { totalTokens: 100 } }),
      session('b', { messageCount: undefined, toolCallCount: null, commitCount: undefined, tokenUsage: null }),
      session('c', { messageCount: 4, tokenUsage: { totalTokens: 50 } }),
    ])
    expect(totals).toEqual({ sessions: 3, messages: 7, tokens: 150, toolCalls: 2, commits: 1 })
  })

  test('empty input yields zeros', () => {
    expect(activityTotals([])).toEqual({ sessions: 0, messages: 0, tokens: 0, toolCalls: 0, commits: 0 })
  })
})

describe('window boundaries', () => {
  test('day and week starts are local midnights; week starts Monday', () => {
    expect(startOfLocalDay(NOW)).toBe(new Date(2026, 8, 29).getTime())
    expect(new Date(startOfLocalWeek(NOW)).getDay()).toBe(1) // Monday
    expect(startOfLocalWeek(NOW)).toBe(new Date(2026, 8, 28).getTime())
    // Sunday belongs to the week that began the previous Monday.
    expect(startOfLocalWeek(new Date(2026, 8, 27, 23, 59).getTime())).toBe(new Date(2026, 8, 21).getTime())
  })

  test('sessionsInWindow is inclusive from, exclusive to', () => {
    const from = new Date(2026, 8, 29).getTime()
    const rows = [
      session('before', { lastMessageAt: from - 1 }),
      session('at', { lastMessageAt: from }),
      session('inside', { lastMessageAt: from + 100 }),
      session('after', { lastMessageAt: from + DAY }),
      session('none', { lastMessageAt: undefined, createdAt: undefined }),
    ]
    expect(sessionsInWindow(rows, from, from + DAY).map((s) => s.id)).toEqual(['at', 'inside'])
  })
})

describe('daily trend', () => {
  test('zero-fills the requested window, today last', () => {
    const rows = [
      session('d1', { lastMessageAt: startOfLocalDay(NOW) }),
      session('d2', { lastMessageAt: new Date(2026, 8, 28, 23, 59, 59, 999).getTime(), messageCount: 5 }),
      session('other', { lastMessageAt: new Date(2026, 8, 20).getTime() }), // outside 3-day window
    ]
    const points = dailyTrend(rows, NOW, 3)
    expect(points.map((p) => p.key)).toEqual(['2026-09-27', '2026-09-28', '2026-09-29'])
    expect(points.map((p) => p.sessions)).toEqual([0, 1, 1])
    expect(points[1].messages).toBe(5)
    expect(points[2].sessions).toBe(1)
  })

  test('a session just after midnight lands in the next day', () => {
    const points = dailyTrend([session('midnight', { lastMessageAt: new Date(2026, 8, 29).getTime() })], NOW, 2)
    expect(points.map((p) => [p.key, p.sessions])).toEqual([['2026-09-28', 0], ['2026-09-29', 1]])
  })

  test('non-positive window yields no buckets', () => {
    expect(dailyTrend([session('a')], NOW, 0)).toEqual([])
    expect(dailyTrend([session('a')], NOW, -5)).toEqual([])
  })
})

describe('weekly trend', () => {
  test('buckets by Monday-start weeks, Sunday excluded from the current week', () => {
    const rows = [
      session('sun', { lastMessageAt: new Date(2026, 8, 27, 23, 59).getTime() }),
      session('mon', { lastMessageAt: new Date(2026, 8, 28).getTime() }),
    ]
    const points = weeklyTrend(rows, NOW, 2)
    expect(points.map((p) => p.key)).toEqual(['2026-09-21', '2026-09-28'])
    expect(points.map((p) => p.sessions)).toEqual([1, 1])
  })

  test('zero weeks yields no buckets', () => {
    expect(weeklyTrend([session('a')], NOW, 0)).toEqual([])
  })
})

describe('top projects', () => {
  test('counts by primary project, resolves names, honours limit, keeps unknown id', () => {
    const rows = [
      session('a1', { projectId: 'alpha' }),
      session('a2', { projectId: 'alpha', messageCount: 4 }),
      session('b1', { projectId: 'beta' }),
      session('c1', { projectIds: ['gamma'] }),
      session('z1', { projectId: 'zeta' }),
      session('none'),
    ]
    const projects = [{ id: 'alpha', name: 'Alpha' }, { id: 'beta', name: 'Beta' }, { id: 'gamma', name: 'Gamma' }]
    expect(topProjects(rows, projects, 2)).toEqual([
      { id: 'alpha', name: 'Alpha', sessions: 2, messages: 5 },
      { id: 'beta', name: 'Beta', sessions: 1, messages: 1 },
    ])
    const all = topProjects(rows, projects, 10)
    expect(all.map((p) => p.id)).toEqual(['alpha', 'beta', 'gamma', 'zeta'])
    expect(all.find((p) => p.id === 'zeta')?.name).toBe('zeta')
    expect(topProjects(rows, projects, 0)).toEqual([])
  })

  test('primaryProjectId prefers projectId, then first projectIds', () => {
    expect(primaryProjectId({ projectId: 'x', projectIds: ['y'] })).toBe('x')
    expect(primaryProjectId({ projectIds: ['y', 'z'] })).toBe('y')
    expect(primaryProjectId({})).toBeNull()
  })
})

describe('top sources', () => {
  test('classifies agent families and sorts by volume', () => {
    const rows = [
      session('c1', { model: 'claude-sonnet' }),
      session('c2', { model: 'anthropic/claude-opus' }),
      session('o1', { llmConnection: 'rox-cli' }),
      session('x1', { model: 'gpt-5-codex' }),
    ]
    expect(topSources(rows, 5)).toEqual([
      { family: 'claude', sessions: 2 },
      { family: 'codex', sessions: 1 },
      { family: 'omp', sessions: 1 },
    ])
    expect(topSources(rows, 1)).toEqual([{ family: 'claude', sessions: 2 }])
    expect(topSources([], 5)).toEqual([])
  })
})

describe('formatCompactCount', () => {
  test('rounds under 1k, abbreviates k and M', () => {
    expect(formatCompactCount(999)).toBe('999')
    expect(formatCompactCount(1200)).toBe('1.2k')
    expect(formatCompactCount(25_000)).toBe('25k')
    expect(formatCompactCount(3_400_000)).toBe('3.4M')
    expect(formatCompactCount(Number.NaN)).toBe('0')
  })
})