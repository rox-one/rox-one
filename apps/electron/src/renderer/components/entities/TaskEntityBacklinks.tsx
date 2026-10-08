/**
 * W1-08 (#1505) — Tasks integration: «Упоминается в» in the task detail
 * Links tab. Renders nothing while `entities.previews.v1` is off.
 *
 * Backlinks come from #1499's save-time note-links indexer; with nothing
 * indexed yet this shows the empty state from the real `entities:links`
 * call — never fixture rows.
 */
import * as React from 'react'
import { useOptionalAppShellContext } from '@/context/AppShellContext'
import { BacklinksPanel } from './BacklinksPanel'
import { EntityWorkspaceContext } from './entity-context'
import { useEntityPreviewsEnabled } from './flags'

export interface TaskEntityBacklinksProps {
  taskId: string
  workspaceId?: string | null
  /** Overrides the flag (tests). */
  enabled?: boolean
}

export function TaskEntityBacklinks({ taskId, workspaceId: explicit, enabled: override }: TaskEntityBacklinksProps) {
  const flag = useEntityPreviewsEnabled()
  const shell = useOptionalAppShellContext()
  const enabled = (override ?? flag) && !!taskId
  const workspaceId = explicit ?? shell?.activeWorkspaceId ?? null
  if (!enabled) return null
  return (
    <EntityWorkspaceContext.Provider value={workspaceId}>
      <BacklinksPanel entityRef={{ kind: 'task', id: taskId }} workspaceId={workspaceId} enabled className="pt-2" />
    </EntityWorkspaceContext.Provider>
  )
}
