/**
 * Process-wide IPC invoke counters.
 *
 * Used by RoutedClient (preload) and the renderer perf harness.
 * No secrets. Counts and optional byte sizes only.
 */

export const WATCHED_SESSION_CHANNELS = [
  'sessions:get',
  'sessions:getPermissionModeState',
  'sessions:getMessages',
  'sessions:getUnreadSummary',
] as const

export type WatchedSessionChannel = (typeof WATCHED_SESSION_CHANNELS)[number]

export interface IpcCallRecord {
  channel: string
  count: number
  totalResultBytes: number
}

const calls = new Map<string, IpcCallRecord>()

export function recordIpcInvoke(channel: string, resultBytes = 0): void {
  const existing = calls.get(channel)
  if (existing) {
    existing.count += 1
    existing.totalResultBytes += resultBytes
    return
  }
  calls.set(channel, { channel, count: 1, totalResultBytes: resultBytes })
}

export function getIpcCallCount(channel: string): number {
  return calls.get(channel)?.count ?? 0
}

export function getIpcResultBytes(channel: string): number {
  return calls.get(channel)?.totalResultBytes ?? 0
}

export function snapshotIpcCalls(): Record<string, IpcCallRecord> {
  const out: Record<string, IpcCallRecord> = {}
  for (const [channel, record] of calls) {
    out[channel] = { ...record }
  }
  return out
}

export function deltaIpcCalls(
  before: Record<string, IpcCallRecord>,
  after: Record<string, IpcCallRecord> = snapshotIpcCalls(),
): Record<string, IpcCallRecord> {
  const channels = new Set([...Object.keys(before), ...Object.keys(after)])
  const out: Record<string, IpcCallRecord> = {}
  for (const channel of channels) {
    const a = after[channel]
    const b = before[channel]
    const count = (a?.count ?? 0) - (b?.count ?? 0)
    const totalResultBytes = (a?.totalResultBytes ?? 0) - (b?.totalResultBytes ?? 0)
    if (count !== 0 || totalResultBytes !== 0) {
      out[channel] = { channel, count, totalResultBytes }
    }
  }
  return out
}

export function clearIpcCalls(): void {
  calls.clear()
}

export function isWatchedSessionChannel(channel: string): channel is WatchedSessionChannel {
  return (WATCHED_SESSION_CHANNELS as readonly string[]).includes(channel)
}

export interface NPlusOneFinding {
  kind: 'permission-mode' | 'session-messages' | 'collection-reload'
  channel: string
  fanout: number
  sessionCount: number
}

/**
 * Detect session permission/metadata N+1 and unexpected collection reloads.
 * `sessionCount` is the indexed collection size for the window under test.
 */
export function detectSessionIpcNPlusOne(
  delta: Record<string, IpcCallRecord>,
  sessionCount: number,
  opts: { allowCollectionGet?: boolean; messagesAlreadyCached?: boolean } = {},
): NPlusOneFinding[] {
  const findings: NPlusOneFinding[] = []
  const getSessions = delta['sessions:get']?.count ?? 0
  const permission = delta['sessions:getPermissionModeState']?.count ?? 0
  const messages = delta['sessions:getMessages']?.count ?? 0

  if (!opts.allowCollectionGet && getSessions > 0) {
    findings.push({
      kind: 'collection-reload',
      channel: 'sessions:get',
      fanout: getSessions,
      sessionCount,
    })
  }

  if (sessionCount > 1 && permission >= sessionCount) {
    findings.push({
      kind: 'permission-mode',
      channel: 'sessions:getPermissionModeState',
      fanout: permission,
      sessionCount,
    })
  }

  if (opts.messagesAlreadyCached && messages > 0) {
    findings.push({
      kind: 'session-messages',
      channel: 'sessions:getMessages',
      fanout: messages,
      sessionCount,
    })
  }

  return findings
}

export function estimateJsonBytes(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).length
  } catch {
    return 0
  }
}
