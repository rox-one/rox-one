import { describe, expect, it } from 'bun:test'
import { createStore } from 'jotai/vanilla'
import { focusedPanelIdAtom, panelStackAtom, pushPanelAtom, reconcilePanelStackAtom } from './panel-stack'

describe('UI-001 visible panel allocation', () => {
  it('opens the first panel at full width', () => {
    const store = createStore()
    store.set(pushPanelAtom, { route: 'home' })
    expect(store.get(panelStackAtom).map(panel => panel.proportion)).toEqual([1])
  })

  it('opens a sibling with a positive width and preserves the existing panel identity', () => {
    const store = createStore()
    store.set(pushPanelAtom, { route: 'home' })
    const original = store.get(panelStackAtom)[0]
    store.set(pushPanelAtom, { route: 'sources/source/one' })
    const panels = store.get(panelStackAtom)
    expect(panels[0].id).toBe(original.id)
    expect(panels.map(panel => panel.proportion)).toEqual([0.5, 0.5])
    expect(store.get(focusedPanelIdAtom)).toBe(panels[1].id)
  })

  it('preserves the ratio of resized siblings when inserting another panel', () => {
    const store = createStore()
    store.set(reconcilePanelStackAtom, { entries: [
      { route: 'home', proportion: 0.75 },
      { route: 'sources/source/one', proportion: 0.25 },
    ], focusedIndex: 0 })
    store.set(pushPanelAtom, { route: 'skills/skill/one', afterIndex: 0 })
    const panels = store.get(panelStackAtom)
    expect(panels.map(panel => panel.route)).toEqual(['home', 'skills/skill/one', 'sources/source/one'])
    expect(panels.every(panel => panel.proportion > 0)).toBe(true)
    expect(panels[0].proportion / panels[2].proportion).toBeCloseTo(3)
    expect(panels.reduce((sum, panel) => sum + panel.proportion, 0)).toBeCloseTo(1)
  })
})
