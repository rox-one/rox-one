import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { WorkspaceWorkSnapshot } from '@rox/shared/workspace-work'
import { getWorkspaceWorkClient, workspaceWorkFailure, type WorkspaceWorkErrorCode, type WorkspaceWorkMutation, type WorkspaceWorkRemoval } from './workspace-work-client'
import { hashKey } from '@tanstack/react-query'
import { isRecentlyRead, roxQueryClient } from './query/client'
import { roxKeys } from './query/keys'
import { cacheWriteEpoch, fencedSetQueryData, sharedRead } from './query/shared-read'
import { meetsAnnouncedRevision } from './query/workspace-work-revision'

/**
 * PERF-09 (#1576): the snapshot lives in the shared query cache (memory only,
 * keyed by workspace), so Tasks, Plan, Agents and the auxiliary panel share
 * one read, and a revisit paints the last snapshot at once
 * (stale-while-revalidate): the cached snapshot is shown and a background
 * read starts unless the entry was read less than ROX_REVALIDATE_AFTER_MS
 * ago and nothing newer was announced. Access flags, members and references
 * change without a workspaceWork.CHANGED event, so a revisit never trusts
 * an older snapshot without reading. Writes always start from a verified
 * revision, and every cache write is fenced by the identity epoch.
 */
function cachedSnapshot(workspaceId: string): WorkspaceWorkSnapshot | null {
  if (!workspaceId) return null
  const cached = roxQueryClient().getQueryData<WorkspaceWorkSnapshot>(roxKeys.workspaceWork(workspaceId))
  return cached?.workspaceId === workspaceId ? cached : null
}

/** Read within the SWR window, not invalidated, and not older than the newest announced revision. */
function cacheIsCurrent(workspaceId: string): boolean {
  const key = roxKeys.workspaceWork(workspaceId)
  const client = roxQueryClient()
  const cached = client.getQueryData<WorkspaceWorkSnapshot>(key)
  return !!cached && isRecentlyRead(client, key) && meetsAnnouncedRevision(cached)
}

/** The cache entry only moves forward, and never to a revision older than one announced. */
function replacesCached(next: WorkspaceWorkSnapshot, cached: WorkspaceWorkSnapshot | undefined): boolean {
  return meetsAnnouncedRevision(next) && (!cached || cached.revision <= next.revision)
}

