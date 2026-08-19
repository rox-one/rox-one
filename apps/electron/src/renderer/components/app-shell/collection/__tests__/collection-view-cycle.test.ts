import { describe, expect, it } from 'bun:test'
import {
  COLLECTION_VIEW_ORDER,
  collectionViewRoute,
  nextCollectionView,
  prevCollectionView,
} from '../collection-view-cycle'

describe('collection-view-cycle', () => {
  it('orders list → board → table', () => {
    expect([...COLLECTION_VIEW_ORDER]).toEqual(['list', 'board', 'table'])
  })

  it('wraps next', () => {
    expect(nextCollectionView('list')).toBe('board')
    expect(nextCollectionView('board')).toBe('table')
    expect(nextCollectionView('table')).toBe('list')
  })

  it('wraps prev', () => {
    expect(prevCollectionView('list')).toBe('table')
    expect(prevCollectionView('board')).toBe('list')
    expect(prevCollectionView('table')).toBe('board')
  })

  it('maps routes', () => {
    expect(collectionViewRoute('list')).toBe('allSessions')
    expect(collectionViewRoute('board')).toBe('board')
    expect(collectionViewRoute('table')).toBe('table')
  })
})
