import { beforeEach, describe, expect, it } from 'bun:test'
import {
  COLLECTION_VIEW_ORDER,
  collectionViewRoute,
  isCollectionCanvasView,
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

  it('orders list → board → table → heatmap', () => {
    expect([...COLLECTION_VIEW_ORDER]).toEqual(['list', 'board', 'table', 'heatmap'])
  })

  it('wraps next', () => {
    expect(nextCollectionView('list')).toBe('board')
    expect(nextCollectionView('board')).toBe('table')
    expect(nextCollectionView('table')).toBe('heatmap')
    expect(nextCollectionView('heatmap')).toBe('list')
  })

  it('wraps prev', () => {
    expect(prevCollectionView('list')).toBe('heatmap')
    expect(prevCollectionView('board')).toBe('list')
    expect(prevCollectionView('table')).toBe('board')
    expect(prevCollectionView('heatmap')).toBe('table')
  })

  it('maps routes', () => {
    expect(collectionViewRoute('list')).toBe('allSessions')
    expect(collectionViewRoute('board')).toBe('board')
    expect(collectionViewRoute('table')).toBe('table')
    expect(collectionViewRoute('heatmap')).toBe('heatmap')
  })

  it('treats board/table/heatmap as full-width canvas views', () => {
    expect(isCollectionCanvasView('list')).toBe(false)
    expect(isCollectionCanvasView('heatmap')).toBe(true)
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

  it('with no history, list prev wraps to heatmap', () => {
    expect(resolveCycleTarget('list', 'prev')).toBe('heatmap')
  })

  it('wraps table next to heatmap and heatmap next to list', () => {
    expect(resolveCycleTarget('table', 'next')).toBe('heatmap')
    expect(resolveCycleTarget('heatmap', 'next')).toBe('list')
  })

  it('persists origin across remember and read', () => {
    rememberCollectionView('list')
    expect(resolveCycleTarget('table', 'prev')).toBe('list')
  })
})
