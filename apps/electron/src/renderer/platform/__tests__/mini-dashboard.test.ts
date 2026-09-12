import { describe, expect, it } from 'bun:test'
import type { TransportConnectionState } from '../../../shared/types'
import {
  buildMiniDashboard,
  formatDashboardCost,
  formatTokenCount,
  resolveSyncStatus,
} from '../mini-dashboard'

function connection(
  overrides: Partial<TransportConnectionState>,
): TransportConnectionState {
  return {
    mode: 'local',
    status: 'connected',
    url: 'local',
    attempt: 0,
    updatedAt: 1,
    ...overrides,
  }
}

describe('buildMiniDashboard — no fake numbers', () => {
  it('counts visible sessions as zero without inventing usage', () => {
    const snapshot = buildMiniDashboard({
      sessions: [],
      tasks: null,
      connection: null,
    })
    expect(snapshot.sessions).toBe(0)
    expect(snapshot.tokens).toBeNull()
    expect(snapshot.costUsd).toBeNull()
    expect(snapshot.activeAgents).toBe(0)
    expect(snapshot.tasks).toBeNull()
    expect(snapshot.sync).toBe('unknown')
  })

  it('does not treat missing tokenUsage as $0 / 0 tokens', () => {
    const snapshot = buildMiniDashboard({
      sessions: [
        { isProcessing: false },
        { hidden: true, tokenUsage: { totalTokens: 99, costUsd: 1 } },
        { isArchived: true, tokenUsage: { totalTokens: 99, costUsd: 1 } },
      ],
      tasks: null,
      connection: connection({ mode: 'local', status: 'connected' }),
    })
    expect(snapshot.sessions).toBe(1)
    expect(snapshot.tokens).toBeNull()
    expect(snapshot.costUsd).toBeNull()
    expect(snapshot.activeAgents).toBe(0)
  })

  it('sums only sessions that actually recorded usage', () => {
    const snapshot = buildMiniDashboard({
      sessions: [
        { tokenUsage: { totalTokens: 100, costUsd: 0.1 } },
        { tokenUsage: { totalTokens: 50, costUsd: 0.02 } },
        { isProcessing: true },
      ],
      tasks: 2,
      connection: connection({ mode: 'remote', status: 'connected' }),
    })
    expect(snapshot.sessions).toBe(3)
    expect(snapshot.tokens).toBe(150)
    expect(snapshot.costUsd).toBeCloseTo(0.12)
    expect(snapshot.activeAgents).toBe(1)
    expect(snapshot.tasks).toBe(2)
    expect(snapshot.sync).toBe('connected')
  })

  it('keeps an empty task list as zero after a real fetch, not unknown', () => {
    const snapshot = buildMiniDashboard({
      sessions: [],
      tasks: 0,
      connection: null,
    })
    expect(snapshot.tasks).toBe(0)
  })
})

describe('resolveSyncStatus', () => {
  it('does not label local+connected as cloud synced', () => {
    expect(resolveSyncStatus(connection({ mode: 'local', status: 'connected' }))).toBe('local')
  })

  it('maps remote connected, reconnecting, and failed without filling gaps', () => {
    expect(resolveSyncStatus(connection({ mode: 'remote', status: 'connected' }))).toBe('connected')
    expect(resolveSyncStatus(connection({ status: 'reconnecting' }))).toBe('syncing')
    expect(resolveSyncStatus(connection({ status: 'failed' }))).toBe('error')
    expect(resolveSyncStatus(null)).toBe('unknown')
  })
})

describe('formatters', () => {
  it('formats measured token and cost values', () => {
    expect(formatTokenCount(12)).toBe('12')
    expect(formatTokenCount(12_400)).toBe('12k')
    expect(formatDashboardCost(0)).toBe('$0.00')
    expect(formatDashboardCost(0.42)).toBe('$0.42')
  })
})
