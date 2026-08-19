import { routes } from '../../../../shared/routes'
import type { CollectionViewMode } from '../kanban/BoardListToggle'

export const COLLECTION_VIEW_ORDER: readonly CollectionViewMode[] = ['list', 'board', 'table']

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

export function collectionViewRoute(mode: CollectionViewMode) {
  if (mode === 'board') return routes.view.board()
  if (mode === 'table') return routes.view.table()
  return routes.view.allSessions()
}
