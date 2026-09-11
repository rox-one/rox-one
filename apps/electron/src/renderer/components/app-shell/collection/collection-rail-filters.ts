import { DEFAULT_COLLECTION_FILTERS, type CollectionFilters } from '@craft-agent/shared/sessions/collection'
import { mergeSliceViews, sliceToView, type CollectionSliceLike } from '@craft-agent/shared/views'
import type { ViewConfig } from '@craft-agent/shared/views'
import { routes } from '../../../../shared/routes'


export async function persistUserCollectionSlices(opts: {
  workspaceId?: string | null
  viewsLoading: boolean
  viewConfigs: readonly ViewConfig[]
  slices: readonly CollectionSliceLike[]
  saveViews?: (workspaceId: string, views: ViewConfig[]) => Promise<unknown>
  refresh?: () => unknown
  clearLegacy?: (workspaceId: string) => void
}): Promise<'saved' | 'skipped'> {
  const ws = opts.workspaceId ?? undefined
  if (!ws || opts.viewsLoading || opts.viewConfigs.length === 0) return 'skipped'
  if (!opts.saveViews) return 'skipped'
  const merged = mergeSliceViews(opts.viewConfigs, opts.slices)
  await opts.saveViews(ws, merged)
  opts.clearLegacy?.(ws)
  await opts.refresh?.()
  return 'saved'
}

/** Set before navigating to a view so AppShell keeps destination chips. */
export const skipRailChipClearOnce = { current: false }

/**
 * Filter save / click → Views rail: prefixed view id, chips copy, skip rail-clear.
 * Route matches `routes.view.view` used by AppShell/Kanban.
 */
export function userSliceNavigation(slice: CollectionSliceLike): {
  viewId: string
  filters: CollectionFilters
  route: ReturnType<typeof routes.view.view>
  skipChipClear: true
} {
  const viewId = sliceToView(slice).id
  return {
    viewId,
    filters: { ...slice.filters },
    route: routes.view.view(viewId),
    skipChipClear: true,
  }
}

export function railViewNavigation(view: {
  id: string
  collectionFilters?: CollectionFilters
}): {
  viewId: string
  filters: CollectionFilters | null
  route: ReturnType<typeof routes.view.view>
  skipChipClear: true
} {
  if (view.collectionFilters) {
    const nav = userSliceNavigation({ id: view.id, filters: view.collectionFilters })
    return { ...nav, filters: nav.filters }
  }
  return {
    viewId: view.id,
    filters: null,
    route: routes.view.view(view.id),
    skipChipClear: true,
  }
}

export function chipsAfterRailChange(opts: {
  prevKey: string
  nextKey: string
  jump?: boolean
  prevChips?: CollectionFilters
}): CollectionFilters {
  if (opts.jump) return opts.prevChips ?? DEFAULT_COLLECTION_FILTERS
  if (opts.prevKey === opts.nextKey) return opts.prevChips ?? DEFAULT_COLLECTION_FILTERS
  return DEFAULT_COLLECTION_FILTERS
}
