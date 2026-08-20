import { routes } from '../../../../shared/routes'
import type { CollectionViewMode } from '../kanban/BoardListToggle'

export const COLLECTION_VIEW_ORDER: readonly CollectionViewMode[] = ['list', 'board', 'table']

let lastCollectionView: CollectionViewMode | null = null

export function rememberCollectionView(mode: CollectionViewMode): void {
  lastCollectionView = mode
}

export function lastCollectionViewMode(): CollectionViewMode | null {
  return lastCollectionView
}

export function getLastCollectionViewMode(): CollectionViewMode | null {
  return lastCollectionViewMode()
}

export function resetLastCollectionViewForTests(): void {
  lastCollectionView = null
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

function isCollectionViewMode(mode: string | null): mode is CollectionViewMode {
  return mode !== null && (COLLECTION_VIEW_ORDER as readonly string[]).includes(mode)
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
