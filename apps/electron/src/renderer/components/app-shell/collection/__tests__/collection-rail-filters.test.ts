import { describe, expect, it } from 'bun:test'
import { DEFAULT_COLLECTION_FILTERS } from '@craft-agent/shared/sessions/collection'
import { createSavedSlice } from '../collection-slices'
import { chipsAfterRailChange, railViewNavigation, userSliceNavigation } from '../collection-rail-filters'

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
})
