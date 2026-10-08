import { describe, expect, test } from 'bun:test'
import { createStore } from 'jotai'
import { focusedPanelIdAtom, panelStackAtom, pushPanelAtom } from '../../atoms/panel-stack'
import { routes } from '../../../shared/routes'
import { surfaceTabRovingId, surfaceTabKeyboardTarget, surfaceTabCloseTarget } from '../surface-tab-navigation'

const tabs = ['a', 'b', 'c'].map(panelId => ({ panelId }))
describe('visible surface tab keyboard targets', () => {
  test('focused hidden browser leaves a visible roving tab stop', () => {
    expect(surfaceTabRovingId(tabs, 'hidden-browser')).toBe('a')
    expect(surfaceTabRovingId(tabs, 'b')).toBe('b')
    expect(surfaceTabRovingId([], 'b')).toBeNull()
  })
  test('arrows wrap and Home/End use visible strip order', () => {
    expect(surfaceTabKeyboardTarget(tabs, 'a', 'ArrowLeft')).toBe('c')
    expect(surfaceTabKeyboardTarget(tabs, 'c', 'ArrowRight')).toBe('a')
    expect(surfaceTabKeyboardTarget(tabs, 'b', 'Home')).toBe('a')
    expect(surfaceTabKeyboardTarget(tabs, 'b', 'End')).toBe('c')
    expect(surfaceTabKeyboardTarget(tabs, 'b', 'Enter')).toBeNull()
    expect(surfaceTabKeyboardTarget([], 'b', 'ArrowLeft')).toBeNull()
  })
  test('close chooses a surviving neighbour without activating a hidden browser', () => {
    expect(surfaceTabCloseTarget(tabs, 'b', 'b')).toBe('c')
    expect(surfaceTabCloseTarget(tabs, 'c', 'c')).toBe('b')
    expect(surfaceTabCloseTarget(tabs, 'b', 'a')).toBe('a')
    expect(surfaceTabCloseTarget(tabs, 'b', 'hidden-browser')).toBe('a')
    expect(surfaceTabCloseTarget([{ panelId: 'a' }], 'a', 'a')).toBeNull()
    expect(surfaceTabCloseTarget(tabs, 'missing', 'a')).toBeNull()
  })
})

describe('surface tab keyboard navigation', () => {
  test('has no keyboard target for empty and browser-only strips', () => {
    expect(surfaceTabRovingId([], null)).toBeNull()
    const tabs = [{ panelId: 'browser', kind: 'browser' }].filter((tab) => tab.kind !== 'browser')
    expect(surfaceTabRovingId(tabs, 'browser')).toBeNull()
    expect(surfaceTabKeyboardTarget(tabs, 'browser', 'ArrowRight')).toBeNull()
  })

  test('falls back to the first visible tab when browser focus is filtered out', () => {
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

  test('wraps arrows and supports Home/End without entering hidden tabs', () => {
    const tabs = [{ panelId: 'first' }, { panelId: 'last' }]
    expect(surfaceTabKeyboardTarget(tabs, 'first', 'ArrowLeft')).toBe('last')
    expect(surfaceTabKeyboardTarget(tabs, 'last', 'ArrowRight')).toBe('first')
    expect(surfaceTabKeyboardTarget(tabs, 'last', 'Home')).toBe('first')
    expect(surfaceTabKeyboardTarget(tabs, 'first', 'End')).toBe('last')
    expect(surfaceTabKeyboardTarget(tabs, 'first', 'Delete')).toBeNull()
    expect(surfaceTabRovingId(tabs, 'closed-panel')).toBe('first')
  })

  test('restores the surviving tab stop on close while preserving an independently focused browser', () => {
    const tabs = [{ panelId: 'first' }, { panelId: 'middle' }, { panelId: 'last' }]
    expect(surfaceTabCloseTarget(tabs, 'first', 'browser')).toBe('middle')
    expect(surfaceTabCloseTarget(tabs, 'middle', 'browser')).toBe('first')
    expect(surfaceTabCloseTarget(tabs, 'middle', 'last')).toBe('last')
    expect(surfaceTabCloseTarget(tabs, 'middle', 'middle')).toBe('last')
    expect(surfaceTabCloseTarget(tabs, 'last', 'last')).toBe('middle')
    expect(surfaceTabCloseTarget([{ panelId: 'only' }], 'only', 'browser')).toBeNull()
    expect(surfaceTabCloseTarget(tabs, 'missing', 'first')).toBeNull()
  })
})
