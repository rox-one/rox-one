import { describe, expect, it } from 'bun:test'
import { createStore } from 'jotai'
import { focusedPanelIdAtom, panelStackAtom, pushPanelAtom } from '../../atoms/panel-stack'
import { routes } from '../../../shared/routes'
import { surfaceTabKeyboardTarget, surfaceTabRovingId } from '../surface-tab-navigation'

describe('surface tab keyboard navigation', () => {
  it('has no keyboard target for empty and browser-only strips', () => {
    expect(surfaceTabRovingId([], null)).toBeNull()
    const tabs = [{ panelId: 'browser', kind: 'browser' }].filter((tab) => tab.kind !== 'browser')
    expect(surfaceTabRovingId(tabs, 'browser')).toBeNull()
    expect(surfaceTabKeyboardTarget(tabs, 'browser', 'ArrowRight')).toBeNull()
  })

  it('falls back to the first visible tab when browser focus is filtered out', () => {
    const store = createStore()
    store.set(pushPanelAtom, { route: routes.view.notes('draft') })
    store.set(pushPanelAtom, { route: routes.view.allSessions('chat') })
    store.set(pushPanelAtom, { route: routes.view.browser('embedded') })
    const panels = store.get(panelStackAtom)
    const visible = panels.filter((panel) => panel.panelType !== 'browser').map((panel) => ({ panelId: panel.id }))
    expect(surfaceTabRovingId(visible, store.get(focusedPanelIdAtom))).toBe(panels[0].id)
    const next = surfaceTabKeyboardTarget(visible, panels[0].id, 'ArrowRight')
    expect(next).toBe(panels[1].id)
    store.set(focusedPanelIdAtom, next)
    expect(surfaceTabRovingId(visible, store.get(focusedPanelIdAtom))).toBe(panels[1].id)
    expect(store.get(panelStackAtom)).toBe(panels)
  })

  it('wraps arrows and supports Home/End without entering hidden tabs', () => {
    const tabs = [{ panelId: 'first' }, { panelId: 'last' }]
    expect(surfaceTabKeyboardTarget(tabs, 'first', 'ArrowLeft')).toBe('last')
    expect(surfaceTabKeyboardTarget(tabs, 'last', 'ArrowRight')).toBe('first')
    expect(surfaceTabKeyboardTarget(tabs, 'last', 'Home')).toBe('first')
    expect(surfaceTabKeyboardTarget(tabs, 'first', 'End')).toBe('last')
    expect(surfaceTabKeyboardTarget(tabs, 'first', 'Delete')).toBeNull()
    expect(surfaceTabRovingId(tabs, 'closed-panel')).toBe('first')
  })
})
