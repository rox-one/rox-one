/**
 * Shared sessions collection filters (B6) — one live chip set for list/board/table/heatmap.
 *
 * FR-11: chips persist per navigator filter key (`allSessions`, `flagged`,
 * `archived`, `state:<id>`, `label:<id>`, `view:<id>`) in
 * `{workspace}/collection/filters.json` via RPC
 * (getCollectionFilters / setCollectionFilters / onCollectionFiltersChanged) —
 * same transport pattern as collection-display.ts. Absence of the file reads
 * as DEFAULT_COLLECTION_FILTERS for every key.
 */

import { atom } from 'jotai'
import { DEFAULT_COLLECTION_FILTERS, type CollectionFilters } from '@craft-agent/shared/sessions/collection'
import { windowWorkspaceIdAtom } from './sessions'

const EMPTY_COLLECTION_FILTERS: CollectionFilters = DEFAULT_COLLECTION_FILTERS

function cloneFiltersMap(
  map: Record<string, CollectionFilters>,
): Record<string, CollectionFilters> {
  const next: Record<string, CollectionFilters> = {}
  for (const [key, filters] of Object.entries(map)) {
    next[key] = {
      ...filters,
      status: filters.status ? [...filters.status] : undefined,
      priority: filters.priority ? [...filters.priority] : undefined,
      projectId: filters.projectId ? [...filters.projectId] : undefined,
      labels: filters.labels ? [...filters.labels] : undefined,
      model: filters.model ? [...filters.model] : undefined,
      agentFamily: filters.agentFamily ? [...filters.agentFamily] : undefined,
      due: filters.due ? { ...filters.due } : undefined,
    }
  }
  return next
}

/** Navigator filter key whose chips `collectionFiltersAtom` exposes. */
export const collectionFilterKeyAtom = atom<string>('allSessions')
/** Workspace-scoped per-key filters map (empty until loaded). */
export const collectionFiltersMapAtom = atom<Record<string, CollectionFilters>>({})

