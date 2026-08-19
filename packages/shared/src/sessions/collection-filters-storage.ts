/**
 * Sessions collection filter chips persistence (FR-11).
 *
 * File: `{workspaceRoot}/collection/filters.json`
 * Shape: `{ version: 1, filtersByKey: { [navigatorFilterKey]: CollectionFilters } }`
 * where navigatorFilterKey is the sessions navigator key (`allSessions`,
 * `flagged`, `archived`, `state:<id>`, `label:<id>`, `view:<id>`).
 *
 * Absence / corrupt → empty map (not written until save), which every
 * consumer reads as DEFAULT_COLLECTION_FILTERS for every key.
 */

import { existsSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { atomicWriteFileSync, readJsonFileSync } from '../utils/files.ts'
import type { SessionPriority } from '../protocol/dto.ts'
import type { CollectionFilters, DueRange } from './collection-types.ts'

export const COLLECTION_FILTERS_RELATIVE_PATH = 'collection/filters.json'

const SESSION_PRIORITY_VALUES: readonly SessionPriority[] = [
  'none',
  'urgent',
  'high',
  'medium',
  'low',
] as const

function isPriority(value: unknown): value is SessionPriority {
  return typeof value === 'string' && (SESSION_PRIORITY_VALUES as readonly string[]).includes(value)
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const seen = new Set<string>()
  const next: string[] = []
  for (const item of value) {
    if (typeof item !== 'string' || seen.has(item)) continue
    seen.add(item)
    next.push(item)
  }
  // An empty dimension is equivalent to no chip — drop it so persisted
  // entries stay delta-only.
  return next.length > 0 ? next : undefined
}

function normalizeDueRange(value: unknown): DueRange | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  switch (raw.type) {
    case 'none':
    case 'overdue':
    case 'today':
      return { type: raw.type }
    case 'next_n_days':
      return typeof raw.days === 'number' && Number.isFinite(raw.days)
        ? { type: 'next_n_days', days: raw.days }
        : undefined
    case 'range':
      return typeof raw.start === 'number' &&
        Number.isFinite(raw.start) &&
        typeof raw.end === 'number' &&
        Number.isFinite(raw.end)
        ? { type: 'range', start: raw.start, end: raw.end }
        : undefined
    default:
      return undefined
  }
}

/**
 * Normalize a raw JSON object into valid CollectionFilters.
 * Unknown fields are dropped; invalid enum/array entries fall out.
 */
export function normalizeCollectionFilters(raw: unknown): CollectionFilters {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const obj = raw as Record<string, unknown>

  const filters: CollectionFilters = {}
  const status = normalizeStringArray(obj.status)
  if (status) filters.status = status
  const projectId = normalizeStringArray(obj.projectId)
  if (projectId) filters.projectId = projectId
  const labels = normalizeStringArray(obj.labels)
  if (labels) filters.labels = labels
  const model = normalizeStringArray(obj.model)
  if (model) filters.model = model

  if (Array.isArray(obj.priority)) {
    const seen = new Set<SessionPriority>()
    const priority: SessionPriority[] = []
    for (const item of obj.priority) {
      if (!isPriority(item) || seen.has(item)) continue
      seen.add(item)
      priority.push(item)
    }
    if (priority.length > 0) filters.priority = priority
  }

  const due = normalizeDueRange(obj.due)
  if (due) filters.due = due
  if (typeof obj.flagged === 'boolean') filters.flagged = obj.flagged
  if (typeof obj.hasUnread === 'boolean') filters.hasUnread = obj.hasUnread
  return filters
}

/**
 * Normalize a raw persisted payload into the per-key filters map.
 * Accepts both the envelope (`{ version, filtersByKey }`) and a bare map.
 */
export function normalizeCollectionFiltersMap(raw: unknown): Record<string, CollectionFilters> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const obj = raw as Record<string, unknown>
  const source =
    obj.filtersByKey && typeof obj.filtersByKey === 'object' && !Array.isArray(obj.filtersByKey)
      ? (obj.filtersByKey as Record<string, unknown>)
      : obj

  const map: Record<string, CollectionFilters> = {}
  for (const [key, value] of Object.entries(source)) {
    if (typeof key !== 'string' || key.length === 0) continue
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    map[key] = normalizeCollectionFilters(value)
  }
  return map
}

export function getCollectionFiltersPath(workspaceRootPath: string): string {
  return join(workspaceRootPath, COLLECTION_FILTERS_RELATIVE_PATH)
}

/**
 * Load per-key filters from disk. Missing/corrupt file → empty map (not written).
 */
export function loadCollectionFiltersMap(workspaceRootPath: string): Record<string, CollectionFilters> {
  const path = getCollectionFiltersPath(workspaceRootPath)
  if (!existsSync(path)) return {}
  try {
    const raw = readJsonFileSync<unknown>(path)
    return normalizeCollectionFiltersMap(raw)
  } catch {
    return {}
  }
}

/**
 * Persist per-key filters. Creates `collection/` directory as needed.
 * Returns the normalized map that was written.
 */
export function saveCollectionFiltersMap(
  workspaceRootPath: string,
  map: Record<string, CollectionFilters>,
): Record<string, CollectionFilters> {
  const normalized = normalizeCollectionFiltersMap({ filtersByKey: map })
  const path = getCollectionFiltersPath(workspaceRootPath)
  const dir = dirname(path)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  atomicWriteFileSync(path, JSON.stringify({ version: 1, filtersByKey: normalized }, null, 2) + '\n')
  return normalized
}
