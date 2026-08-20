import type * as React from 'react'

import type { SessionPriority } from '@craft-agent/shared/sessions/collection'
import type { CollectionDisplay, CollectionFilters } from '@craft-agent/shared/sessions/collection'
import type { SessionStatus } from '@/config/session-status-config'
import { cn } from '@/lib/utils'
import { CollectionDisplayPopover } from './CollectionDisplayPopover'
import { CollectionFilterChips } from './CollectionFilterChips'
import { CollectionFilterMenu } from './CollectionFilterMenu'

export interface CollectionOpsBarProps {
  display: CollectionDisplay
  filters: CollectionFilters
  onDisplayChange: (next: CollectionDisplay) => void
  onFiltersChange: (next: CollectionFilters) => void
  statuses?: SessionStatus[]
  priorities?: SessionPriority[]
  projects?: Array<{ id: string; name: string }>
  labels?: Array<{ id: string; name: string }>
  /** Optional trailing slot (e.g. view toggle already in host header). */
  trailing?: React.ReactNode
  className?: string
  workspaceId?: string | null
  onApplyUserSlice?: (viewId: string, filters: CollectionFilters) => void
}

/**
 * Collection ops strip: filter chips + Display popover.
 * Mounted under the table (and optionally list) header.
 */
export function CollectionOpsBar({
  display,
  filters,
  onDisplayChange,
  onFiltersChange,
  statuses,
  priorities,
  projects,
  labels,
  trailing,
  className,
  workspaceId,
  onApplyUserSlice,
}: CollectionOpsBarProps) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-start justify-between gap-2 border-b border-border/40 bg-background/80 px-4 py-2',
        className,
      )}
    >
      <CollectionFilterChips
        filters={filters}
        onFiltersChange={onFiltersChange}
        statuses={statuses}
        priorities={priorities}
        projects={projects}
        labels={labels}
        className="min-w-0 flex-1"
      />
      <div className="flex shrink-0 items-center gap-2">
        <CollectionFilterMenu
          filters={filters}
          onFiltersChange={onFiltersChange}
          workspaceId={workspaceId}
          statuses={statuses}
          priorities={priorities}
          projects={projects}
          labels={labels}
          onApplyUserSlice={onApplyUserSlice}
        />
        <CollectionDisplayPopover display={display} onDisplayChange={onDisplayChange} />
        {trailing}
      </div>
    </div>
  )
}
