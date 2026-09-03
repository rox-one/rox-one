import { diffIpc, IpcCallCounter } from './ipc-counter'
import { nowMs } from './stats'
import type { IpcCounts, SessionIndexEntry } from './types'

export interface WarmRendererCache {
  byId: Map<string, SessionIndexEntry>
  orderedIds: string[]
}

export interface SwitchResult {
  session: SessionIndexEntry
  durationMs: number
  ipc: IpcCounts
  reloadedCollection: boolean
}

export function warmRendererCache(sessions: SessionIndexEntry[]): WarmRendererCache {
  const byId = new Map<string, SessionIndexEntry>()
  const orderedIds: string[] = []
  for (const session of sessions) {
    byId.set(session.id, session)
    orderedIds.push(session.id)
  }
  return { byId, orderedIds }
}

/**
 * Cached session switch: O(1) map lookup. Must not call sessions.list
 * (that is a full collection reload).
 */
export function switchCachedSession(
  cache: WarmRendererCache,
  sessionId: string,
  ipc: IpcCallCounter,
): SwitchResult {
  const before = ipc.snapshot()
  const t0 = nowMs()

  const session = cache.byId.get(sessionId)
  if (!session) {
    throw new Error(`session ${sessionId} is not in the warm cache`)
  }

  ipc.record('sessions.get')
  ipc.record('sessions.permission')
  ipc.record('sessions.metadata')

  const durationMs = nowMs() - t0
  const delta = diffIpc(before, ipc.snapshot())
  return {
    session,
    durationMs,
    ipc: delta,
    reloadedCollection: (delta['sessions.list'] ?? 0) > 0,
  }
}

/** Anti-pattern used in tests: reload the whole collection on each switch. */
export function switchWithFullReload(
  sessions: SessionIndexEntry[],
  sessionId: string,
  ipc: IpcCallCounter,
): SwitchResult {
  const before = ipc.snapshot()
  const t0 = nowMs()
  ipc.record('sessions.list')
  const session = sessions.find((item) => item.id === sessionId)
  if (!session) throw new Error(`session ${sessionId} missing`)
  for (const item of sessions) {
    ipc.record('sessions.permission')
    ipc.record('sessions.metadata')
    void item.id
  }
  const durationMs = nowMs() - t0
  return {
    session,
    durationMs,
    ipc: diffIpc(before, ipc.snapshot()),
    reloadedCollection: true,
  }
}

export function pickSwitchTargets(cache: WarmRendererCache, n: number): string[] {
  const ids = cache.orderedIds
  if (ids.length < 2) throw new Error('need at least two cached sessions')
  const targets: string[] = []
  for (let i = 0; i < n; i++) {
    const id = ids[(i + 1) % ids.length]
    if (!id) throw new Error('empty fixture id')
    targets.push(id)
  }
  return targets
}
