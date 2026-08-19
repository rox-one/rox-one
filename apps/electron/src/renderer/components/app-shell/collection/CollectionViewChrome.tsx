import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { type CollectionDisplay,
type SessionPriority, } from '@craft-agent/shared/sessions/collection'
import type { SessionStatus } from '@/config/session-status-config'
import {
  collectionDisplayAtom,
  loadCollectionDisplayAtom,
  replaceCollectionDisplayAtom,
  setCollectionDisplayAtom,
} from '@/atoms/collection-display'
import {
  collectionFiltersAtom,
  loadCollectionFiltersAtom,
  replaceCollectionFiltersMapAtom,
} from '@/atoms/collection-filters'
import { type CollectionViewMode } from '../kanban/BoardListToggle'
import { CollectionDisplayPopover } from './CollectionDisplayPopover'
import { CollectionFilterMenu } from './CollectionFilterMenu'
import { CollectionOpsBar } from './CollectionOpsBar'
import { CollectionViewCycleButton } from './CollectionViewCycleButton'
import { cn } from '@/lib/utils'

const DEFAULT_PRIORITIES: SessionPriority[] = ['urgent', 'high', 'medium', 'low', 'none']

export interface CollectionViewChromeProps {
  workspaceId: string | null | undefined
  viewMode: CollectionViewMode
  onViewModeChange: (mode: CollectionViewMode) => void
  /** Compact header: cycle + Display + filter menu (navigator / board). */
  compact?: boolean
  statuses?: SessionStatus[]
  priorities?: SessionPriority[]
  projects?: Array<{ id: string; name: string }>
  labels?: Array<{ id: string; name: string }>
  className?: string
}

/**
 * Loads CollectionDisplay for workspace and renders either:
 * - compact: cycle button + Display + filter dropdown (narrow navigator / board)
 * - full: CollectionOpsBar strip with filter chips (wide table host)
 */
export function CollectionViewChrome({
  workspaceId,
  viewMode,
  onViewModeChange,
  compact = true,
  statuses = [],
  priorities = DEFAULT_PRIORITIES,
  projects = [],
  labels = [],
  className,
}: CollectionViewChromeProps) {
  const display = useAtomValue(collectionDisplayAtom)
  const setDisplay = useSetAtom(setCollectionDisplayAtom)
  const replaceDisplay = useSetAtom(replaceCollectionDisplayAtom)
  const loadDisplay = useSetAtom(loadCollectionDisplayAtom)
  const filters = useAtomValue(collectionFiltersAtom)
  const setFilters = useSetAtom(collectionFiltersAtom)
  const loadFilters = useSetAtom(loadCollectionFiltersAtom)
  const replaceFiltersMap = useSetAtom(replaceCollectionFiltersMapAtom)

  React.useEffect(() => {
    void loadDisplay(workspaceId)
  }, [workspaceId, loadDisplay])

  React.useEffect(() => {
    void loadFilters(workspaceId)
  }, [workspaceId, loadFilters])

  React.useEffect(() => {
    if (!workspaceId || typeof window === 'undefined') return
    const api = window.electronAPI
    if (!api?.onCollectionDisplayChanged) return
    return api.onCollectionDisplayChanged((wsId, next) => {
      if (wsId !== workspaceId) return
      replaceDisplay(next)
    })
  }, [workspaceId, replaceDisplay])

  React.useEffect(() => {
    if (!workspaceId || typeof window === 'undefined') return
    const api = window.electronAPI
    if (!api?.onCollectionFiltersChanged) return
    return api.onCollectionFiltersChanged((wsId, next) => {
      if (wsId !== workspaceId) return
      replaceFiltersMap(next)
    })
  }, [workspaceId, replaceFiltersMap])

  const handleDisplayChange = React.useCallback(
    (next: CollectionDisplay) => {
      void setDisplay({ display: next, workspaceId })
    },
    [setDisplay, workspaceId],
  )

  const cycle = (
    <CollectionViewCycleButton value={viewMode} onChange={onViewModeChange} />
  )

  if (compact) {
    return (
      <div className={cn('inline-flex items-center gap-1.5', className)}>
        {cycle}
        <CollectionDisplayPopover display={display} onDisplayChange={handleDisplayChange} iconOnly />
        <CollectionFilterMenu
          filters={filters}
          onFiltersChange={setFilters}
          statuses={statuses}
          priorities={priorities}
          projects={projects}
          labels={labels}
        />
      </div>
    )
  }

  return (
    <CollectionOpsBar
      display={display}
      filters={filters}
      onDisplayChange={handleDisplayChange}
      onFiltersChange={setFilters}
      statuses={statuses}
      priorities={priorities}
      projects={projects}
      labels={labels}
      trailing={cycle}
      className={className}
    />
  )
}
