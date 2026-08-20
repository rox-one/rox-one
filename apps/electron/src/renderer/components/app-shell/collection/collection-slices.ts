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

export type UniqueSliceName =
  | { ok: true; name: string }
  | { ok: false; reason: 'empty' | 'duplicate' }

export const BUILTIN_SLICES: readonly CollectionSlice[] = [
  { id: 'unread', nameKey: 'collection.slice.unread', filters: { hasUnread: true }, builtin: true },
  { id: 'flagged', nameKey: 'collection.slice.flagged', filters: { flagged: true }, builtin: true },
  { id: 'overdue', nameKey: 'collection.slice.overdue', filters: { due: { type: 'overdue' } }, builtin: true },
  { id: 'today', nameKey: 'collection.slice.today', filters: { due: { type: 'today' } }, builtin: true },
]

function sanitizeSlices(saved: unknown): CollectionSlice[] {
  if (!Array.isArray(saved)) return []
  return saved.filter(
    (item): item is CollectionSlice =>
      Boolean(item && typeof item.id === 'string' && item.filters && typeof item.filters === 'object'),
  )
}

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

export function matchingSlice(
  filters: CollectionFilters,
  extras: readonly CollectionSlice[] = [],
): CollectionSlice | null {
  for (const slice of [...BUILTIN_SLICES, ...extras]) {
    if (sliceMatches(filters, slice)) return slice
  }
  return null
}

export function matchingSliceId(
  filters: CollectionFilters,
  extras: readonly CollectionSlice[] = [],
): string | null {
  return matchingSlice(filters, extras)?.id ?? null
}

export function applySlice(filters: CollectionFilters, slice: CollectionSlice): CollectionFilters {
  if (sliceMatches(filters, slice)) return {}
  return { ...slice.filters }
}

export function loadSavedSlices(workspaceId?: string): CollectionSlice[] {
  if (typeof localStorage === 'undefined') return []
  if (!workspaceId) return []
  const suffixed = sanitizeSlices(storage.get<CollectionSlice[]>(storage.KEYS.collectionSlices, [], workspaceId))
  if (suffixed.length > 0) return suffixed
  const legacy = sanitizeSlices(storage.get<CollectionSlice[]>(storage.KEYS.collectionSlices, []))
  if (legacy.length > 0) {
    storage.set(storage.KEYS.collectionSlices, legacy, workspaceId)
    return legacy
  }
  return []
}

export function persistSavedSlices(slices: CollectionSlice[], workspaceId?: string): void {
  if (typeof localStorage === 'undefined' || !workspaceId) return
  storage.set(storage.KEYS.collectionSlices, slices, workspaceId)
}

export function createSavedSlice(name: string, filters: CollectionFilters): CollectionSlice {
  return {
    id: `saved-${Date.now().toString(36)}`,
    name: name.trim(),
    filters: { ...filters },
    builtin: false,
  }
}

export function assertUniqueSliceName(
  name: string,
  slices: readonly CollectionSlice[],
  excludeId?: string,
): UniqueSliceName {
  const trimmed = name.trim()
  if (!trimmed) return { ok: false, reason: 'empty' }
  const lower = trimmed.toLowerCase()
  for (const slice of slices) {
    if (excludeId && slice.id === excludeId) continue
    const existing = (slice.name ?? '').trim().toLowerCase()
    if (existing && existing === lower) return { ok: false, reason: 'duplicate' }
  }
  return { ok: true, name: trimmed }
}

export function renameSavedSlice(slices: CollectionSlice[], id: string, name: string): CollectionSlice[] {
  const unique = assertUniqueSliceName(name, slices, id)
  if (!unique.ok) return slices
  let found = false
  const next = slices.map((slice) => {
    if (slice.id !== id) return slice
    found = true
    return { ...slice, name: unique.name }
  })
  return found ? next : slices
}
