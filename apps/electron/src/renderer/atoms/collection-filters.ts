/**
 * Shared sessions collection filters (B6) — one live chip set for list/board/table.
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
      due: filters.due ? { ...filters.due } : undefined,
    }
  }
  return next
}

/** Navigator filter key whose chips `collectionFiltersAtom` exposes. */
export const collectionFilterKeyAtom = atom<string>('allSessions')

/** Workspace-scoped per-key filters map (empty until loaded). */
export const collectionFiltersMapAtom = atom<Record<string, CollectionFilters>>({})

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
          (activeWorkspaceId == null || activeWorkspaceId === workspaceId)
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
