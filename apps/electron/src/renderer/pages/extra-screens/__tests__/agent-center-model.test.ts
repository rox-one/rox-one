import { describe, expect, test } from 'bun:test'
import { STUCK_AFTER_MS, buildAgentCenter, formatAgo, formatUsd, isStuck, normalizeCloudRuns, type CenterInput } from '../agents/agent-center-model'

const now = new Date(2026, 8, 29, 15).getTime()
const MIN = 60000

function input(patch: Partial<CenterInput> = {}): CenterInput {
  return {
    sessions: [
      { id: 'run', name: 'Идёт', isProcessing: true, lastMessageAt: now - 2 * MIN },
      { id: 'stuck', name: 'Застрял', isProcessing: true, lastMessageAt: now - 25 * MIN },
      { id: 'wait', name: 'Ждёт', isProcessing: true, lastMessageAt: now - 30 * MIN },
      { id: 'old', name: 'Вчера', lastMessageAt: now - 30 * 3600e3 },
      { id: 'idle', name: 'Сегодня', lastMessageAt: now - 60 * MIN },
    ],
    pendingPermissions: new Map([['wait', 2]]),
    pendingCredentials: new Map([['ghost', 1], ['empty', 0]]),
    cloudRuns: [
      { id: 'c1', name: 'Research', createdAt: now - MIN, state: 'running' },
      { id: 'c2', name: 'Old fail', createdAt: now - 72 * 3600e3, state: 'failed' },
      { id: 'c3', name: 'Fail', createdAt: now - 3600e3, state: 'failed' },
      { id: 'c4', name: 'Done', createdAt: now - 3600e3, state: 'done' },
    ],
    automations: [
      { id: 'a1', name: 'Утро', event: 'SchedulerTick', matcherIndex: 0, enabled: true, cron: '0 7 * * *' },
      { id: 'a2', name: 'Выкл', event: 'LabelAdd', matcherIndex: 0, enabled: false },
    ],
    now,
    budget: { limitUsd: 2, spentUsd: 0.7, reservedUsd: 0.2, unresolvedUsd: 0, remainingUsd: 1.1, exhausted: false },
    ...patch,
  }
}

describe('agent center model', () => {
  test('stuck = processing and silent for more than 10 minutes', () => {
    expect(isStuck({ id: 'a', name: 'a', isProcessing: true, lastMessageAt: now - STUCK_AFTER_MS - 1 }, now)).toBe(true)
    expect(isStuck({ id: 'a', name: 'a', isProcessing: true, lastMessageAt: now - MIN }, now)).toBe(false)
    expect(isStuck({ id: 'a', name: 'a', lastMessageAt: now - 3600e3 }, now)).toBe(false)
  })

  test('buckets are exclusive: waiting beats stuck beats running', () => {
    const c = buildAgentCenter(input())
    expect(c.running.map((s) => s.id)).toEqual(['run'])
    expect(c.stuck.map((s) => s.id)).toEqual(['stuck'])
    expect(c.waiting.map((w) => [w.session.id, w.permissions, w.credentials])).toEqual([['wait', 2, 0], ['ghost', 0, 1]])
  })

  test('cloud: active and recent failures only', () => {
    const c = buildAgentCenter(input())
    expect(c.cloudActive.map((r) => r.id)).toEqual(['c1'])
    expect(c.cloudFailed.map((r) => r.id)).toEqual(['c3'])
  })

  test('budget display uses the authoritative ledger, not session cost totals', () => {
    const c = buildAgentCenter(input())
    expect(c.budget).toMatchObject({ limitUsd: 2, spentUsd: 0.7, reservedUsd: 0.2, remainingUsd: 1.1, exhausted: false })
    expect(buildAgentCenter(input({ budget: { limitUsd: 1, spentUsd: 1, reservedUsd: 0, unresolvedUsd: 0, remainingUsd: 0, exhausted: true } })).budget?.exhausted).toBe(true)
    expect(buildAgentCenter(input({ budget: null })).budget).toBeNull()
  })

  test('automations split by enabled', () => {
    const c = buildAgentCenter(input())
    expect(c.automationsEnabled.map((a) => a.id)).toEqual(['a1'])
    expect(c.automationsPaused.map((a) => a.id)).toEqual(['a2'])
  })

  test('cloud runs normalization and formatting', () => {
    const n = normalizeCloudRuns({ enabled: true, runs: [{ id: 'x', name: '', createdAt: 1, status: { state: 'weird', usage: { promptTokens: 10, completionTokens: 5 } } }, { id: 'y', name: 'Y', createdAt: 2, status: null }] })
    expect(n.enabled).toBe(true)
    expect(n.runs[0]).toMatchObject({ name: 'x', state: 'unknown', tokens: 15 })
    expect(n.runs[1].state).toBe('unknown')
    expect(normalizeCloudRuns(null)).toEqual({ enabled: false, runs: [] })
    expect(formatUsd(0.004)).toBe('<$0.01')
    expect(formatUsd(1.234)).toBe('$1.23')
    expect(formatAgo(5 * MIN, 'ru')).toBe('5 мин')
    expect(formatAgo(3 * 3600e3, 'en')).toBe('3 h')
  })
})
