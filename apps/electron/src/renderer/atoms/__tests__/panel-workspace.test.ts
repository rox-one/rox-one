import { describe, expect, it } from 'bun:test'
import { createStore } from 'jotai'
import { createPanelWorkspaceLayoutAtom } from '../panel-workspace'
import { closePanelAtom, expandedPanelIdAtom, focusedPanelIdAtom, focusNextPanelAtom, panelStackAtom, reconcilePanelStackAtom } from '../panel-stack'
import { createResizeController } from '../../components/app-shell/resize-controller'
import { togglePanelFullScreen, type PanelWorkspaceLayoutStore } from '../../lib/panel-workspace-layout'
import type { StorageKey } from '../../lib/local-storage'

function memoryStorage(): PanelWorkspaceLayoutStore & { writes: number } {
  const data = new Map<string, unknown>()
  return {
    writes: 0,
    get<T>(key: StorageKey, fallback: T, suffix?: string) {
      return (data.get(`${key}:${suffix}`) ?? fallback) as T
    },
    set<T>(key: StorageKey, value: T, suffix?: string) {
      data.set(`${key}:${suffix}`, structuredClone(value))
      this.writes += 1
    },
  }
}

describe('workspace layout atom lifecycle', () => {
  it('previews in memory, restores on cancel and hydrates only the committed geometry', () => {
    const storage = memoryStorage()
    const store = createStore()
    const layout = createPanelWorkspaceLayoutAtom('a', storage)
    const frames: Array<() => void> = []
    const apply = (a: number, b: number, commit: boolean) => store.set(layout, {
      update: (current) => ({ ...current, grids: { '2x2': { columns: [0.5, 0.5], rows: [a / (a + b), b / (a + b)] } } }),
      commit,
    })
    const controller = createResizeController({
      onPreview: (a, b) => apply(a, b, false),
      onCancel: (a, b) => apply(a, b, false),
      onCommit: (a, b) => apply(a, b, true),
      requestFrame: (callback) => { frames.push(callback); return frames.length },
      cancelFrame: () => { frames.length = 0 },
    })
    const bounds = { leftId: 'top', rightId: 'bottom', total: 800, sizeA: 400, minA: 240, minB: 240, maxA: 560, maxB: 560 }
    controller.start(bounds)
    controller.moveBy(120, true)
    expect(store.get(layout).grids['2x2'].rows).toEqual([0.65, 0.35])
    expect(storage.writes).toBe(0)
    controller.cancel()
    expect(store.get(layout).grids['2x2'].rows).toEqual([0.5, 0.5])
    expect(storage.writes).toBe(0)
    controller.start(bounds)
    controller.moveBy(120, true)
    controller.commit()
    expect(storage.writes).toBe(1)
    const reloaded = createPanelWorkspaceLayoutAtom('a', storage)
    expect(createStore().get(reloaded).grids['2x2'].rows).toEqual([0.65, 0.35])
    expect(createStore().get(createPanelWorkspaceLayoutAtom('b', storage)).grids).toEqual({})
  })

  it('arrangement changes preserve routes, panel identities and keyboard focus behavior', () => {
    const store = createStore()
    const layout = createPanelWorkspaceLayoutAtom('a', memoryStorage())
    store.set(reconcilePanelStackAtom, {
      entries: Array.from({ length: 6 }, (_, index) => ({ route: `allSessions/session/s${index}` as const, proportion: 1 / 6 })),
      focusedIndex: 3,
    })
    const panels = store.get(panelStackAtom)
    for (const mode of ['grid-2', 'grid-3', 'focus', 'auto'] as const) {
      store.set(layout, { update: (current) => ({ ...current, mode }), commit: true })
      expect(store.get(panelStackAtom)).toBe(panels)
      expect(store.get(focusedPanelIdAtom)).toBe(panels[3].id)
    }
    store.set(focusNextPanelAtom)
    expect(store.get(focusedPanelIdAtom)).toBe(panels[4].id)
    store.set(closePanelAtom, panels[4].id)
    expect(store.get(focusedPanelIdAtom)).toBe(panels[5].id)
    expect(store.get(panelStackAtom).map((entry) => entry.id)).toEqual(panels.filter((_, index) => index !== 4).map((entry) => entry.id))
  })

  it('holds a promoted panel until it leaves the stack, then restores the grid', () => {
    const store = createStore()
    store.set(reconcilePanelStackAtom, {
      entries: ['a', 'b', 'c'].map((id) => ({ route: `allSessions/session/${id}` as const, proportion: 1 / 3 })),
    })
    const [first, second, third] = store.get(panelStackAtom)
    store.set(expandedPanelIdAtom, togglePanelFullScreen(null, second.id, [first.id, second.id, third.id]))
    expect(store.get(expandedPanelIdAtom)).toBe(second.id)

    // Closing an unrelated panel must not disturb the promoted one.
    store.set(closePanelAtom, first.id)
    expect(store.get(expandedPanelIdAtom)).toBe(second.id)
    // Closing the promoted panel returns the workspace to the shared grid.
    store.set(closePanelAtom, second.id)
    expect(store.get(expandedPanelIdAtom)).toBeNull()

    // A stack reconcile that drops the promoted panel also clears it.
    store.set(reconcilePanelStackAtom, {
      entries: ['x', 'y', 'z'].map((id) => ({ route: `allSessions/session/${id}` as const, proportion: 1 / 3 })),
    })
    const rebuilt = store.get(panelStackAtom)
    store.set(expandedPanelIdAtom, rebuilt[2].id)
    store.set(reconcilePanelStackAtom, { entries: [{ route: rebuilt[0].route, proportion: 1 }] })
    expect(store.get(expandedPanelIdAtom)).toBeNull()
  })
})