function stringArraysEqual(a?: string[], b?: string[]): boolean {
  if (a === b) return true
  if (!a || !b || a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

/**
 * Content equality for one key's chips. Missing and empty dimensions compare
 * equal only when both are absent/empty in the same way the normalizer
 * treats them (empty arrays are dropped on persist, so `[]` ≡ `undefined`).
 */
export function areCollectionFiltersEqual(a: CollectionFilters, b: CollectionFilters): boolean {
  const norm = (v?: string[]) => (v && v.length > 0 ? v : undefined)
  if (!stringArraysEqual(norm(a.status), norm(b.status))) return false
  if (!stringArraysEqual(norm(a.priority), norm(b.priority))) return false
  if (!stringArraysEqual(norm(a.projectId), norm(b.projectId))) return false
  if (!stringArraysEqual(norm(a.labels), norm(b.labels))) return false
  if (!stringArraysEqual(norm(a.model), norm(b.model))) return false
  if (!stringArraysEqual(norm(a.agentFamily), norm(b.agentFamily))) return false
  if ((a.flagged ?? undefined) !== (b.flagged ?? undefined)) return false
  if ((a.hasUnread ?? undefined) !== (b.hasUnread ?? undefined)) return false
  const da = a.due
  const db = b.due
  if (da === db) return true
  if (!da || !db || da.type !== db.type) return false
  if (da.type === 'next_n_days' && db.type === 'next_n_days') return da.days === db.days
  if (da.type === 'range' && db.type === 'range') return da.start === db.start && da.end === db.end
  return true
}

/** Content equality for whole per-key maps (key set + per-key chips). */
export function areCollectionFiltersMapsEqual(
  a: Record<string, CollectionFilters>,
  b: Record<string, CollectionFilters>,
): boolean {
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  if (aKeys.length !== bKeys.length) return false
  for (const key of aKeys) {
    const av = a[key]
    const bv = b[key]
    if (!bv || !areCollectionFiltersEqual(av ?? {}, bv)) return false
  }
  return true
}

/** True while a workspace filters load is in flight. */
export const collectionFiltersLoadingAtom = atom(false)

const collectionFiltersUpdateChains = new Map<string, Promise<void>>()
const collectionFiltersUpdateVersions = new Map<string, number>()

/**
 * Replace local filters map. Prefer `collectionFiltersAtom` writes when the
 * change should persist to the workspace file.
 */
export const replaceCollectionFiltersMapAtom = atom(
  null,
  (_get, set, map: Record<string, CollectionFilters>) => {
    set(collectionFiltersMapAtom, cloneFiltersMap(map))
  },
)

/**
 * Chips for the active navigator filter key. Reads fall back to
 * DEFAULT_COLLECTION_FILTERS for keys with no persisted entry; writes update
 * only the active key and optimistically persist the whole map via RPC.
 */
export const collectionFiltersAtom = atom(
  (get): CollectionFilters =>
    get(collectionFiltersMapAtom)[get(collectionFilterKeyAtom)] ?? EMPTY_COLLECTION_FILTERS,
  async (
    get,
    set,
    update: CollectionFilters | ((prev: CollectionFilters) => CollectionFilters),
  ): Promise<CollectionFilters> => {
    const key = get(collectionFilterKeyAtom)
    const prevMap = get(collectionFiltersMapAtom)
    const prev = prevMap[key] ?? EMPTY_COLLECTION_FILTERS
    const next = typeof update === 'function' ? update(prev) : update
    // No-op guard: persisting content-identical chips costs a disk write, a
    // cross-window broadcast, and a fresh-identity re-render cascade in every
    // collection consumer. Skip all three when nothing changed (e.g. rail
    // navigation re-applying the stored chips for a key, or a double-fired
    // toggle with an identical payload).
    if (areCollectionFiltersEqual(prev, next ?? {})) {
      return prev
    }
    const nextMap = { ...prevMap, [key]: next }
    set(collectionFiltersMapAtom, nextMap)

    const workspaceId = get(windowWorkspaceIdAtom)
    if (!workspaceId || typeof window === 'undefined' || !window.electronAPI?.setCollectionFilters) {
      return next
    }

    const version = (collectionFiltersUpdateVersions.get(workspaceId) ?? 0) + 1
    collectionFiltersUpdateVersions.set(workspaceId, version)
    const previousUpdate = collectionFiltersUpdateChains.get(workspaceId) ?? Promise.resolve()
    const persist = previousUpdate.catch(() => undefined).then(async () => {
      try {
        const saved = await window.electronAPI.setCollectionFilters(workspaceId, nextMap)
        const activeWorkspaceId = get(windowWorkspaceIdAtom)
        if (
          collectionFiltersUpdateVersions.get(workspaceId) === version &&
          (activeWorkspaceId == null || activeWorkspaceId === workspaceId) &&
          // The server echoes normalized content back; applying it with fresh
          // identities re-renders every consumer even when nothing changed.
          // Skip the write when the echo matches what is already stored.
          !areCollectionFiltersMapsEqual(get(collectionFiltersMapAtom), saved)
        ) {
          set(collectionFiltersMapAtom, cloneFiltersMap(saved))
        }
        return saved
      } catch (err) {
        // Keep optimistic value; caller may toast. Reload on next workspace tick.
        console.warn('[collection-filters] setCollectionFilters failed', err)
        return nextMap
      }
    })
    collectionFiltersUpdateChains.set(workspaceId, persist.then(() => undefined))
    await persist
    return next
  },
)

/**
 * Load filters for a workspace id (or active window workspace).
 * Applies result when the requested id is still the active one.
 */
export const loadCollectionFiltersAtom = atom(
  null,
  async (get, set, workspaceId?: string | null): Promise<Record<string, CollectionFilters>> => {
    const id = workspaceId === undefined ? get(windowWorkspaceIdAtom) : workspaceId
    if (!id || typeof window === 'undefined' || !window.electronAPI?.getCollectionFilters) {
      const fallback: Record<string, CollectionFilters> = {}
      set(collectionFiltersMapAtom, fallback)
      set(collectionFiltersLoadingAtom, false)
      return fallback
    }

    set(collectionFiltersLoadingAtom, true)
    try {
      const loaded = await window.electronAPI.getCollectionFilters(id)
      // Drop stale responses after a workspace switch.
      const active = get(windowWorkspaceIdAtom)
      if (active != null && active !== id) {
        return get(collectionFiltersMapAtom)
      }
      const next = cloneFiltersMap(loaded)
      set(collectionFiltersMapAtom, next)
      return next
    } catch (err) {
      console.warn('[collection-filters] getCollectionFilters failed', err)
      const active = get(windowWorkspaceIdAtom)
      if (active != null && active !== id) {
        return get(collectionFiltersMapAtom)
      }
      const fallback: Record<string, CollectionFilters> = {}
      set(collectionFiltersMapAtom, fallback)
      return fallback
    } finally {
      const active = get(windowWorkspaceIdAtom)
      if (active == null || active === id) {
        set(collectionFiltersLoadingAtom, false)
      }
    }
  },
)
