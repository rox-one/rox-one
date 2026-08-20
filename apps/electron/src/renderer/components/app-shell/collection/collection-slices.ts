import type { CollectionFilters } from '@craft-agent/shared/sessions/collection'
import * as storage from '@/lib/local-storage'

export type CollectionSliceId = 'unread' | 'flagged' | 'overdue' | 'today'

export interface CollectionSlice {
  id: CollectionSliceId | string
  nameKey?: string
  name?: string
  filters: CollectionFilters
  builtin?: boolean
}

export const BUILTIN_SLICES: readonly CollectionSlice[] = [
  { id: 'unread', nameKey: 'collection.slice.unread', filters: { hasUnread: true }, builtin: true },
  { id: 'flagged', nameKey: 'collection.slice.flagged', filters: { flagged: true }, builtin: true },
  { id: 'overdue', nameKey: 'collection.slice.overdue', filters: { due: { type: 'overdue' } }, builtin: true },
  { id: 'today', nameKey: 'collection.slice.today', filters: { due: { type: 'today' } }, builtin: true },
]

export function filtersSignature(filters: CollectionFilters): string {
  return JSON.stringify({
    status: filters.status?.slice().sort() ?? null,
    priority: filters.priority?.slice().sort() ?? null,
    projectId: filters.projectId?.slice().sort() ?? null,
    labels: filters.labels?.slice().sort() ?? null,
    due: filters.due ?? null,
    flagged: filters.flagged ?? null,
    hasUnread: filters.hasUnread ?? null,
    model: filters.model?.slice().sort() ?? null,
  })
}

export function sliceMatches(filters: CollectionFilters, slice: CollectionSlice): boolean {
  return filtersSignature(filters) === filtersSignature(slice.filters)
}

export function matchingSliceId(
  filters: CollectionFilters,
  extras: readonly CollectionSlice[] = [],
): string | null {
  for (const slice of [...BUILTIN_SLICES, ...extras]) {
    if (sliceMatches(filters, slice)) return slice.id
  }
  return null
}

export function applySlice(filters: CollectionFilters, slice: CollectionSlice): CollectionFilters {
  if (sliceMatches(filters, slice)) return {}
  return { ...slice.filters }
}

export function loadSavedSlices(): CollectionSlice[] {
  if (typeof localStorage === 'undefined') return []
  const saved = storage.get<CollectionSlice[]>(storage.KEYS.collectionSlices, [])
  if (!Array.isArray(saved)) return []
  return saved.filter((item) => item && typeof item.id === 'string' && item.filters && typeof item.filters === 'object')
}

export function persistSavedSlices(slices: CollectionSlice[]): void {
  if (typeof localStorage === 'undefined') return
  storage.set(storage.KEYS.collectionSlices, slices)
}

export function createSavedSlice(name: string, filters: CollectionFilters): CollectionSlice {
  return {
    id: `saved-${Date.now().toString(36)}`,
    name: name.trim(),
    filters: { ...filters },
    builtin: false,
  }
}
