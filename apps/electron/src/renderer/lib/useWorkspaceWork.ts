import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { WorkspaceWorkSnapshot } from '@rox/shared/workspace-work'
import { getWorkspaceWorkClient, workspaceWorkFailure, type WorkspaceWorkErrorCode, type WorkspaceWorkMutation, type WorkspaceWorkRemoval } from './workspace-work-client'
import { hashKey } from '@tanstack/react-query'
import { roxQueryClient } from './query/client'
import { roxKeys } from './query/keys'

/**
 * PERF-09 (#1576): the snapshot lives in the shared query cache (memory only,
 * keyed by workspace), so Tasks, Plan, Agents and the auxiliary panel share
 * one read, and a revisit paints the last snapshot at once. A cached entry is
 * reused as-is while no newer revision was announced; otherwise it is shown
 * and revalidated in the background. Writes always start from a verified
 * revision.
 */
function cachedSnapshot(workspaceId: string): WorkspaceWorkSnapshot | null {
  if (!workspaceId) return null
  const cached = roxQueryClient().getQueryData<WorkspaceWorkSnapshot>(roxKeys.workspaceWork(workspaceId))
  return cached?.workspaceId === workspaceId ? cached : null
}

function cacheIsCurrent(workspaceId: string): boolean {
  const state = roxQueryClient().getQueryState(roxKeys.workspaceWork(workspaceId))
  return !!state && state.status === 'success' && !state.isInvalidated
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

  const accept = useCallback((next: WorkspaceWorkSnapshot) => {
    if (!scope.active || next.workspaceId !== scope.workspaceId) return
    if (current.current?.workspaceId === next.workspaceId && current.current.revision > next.revision) return
    current.current = next
    setSnapshot(next)
    const client = roxQueryClient()
    const key = roxKeys.workspaceWork(scope.workspaceId)
    const cached = client.getQueryData<WorkspaceWorkSnapshot>(key)
    if (!cached || cached.revision <= next.revision) client.setQueryData(key, next)
  }, [scope])

  const refresh = useCallback(async () => {
    if (!scope.active) return
    const request = ++scope.request
    setLoading(true)
    const run = (async () => {
      try {
        // fetchQuery dedupes: two views opening the same workspace share one read.
        const next = await roxQueryClient().fetchQuery({
          queryKey: roxKeys.workspaceWork(scope.workspaceId),
          queryFn: () => getWorkspaceWorkClient(scope.workspaceId).read(),
          staleTime: 0,
        })
        if (!scope.active || scope.request !== request) return
        scope.verified = true
        accept(next)
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

  useEffect(() => {
    scope.active = true
    const cached = cachedSnapshot(scope.workspaceId)
    current.current = cached
    setSnapshot(cached); setPending(false); setError(null)
    if (cached && cacheIsCurrent(scope.workspaceId)) {
      // Nothing newer was announced since this snapshot was read.
      scope.verified = true
      setLoading(false)
    } else {
      void refresh()
    }
    let off: (() => void) | undefined
    try { off = getWorkspaceWorkClient(scope.workspaceId).subscribe(revision => {
      if (scope.active && revision > (current.current?.revision ?? -1)) void refresh()
    }) } catch { /* The read reports the same unavailable API visibly. */ }
    // Another view (or a mutation elsewhere) refreshed the shared entry.
    const hash = hashKey(roxKeys.workspaceWork(scope.workspaceId))
    const offCache = roxQueryClient().getQueryCache().subscribe(event => {
      if (event.type !== 'updated' || event.action.type !== 'success' || event.query.queryHash !== hash) return
      const next = event.query.state.data as WorkspaceWorkSnapshot | undefined
      if (next && next.workspaceId === scope.workspaceId && next.revision > (current.current?.revision ?? -1)) accept(next)
    })
    return () => { scope.active = false; scope.request++; off?.(); offCache() }
  }, [scope, refresh, accept])

  const mutate = useCallback(async (input: WorkspaceWorkMutation | WorkspaceWorkRemoval, remove = false, expectedRevision?: number): Promise<boolean> => {
    if (!scope.active || scope.pending) return false
    // A cached snapshot shown while revalidating is not a write base.
    if (!scope.verified && scope.inflight) await scope.inflight
    const before = current.current
    if (!scope.active || scope.pending || !before || before.workspaceId !== scope.workspaceId) return false
    scope.pending = true; setPending(true); setError(null)
    try {
      const client = getWorkspaceWorkClient(scope.workspaceId)
      const result = remove
        ? await client.remove(expectedRevision ?? before.revision, input as WorkspaceWorkRemoval)
        : await client.write(expectedRevision ?? before.revision, input as WorkspaceWorkMutation)
      if (!scope.active) return false
      accept(result.snapshot)
      return true
    } catch (failure) {
      if (!scope.active) return false
      const next = workspaceWorkFailure(failure)
      if (next.code === 'conflict') await refresh()
      if (scope.active) setError(next)
      return false
    } finally {
      scope.pending = false
      if (scope.active) setPending(false)
    }
  }, [scope, accept, refresh])

  const visible = snapshot?.workspaceId === workspaceId ? snapshot : cachedSnapshot(workspaceId)
  return {
    snapshot: visible,
    loading, pending, error, refresh,
    write: useCallback((input: WorkspaceWorkMutation, expectedRevision?: number) => mutate(input, false, expectedRevision), [mutate]),
    remove: useCallback((input: WorkspaceWorkRemoval, expectedRevision?: number) => mutate(input, true, expectedRevision), [mutate]),
  }
}
