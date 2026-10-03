import { useEffect, useState } from 'react'
import type { LlmConnectionWithStatus, WorkspaceSettings } from '../../../shared/types'

type AiOverrides = Pick<WorkspaceSettings, 'defaultLlmConnection' | 'model'>

interface WorkspaceAiSnapshot {
  workspaceId: string
  connections: LlmConnectionWithStatus[]
  settings?: AiOverrides
}

/** Read both overrides together: the shell's connection override has no workspace provenance. */
export function useWorkspaceAiSettings(workspaceId: string | null, connections: LlmConnectionWithStatus[]) {
  const [snapshot, setSnapshot] = useState<WorkspaceAiSnapshot | null>(null)

  useEffect(() => {
    let cancelled = false
    setSnapshot(null)
    if (workspaceId) {
      const complete = (settings?: AiOverrides | null) => {
        if (!cancelled) setSnapshot({ workspaceId, connections, settings: settings ?? undefined })
      }
      void Promise.resolve()
        .then(() => window.electronAPI.getWorkspaceSettings(workspaceId))
        .then(complete, () => complete())
    }
    return () => {
      cancelled = true
    }
  }, [workspaceId, connections])

  // Also reject the old snapshot during the render before the effect resets it.
  const current = snapshot?.workspaceId === workspaceId && snapshot.connections === connections
    ? snapshot
    : undefined
  return { settings: current?.settings, isLoading: !!workspaceId && !current }
}
