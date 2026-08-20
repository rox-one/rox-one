import type { CollectionFilters } from '@craft-agent/shared/sessions/collection'

/** Count selected values (not just dimensions) for the compact filter badge. */
export function activeFilterCount(filters: CollectionFilters): number {
  let n = 0
  n += filters.status?.length ?? 0
  n += filters.priority?.length ?? 0
  n += filters.projectId?.length ?? 0
  n += filters.labels?.length ?? 0
  n += filters.model?.length ?? 0
  if (filters.due) n += 1
  if (typeof filters.flagged === 'boolean') n += 1
  if (typeof filters.hasUnread === 'boolean') n += 1
  return n
}
