import { describe, it, expect } from 'bun:test'
import { createStore } from 'jotai'
import {
  panelStackAtom,
  focusedPanelIdAtom,
  pushPanelAtom,
  reconcilePanelStackAtom,
  updateFocusedPanelRouteAtom,
  updatePanelRouteByIdAtom,
  openOrFocusPanelRouteAtom,
  collapseDuplicateSurfaces,
  panelSurfaceKey,
} from '../panel-stack'

describe('one panel per surface', () => {
  it('keys deep routes by surface, sessions and browser tabs by identity', () => {
    expect(panelSurfaceKey({ route: 'automations' })).toBe(panelSurfaceKey({ route: 'automations/a1' }))
    expect(panelSurfaceKey({ route: 'allSessions/session/s1' })).not.toBe(panelSurfaceKey({ route: 'allSessions/session/s2' }))
    expect(panelSurfaceKey({ route: 'browser/b1' })).not.toBe(panelSurfaceKey({ route: 'browser/b2' }))
    expect(panelSurfaceKey({ route: 'tasks', tool: 'tasks' })).not.toBe(panelSurfaceKey({ route: 'tasks' }))
  })

  it('pushing an open surface focuses and retargets the existing panel', () => {
    const store = createStore()
    store.set(pushPanelAtom, { route: 'automations' as never })
    store.set(pushPanelAtom, { route: 'tasks' as never })
    const first = store.get(panelStackAtom)[0].id
    store.set(pushPanelAtom, { route: 'automations/morning' as never })
    const stack = store.get(panelStackAtom)
    expect(stack).toHaveLength(2)
    expect(stack[0].route).toBe('automations/morning')
    expect(store.get(focusedPanelIdAtom)).toBe(first)
  })

  it('navigating a panel onto another panel\'s surface collapses the duplicate', () => {
    const store = createStore()
    store.set(pushPanelAtom, { route: 'automations/morning' as never })
    store.set(pushPanelAtom, { route: 'feed' as never })
    const feedId = store.get(panelStackAtom)[1].id
    store.set(updateFocusedPanelRouteAtom, 'automations/morning' as never)
    const stack = store.get(panelStackAtom)
    expect(stack).toHaveLength(1)
    expect(stack[0].id).toBe(feedId)
    expect(store.get(focusedPanelIdAtom)).toBe(feedId)
    expect(stack[0].proportion).toBeCloseTo(1)
  })

  it('late route results keep the owning panel and drop its twin', () => {
    const store = createStore()
    store.set(pushPanelAtom, { route: 'notes' as never })
    store.set(pushPanelAtom, { route: 'feed' as never })
    const [, feed] = store.get(panelStackAtom)
    expect(store.set(updatePanelRouteByIdAtom, { id: feed.id, route: 'notes/n1' as never })).toBe(true)
    expect(store.get(panelStackAtom).map(p => p.id)).toEqual([feed.id])
  })

  it('restore collapses duplicated entries and keeps the focused one', () => {
    const store = createStore()
    store.set(reconcilePanelStackAtom, {
      entries: [
        { route: 'automations/a' as never, proportion: 1 },
        { route: 'feed' as never, proportion: 1 },
        { route: 'automations/a' as never, proportion: 1 },
        { route: 'automations/b' as never, proportion: 1 },
      ],
      focusedIndex: 3,
    })
    const stack = store.get(panelStackAtom)
    expect(stack.map(p => p.route)).toEqual(['feed', 'automations/b'])
    expect(store.get(focusedPanelIdAtom)).toBe(stack[1].id)
  })

  it('openOrFocus reuses the surface panel', () => {
    const store = createStore()
    store.set(pushPanelAtom, { route: 'tasks' as never })
    const result = store.set(openOrFocusPanelRouteAtom, { route: 'tasks/today' as never })
    expect(result.status).toBe('focused')
    expect(store.get(panelStackAtom)).toHaveLength(1)
  })

  it('collapse is a no-op without duplicates', () => {
    const stack = [{ id: 'a', route: 'feed', proportion: 1 }]
    expect(collapseDuplicateSurfaces(stack)).toBe(stack)
  })
})
