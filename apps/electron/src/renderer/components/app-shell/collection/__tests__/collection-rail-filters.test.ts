import { describe, expect, it } from 'bun:test'
import { DEFAULT_COLLECTION_FILTERS } from '@craft-agent/shared/sessions/collection'
import { createSavedSlice } from '../collection-slices'
import { chipsAfterRailChange, persistUserCollectionSlices, railViewNavigation, userSliceNavigation } from '../collection-rail-filters'

describe('chipsAfterRailChange', () => {
  const chips = { projectId: ['p1'] }

  it('clears chips when the rail key changes', () => {
    expect(chipsAfterRailChange({ prevKey: 'allSessions', nextKey: 'flagged', prevChips: chips })).toEqual(
      DEFAULT_COLLECTION_FILTERS,
    )
  })

  it('keeps chips when the same rail key is clicked', () => {
    expect(chipsAfterRailChange({ prevKey: 'allSessions', nextKey: 'allSessions', prevChips: chips })).toEqual(chips)
  })

  it('keeps chips for jump-to-project/task', () => {
    expect(
      chipsAfterRailChange({ prevKey: 'allSessions', nextKey: 'allSessions', jump: true, prevChips: chips }),
    ).toEqual(chips)
  })
})

describe('userSliceNavigation (Filter save → Views rail)', () => {
  it('prefixes slice- ids and routes to view/<encoded id>', () => {
    const created = createSavedSlice('Mine', { flagged: true, status: ['todo'] })
    const nav = userSliceNavigation(created)
    expect(nav.skipChipClear).toBe(true)
    expect(nav.viewId).toBe(`slice:${created.id}`)
    expect(nav.filters).toEqual({ flagged: true, status: ['todo'] })
    expect(nav.route).toBe(`view/${encodeURIComponent(nav.viewId)}`)
    expect(nav.filters).not.toBe(created.filters)
  })

  it('does not double-prefix ids already on the Views rail', () => {
    const nav = userSliceNavigation({
      id: 'slice:slice-abc',
      name: 'Mine',
      filters: { hasUnread: true },
    })
    expect(nav.viewId).toBe('slice:slice-abc')
    expect(nav.route).toBe('view/slice%3Aslice-abc')
  })
})

describe('railViewNavigation (Views rail click)', () => {
  it('applies chips for Filter slices and keeps skipChipClear', () => {
    const nav = railViewNavigation({
      id: 'slice:slice-abc',
      collectionFilters: { flagged: true },
    })
    expect(nav.viewId).toBe('slice:slice-abc')
    expect(nav.filters).toEqual({ flagged: true })
    expect(nav.route).toBe('view/slice%3Aslice-abc')
    expect(nav.skipChipClear).toBe(true)
  })

  it('does not invent chips for default session views', () => {
    const nav = railViewNavigation({ id: 'view-new' })
    expect(nav.viewId).toBe('view-new')
    expect(nav.filters).toBeNull()
    expect(nav.route).toBe('view/view-new')
    expect(nav.skipChipClear).toBe(true)
  })

  it('routes Views All without inventing chips', () => {
    const nav = railViewNavigation({ id: '__all__' })
    expect(nav.viewId).toBe('__all__')
    expect(nav.filters).toBeNull()
    expect(nav.route).toBe('view/__all__')
    expect(nav.skipChipClear).toBe(true)
  })
})

describe('persistUserCollectionSlices', () => {
  it('skips save while views are loading or empty', async () => {
    const saveViews = async () => { throw new Error('should not save') }
    expect(await persistUserCollectionSlices({
      workspaceId: 'ws',
      viewsLoading: true,
      viewConfigs: [{ id: 'view-new', name: 'New', domain: 'sessions', expression: 'true' }],
      slices: [{ id: 'slice-a', name: 'A', filters: { flagged: true } }],
      saveViews,
    })).toBe('skipped')
    expect(await persistUserCollectionSlices({
      workspaceId: 'ws',
      viewsLoading: false,
      viewConfigs: [],
      slices: [{ id: 'slice-a', name: 'A', filters: { flagged: true } }],
      saveViews,
    })).toBe('skipped')
  })

  it('saves merged views then refreshes before Filter navigation', async () => {
    const order: string[] = []
    const saveViews = async (_ws: string, views: { id: string }[]) => {
      order.push('save')
      expect(views.some((v) => v.id === 'slice:slice-a')).toBe(true)
      expect(views.some((v) => v.id === 'view-new')).toBe(true)
    }
    const refresh = async () => { order.push('refresh') }
    const result = await persistUserCollectionSlices({
      workspaceId: 'ws',
      viewsLoading: false,
      viewConfigs: [{ id: 'view-new', name: 'New', domain: 'sessions', expression: 'true' }],
      slices: [{ id: 'slice-a', name: 'A', filters: { flagged: true } }],
      saveViews,
      refresh,
      clearLegacy: () => { order.push('clear') },
    })
    expect(result).toBe('saved')
    expect(order).toEqual(['save', 'clear', 'refresh'])
  })
})