export function useWorkspaceWork(workspaceId: string) {
  const [snapshot, setSnapshot] = useState<WorkspaceWorkSnapshot | null>(() => cachedSnapshot(workspaceId))
  const [loading, setLoading] = useState(() => !cachedSnapshot(workspaceId))
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<{ code: WorkspaceWorkErrorCode; message: string } | null>(null)
  const current = useRef<WorkspaceWorkSnapshot | null>(null)
  const scope = useMemo(() => ({
    workspaceId, active: false, request: 0, pending: false,
    verified: false, inflight: null as Promise<void> | null,
  }), [workspaceId])

  /**
   * `epoch` is the identity epoch captured when the read or mutation began:
   * the cache write is dropped when the identity changed meanwhile (the
   * cache was cleared for the new principal). Without an epoch (the value
   * came from the cache itself) nothing is written.
   */
  const accept = useCallback((next: WorkspaceWorkSnapshot, epoch?: number) => {
    if (!scope.active || next.workspaceId !== scope.workspaceId) return
    if (current.current?.workspaceId === next.workspaceId && current.current.revision > next.revision) return
    current.current = next
    setSnapshot(next)
    if (epoch === undefined) return
    const client = roxQueryClient()
    const key = roxKeys.workspaceWork(scope.workspaceId)
    if (replacesCached(next, client.getQueryData<WorkspaceWorkSnapshot>(key))) fencedSetQueryData(client, key, next, epoch)
  }, [scope])

  const load = useCallback(async (options: { join?: boolean; minRevision?: number } = {}) => {
    if (!scope.active) return
    const request = ++scope.request
    const epoch = cacheWriteEpoch()
    setLoading(true)
    const run = (async () => {
      try {
        const client = roxQueryClient()
        const key = roxKeys.workspaceWork(scope.workspaceId)
        const read = (join: boolean) => sharedRead(client, key, () => getWorkspaceWorkClient(scope.workspaceId).read(), {
          join, replaces: replacesCached,
        })
        // A mount read joins one already in flight (two views, one RPC); a
        // read that started before the announced revision cannot answer for it.
        let next = await read(options.join === true)
        if (options.minRevision !== undefined && next.revision < options.minRevision && scope.active && scope.request === request) {
          next = await read(false)
        }
        if (!scope.active || scope.request !== request) return
        scope.verified = true
        accept(next, epoch)
        setError(null)
      } catch (failure) {
        if (scope.active && scope.request === request) setError(workspaceWorkFailure(failure))
      } finally {
        if (scope.active && scope.request === request) setLoading(false)
      }
    })()
    scope.inflight = run
    await run
  }, [scope, accept])
  const refresh = useCallback(() => load(), [load])

  useEffect(() => {
    scope.active = true
    const cached = cachedSnapshot(scope.workspaceId)
    current.current = cached
    setSnapshot(cached); setPending(false); setError(null)
    if (cached && cacheIsCurrent(scope.workspaceId)) {
      // Read moments ago and nothing newer was announced: no second read.
      scope.verified = true
      setLoading(false)
    } else {
      // Paint the cached snapshot (if any) and revalidate in the background.
      void load({ join: true })
    }
    let off: (() => void) | undefined
    try { off = getWorkspaceWorkClient(scope.workspaceId).subscribe(revision => {
      if (scope.active && revision > (current.current?.revision ?? -1)) void load({ join: true, minRevision: revision })
    }) } catch { /* The read reports the same unavailable API visibly. */ }
    // Another view (or a mutation elsewhere) refreshed the shared entry.
    const hash = hashKey(roxKeys.workspaceWork(scope.workspaceId))
    const offCache = roxQueryClient().getQueryCache().subscribe(event => {
      if (event.type !== 'updated' || event.action.type !== 'success' || event.query.queryHash !== hash) return
      const next = event.query.state.data as WorkspaceWorkSnapshot | undefined
      if (next && next.workspaceId === scope.workspaceId && next.revision > (current.current?.revision ?? -1)) accept(next)
    })
    return () => { scope.active = false; scope.request++; off?.(); offCache() }
  }, [scope, load, accept])

  const mutate = useCallback(async (input: WorkspaceWorkMutation | WorkspaceWorkRemoval, remove = false, expectedRevision?: number): Promise<boolean> => {
    if (!scope.active || scope.pending) return false
    // A cached snapshot shown while revalidating is not a write base.
    if (!scope.verified && scope.inflight) await scope.inflight
    const before = current.current
    if (!scope.active || scope.pending || !before || before.workspaceId !== scope.workspaceId) return false
    scope.pending = true; setPending(true); setError(null)
    const epoch = cacheWriteEpoch()
    try {
      const client = getWorkspaceWorkClient(scope.workspaceId)
      const result = remove
        ? await client.remove(expectedRevision ?? before.revision, input as WorkspaceWorkRemoval)
        : await client.write(expectedRevision ?? before.revision, input as WorkspaceWorkMutation)
      if (!scope.active) return false
      accept(result.snapshot, epoch)
      return true
    } catch (failure) {
      if (!scope.active) return false
      const next = workspaceWorkFailure(failure)
      if (next.code === 'conflict') await load()
      if (scope.active) setError(next)
      return false
    } finally {
      scope.pending = false
      if (scope.active) setPending(false)
    }
  }, [scope, accept, load])

  const visible = snapshot?.workspaceId === workspaceId ? snapshot : cachedSnapshot(workspaceId)
  return {
    snapshot: visible,
    loading, pending, error, refresh,
    write: useCallback((input: WorkspaceWorkMutation, expectedRevision?: number) => mutate(input, false, expectedRevision), [mutate]),
    remove: useCallback((input: WorkspaceWorkRemoval, expectedRevision?: number) => mutate(input, true, expectedRevision), [mutate]),
  }
}
