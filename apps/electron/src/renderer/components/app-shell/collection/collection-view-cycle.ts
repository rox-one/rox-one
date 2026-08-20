import { routes } from '../../../../shared/routes'
import * as storage from '@/lib/local-storage'
import type { CollectionViewMode } from '../kanban/BoardListToggle'

export const COLLECTION_VIEW_ORDER: readonly CollectionViewMode[] = ['list', 'board', 'table']

function isCollectionViewMode(mode: string | null): mode is CollectionViewMode {
  return mode !== null && (COLLECTION_VIEW_ORDER as readonly string[]).includes(mode)
}

function canUseStorage(): boolean {
  return typeof localStorage !== 'undefined'
}

function readPersistedOrigin(): CollectionViewMode | null {
  if (!canUseStorage()) return null
  const saved = storage.get<string | null>(storage.KEYS.collectionLastView, null)
  return isCollectionViewMode(saved) ? saved : null
}

/** Last origin mode the user left (not the destination). Hydrated from localStorage. */
let lastCollectionView: CollectionViewMode | null = readPersistedOrigin()

export function rememberCollectionView(mode: CollectionViewMode): void {
  lastCollectionView = mode
  if (!canUseStorage()) return
  storage.set(storage.KEYS.collectionLastView, mode)
}

export function resetLastCollectionViewForTests(): void {
  lastCollectionView = null
  if (!canUseStorage()) return
  storage.remove(storage.KEYS.collectionLastView)
}

export function nextCollectionView(mode: CollectionViewMode): CollectionViewMode {
  const i = COLLECTION_VIEW_ORDER.indexOf(mode)
  const idx = i < 0 ? 0 : i
  return COLLECTION_VIEW_ORDER[(idx + 1) % COLLECTION_VIEW_ORDER.length]
}

export function prevCollectionView(mode: CollectionViewMode): CollectionViewMode {
  const i = COLLECTION_VIEW_ORDER.indexOf(mode)
  const idx = i < 0 ? 0 : i
  return COLLECTION_VIEW_ORDER[(idx - 1 + COLLECTION_VIEW_ORDER.length) % COLLECTION_VIEW_ORDER.length]
}

export function resolveCycleTarget(
  current: CollectionViewMode,
  direction: 'next' | 'prev',
): CollectionViewMode {
  if (direction === 'next') {
    if (current === 'list') return 'board'
    return nextCollectionView(current)
  }

  const last = lastCollectionView
  if (last !== current && isCollectionViewMode(last)) {
    return last
  }
  return prevCollectionView(current)
}

export function collectionViewRoute(mode: CollectionViewMode) {
  if (mode === 'board') return routes.view.board()
  if (mode === 'table') return routes.view.table()
  return routes.view.allSessions()
}
