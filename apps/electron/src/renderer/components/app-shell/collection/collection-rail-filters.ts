import { DEFAULT_COLLECTION_FILTERS, type CollectionFilters } from '@craft-agent/shared/sessions/collection'

/** Set before navigating to a view so AppShell keeps destination chips. */
export const skipRailChipClearOnce = { current: false }

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
