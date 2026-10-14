import { useDomForFile as installDom } from '../../../../../../../packages/ui/src/components/primitives/__tests__/dom-env'
import { describe, expect, it } from 'bun:test'
import { createStore } from 'jotai'

installDom()

const { panelStackAtom, focusedPanelIdAtom } = await import('@/atoms/panel-stack')
const split = await import('../split-mode')

const panel = (id: string, route: string) => ({ id, route, proportion: 1, panelType: 'session', laneId: 'main' }) as never

describe('split mode (top50 #13)', () => {
  it('one panel: opens a companion and closes it again on toggle', () => {
    const store = createStore()
    store.set(panelStackAtom, [panel('a', 'docs')])
    store.set(focusedPanelIdAtom, 'a')
    expect(store.set(split.toggleSplitAtom)).toBe(true)
    const ids = store.get(split.activeSplitIdsAtom)
    expect(ids?.[1]).toBe('a')
    expect(store.get(panelStackAtom).length).toBe(2)
    expect(store.get(panelStackAtom)[0]!.route).toBe('allSessions')
    store.set(split.toggleSplitAtom)
    expect(store.get(split.activeSplitIdsAtom)).toBeNull()
    expect(store.get(panelStackAtom).map((p) => p.id)).toEqual(['a'])
  })

  it('two panels: pairs focused with its neighbour and keeps both on exit', () => {
    const store = createStore()
    store.set(panelStackAtom, [panel('a', 'docs'), panel('b', 'tasks'), panel('c', 'feed')])
    store.set(focusedPanelIdAtom, 'c')
    store.set(split.toggleSplitAtom)
    expect(store.get(split.activeSplitIdsAtom)).toEqual(['b', 'c'])
    store.set(split.toggleSplitAtom)
    expect(store.get(panelStackAtom).length).toBe(3)
  })

  it('closing a split panel ends split; companion route avoids the current screen', () => {
    const store = createStore()
    store.set(panelStackAtom, [panel('a', 'docs'), panel('b', 'tasks')])
    store.set(focusedPanelIdAtom, 'a')
    store.set(split.toggleSplitAtom)
    store.set(panelStackAtom, [panel('a', 'docs')])
    expect(store.get(split.activeSplitIdsAtom)).toBeNull()
    expect(split.splitCompanionRoute('allSessions/session/x')).toBe('notes')
    expect(split.splitPanelWidth(1000, 8)).toBe(496)
    expect(split.splitPanelWidth(300, 8)).toBe(320)
  })

  it('leaving split keeps a companion the user touched or navigated', () => {
    const store = createStore()
    store.set(panelStackAtom, [panel('a', 'docs')])
    store.set(focusedPanelIdAtom, 'a')
    store.set(split.toggleSplitAtom)
    const companion = store.get(split.activeSplitIdsAtom)![0]
    store.set(split.markSplitPanelTouchedAtom, companion)
    store.set(split.toggleSplitAtom)
    expect(store.get(panelStackAtom).length).toBe(2)

    const nav = createStore()
    nav.set(panelStackAtom, [panel('a', 'docs')])
    nav.set(focusedPanelIdAtom, 'a')
    nav.set(split.toggleSplitAtom)
    const id = nav.get(split.activeSplitIdsAtom)![0]
    nav.set(panelStackAtom, nav.get(panelStackAtom).map((p) => (p.id === id ? { ...p, route: 'allSessions/session/x' } : p)))
    nav.set(split.toggleSplitAtom)
    expect(nav.get(panelStackAtom).length).toBe(2)
  })
})
