import { beforeEach, describe, expect, it } from 'bun:test'
import {
  COLLECTION_VIEW_ORDER,
  collectionViewRoute,
  nextCollectionView,
  prevCollectionView,
  rememberCollectionView,
  resetLastCollectionViewForTests,
  resolveCycleTarget,
} from '../collection-view-cycle'

describe('collection-view-cycle', () => {
  beforeEach(() => {
    resetLastCollectionViewForTests()
  })

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

  it('list next always goes to board', () => {
    rememberCollectionView('table')
    expect(resolveCycleTarget('list', 'next')).toBe('board')
  })

  it('after list→board, prev returns list not table', () => {
    rememberCollectionView('list')
    expect(resolveCycleTarget('list', 'next')).toBe('board')
    expect(resolveCycleTarget('board', 'prev')).toBe('list')
  })

  it('after board→table, prev returns board', () => {
    rememberCollectionView('board')
    expect(resolveCycleTarget('board', 'next')).toBe('table')
    expect(resolveCycleTarget('table', 'prev')).toBe('board')
  })

  it('menu jump list→table: prev returns list, not board', () => {
    rememberCollectionView('list')
    expect(resolveCycleTarget('table', 'prev')).toBe('list')
  })

  it('with no history, list prev wraps to table', () => {
    expect(resolveCycleTarget('list', 'prev')).toBe('table')
  })

  it('wraps table next to list', () => {
    expect(resolveCycleTarget('table', 'next')).toBe('list')
  })
})
