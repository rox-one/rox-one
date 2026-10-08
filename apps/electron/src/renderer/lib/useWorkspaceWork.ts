import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { WorkspaceWorkSnapshot } from '@rox/shared/workspace-work'
import { getWorkspaceWorkClient, workspaceWorkFailure, type WorkspaceWorkErrorCode, type WorkspaceWorkMutation, type WorkspaceWorkRemoval } from './workspace-work-client'

export function useWorkspaceWork(workspaceId: string) {
  const [snapshot, setSnapshot] = useState<WorkspaceWorkSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<{ code: WorkspaceWorkErrorCode; message: string } | null>(null)
  const current = useRef<WorkspaceWorkSnapshot | null>(null)
  const scope = useMemo(() => ({ workspaceId, active: false, request: 0, pending: false }), [workspaceId])

  const accept = useCallback((next: WorkspaceWorkSnapshot) => {
    if (!scope.active || next.workspaceId !== scope.workspaceId) return
    if (current.current?.workspaceId === next.workspaceId && current.current.revision > next.revision) return
    current.current = next
    setSnapshot(next)
  }, [scope])

  const refresh = useCallback(async () => {
    if (!scope.active) return
    const request = ++scope.request
    setLoading(true)
    try {
      const next = await getWorkspaceWorkClient(scope.workspaceId).read()
      if (!scope.active || scope.request !== request) return
      accept(next)
      setError(null)
    } catch (failure) {
      if (scope.active && scope.request === request) setError(workspaceWorkFailure(failure))
    } finally {
      if (scope.active && scope.request === request) setLoading(false)
    }
  }, [scope, accept])

  useEffect(() => {
    scope.active = true
    current.current = null
    setSnapshot(null); setPending(false); setError(null)
    void refresh()
    let off: (() => void) | undefined
    try { off = getWorkspaceWorkClient(scope.workspaceId).subscribe(revision => {
      if (scope.active && revision > (current.current?.revision ?? -1)) void refresh()
    }) } catch { /* The read reports the same unavailable API visibly. */ }
    return () => { scope.active = false; scope.request++; off?.() }
  }, [scope, refresh])

  const mutate = useCallback(async (input: WorkspaceWorkMutation | WorkspaceWorkRemoval, remove = false, expectedRevision?: number): Promise<boolean> => {
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

  return {
    snapshot: snapshot?.workspaceId === workspaceId ? snapshot : null,
    loading, pending, error, refresh,
    write: useCallback((input: WorkspaceWorkMutation, expectedRevision?: number) => mutate(input, false, expectedRevision), [mutate]),
    remove: useCallback((input: WorkspaceWorkRemoval, expectedRevision?: number) => mutate(input, true, expectedRevision), [mutate]),
  }
}
