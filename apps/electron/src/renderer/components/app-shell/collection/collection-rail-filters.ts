import { DEFAULT_COLLECTION_FILTERS, type CollectionFilters } from '@craft-agent/shared/sessions/collection'
import { sliceToView, type CollectionSliceLike } from '@craft-agent/shared/views'
import { routes } from '../../../../shared/routes'

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
