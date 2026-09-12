/**
 * Mini-dashboard snapshot — real counts only.
 * Missing measurements stay `null` (render "—"). Never coerce unknown to 0.
 */

import type { TransportConnectionState } from '../../shared/types'

export type SyncStatus =
  | 'unknown'
  | 'local'
  | 'connected'
  | 'syncing'
  | 'offline'
  | 'error'

export interface MiniDashboardSession {
  hidden?: boolean
  isArchived?: boolean
  isProcessing?: boolean
  tokenUsage?: {
    totalTokens?: number
    costUsd?: number
  }
}

export interface MiniDashboardSnapshot {
  sessions: number
  tokens: number | null
  costUsd: number | null
  activeAgents: number
  tasks: number | null
  sync: SyncStatus
}

export function isVisibleDashboardSession(session: MiniDashboardSession): boolean {
  return !session.hidden && !session.isArchived
}

export function resolveSyncStatus(
  connection: TransportConnectionState | null,
): SyncStatus {
  if (!connection) return 'unknown'
  switch (connection.status) {
    case 'failed':
      return 'error'
    case 'reconnecting':
    case 'connecting':
      return 'syncing'
    case 'disconnected':
    case 'idle':
      return 'offline'
    case 'connected':
      return connection.mode === 'remote' ? 'connected' : 'local'
    default: {
      const _exhaustive: never = connection.status
      return _exhaustive
    }
  }
}

export function buildMiniDashboard(input: {
  sessions: readonly MiniDashboardSession[]
  tasks: number | null
  connection: TransportConnectionState | null
}): MiniDashboardSnapshot {
  const visible = input.sessions.filter(isVisibleDashboardSession)
  let tokens = 0
  let costUsd = 0
  let usageCount = 0
  let activeAgents = 0

  for (const session of visible) {
    if (session.isProcessing) activeAgents += 1
    const usage = session.tokenUsage
    if (!usage) continue
    const hasTokens = Number.isFinite(usage.totalTokens)
    const hasCost = Number.isFinite(usage.costUsd)
    if (!hasTokens && !hasCost) continue
    usageCount += 1
    if (hasTokens) tokens += usage.totalTokens ?? 0
    if (hasCost) costUsd += usage.costUsd ?? 0
  }

  return {
    sessions: visible.length,
    tokens: usageCount > 0 ? tokens : null,
    costUsd: usageCount > 0 ? costUsd : null,
    activeAgents,
    tasks: input.tasks,
    sync: resolveSyncStatus(input.connection),
  }
}

export function formatTokenCount(tokens: number): string {
  if (tokens < 1000) return String(Math.round(tokens))
  if (tokens < 1_000_000) {
    const k = tokens / 1000
    return `${k >= 10 ? k.toFixed(0) : k.toFixed(1)}k`
  }
  return `${(tokens / 1_000_000).toFixed(1)}M`
}

export function formatDashboardCost(costUsd: number): string {
  if (costUsd === 0) return '$0.00'
  if (costUsd < 0.01) return '<$0.01'
  return `$${costUsd.toFixed(2)}`
}

export function syncStatusLabelKey(sync: SyncStatus): string {
  switch (sync) {
    case 'local':
      return 'dashboard.syncLocal'
    case 'connected':
      return 'dashboard.syncConnected'
    case 'syncing':
      return 'dashboard.syncSyncing'
    case 'offline':
      return 'dashboard.syncOffline'
    case 'error':
      return 'dashboard.syncError'
    case 'unknown':
      return 'dashboard.syncUnknown'
    default: {
      const _exhaustive: never = sync
      return _exhaustive
    }
  }
}
