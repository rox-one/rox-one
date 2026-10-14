import { useCallback, useEffect, useState } from 'react'
import { newLocalId, readWorkspaceJsonSnapshot, saveWorkspaceJson, subscribeWorkspaceJson } from '@/lib/extra-screens/storage'
import { GLANCE_NS, normalizeGlanceLayout, persistGlance, type GlanceLayout } from './model'

/** Workspace-scoped Glance pages, saved on every change (local, not team-synced). */
export function useGlanceLayout(workspaceId: string | null): [GlanceLayout, (next: GlanceLayout) => void, boolean] {
  const read = useCallback(() => readWorkspaceJsonSnapshot(GLANCE_NS, workspaceId, normalizeGlanceLayout), [workspaceId])
  const [state, setState] = useState(() => ({ workspaceId, snapshot: read() }))
  useEffect(() => {
    setState({ workspaceId, snapshot: read() })
    return subscribeWorkspaceJson(GLANCE_NS, workspaceId, () => setState({ workspaceId, snapshot: read() }))
  }, [read, workspaceId])
  const snapshot = state.workspaceId === workspaceId ? state.snapshot : read()
  const writable = snapshot.available && (snapshot.raw === null || snapshot.valid)
  const update = useCallback(
    (next: GlanceLayout) => {
      setState({ workspaceId, snapshot: { ...snapshot, value: next } })
      saveWorkspaceJson(GLANCE_NS, workspaceId, persistGlance(next, workspaceId ?? 'default', newLocalId('glance')))
    },
    [snapshot, workspaceId],
  )
  return [snapshot.value, update, writable]
}
