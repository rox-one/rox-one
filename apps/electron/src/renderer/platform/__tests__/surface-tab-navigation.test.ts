import { describe, expect, test } from 'bun:test'
import { createStore } from 'jotai'
import { focusedPanelIdAtom, panelStackAtom, pushPanelAtom } from '@/atoms/panel-stack'
import { routes } from '../../../shared/routes'
import { tabRovingId, tabNavigationTarget, tabCloseTarget } from '@/components/ui/tabs'

const tabs = ['a', 'b', 'c'].map(id => ({ id }))

describe('visible tab keyboard targets', () => {
  test('focused hidden browser leaves a visible roving tab stop', () => {
    expect(tabRovingId(tabs, 'hidden-browser')).toBe('a')
    expect(tabRovingId(tabs, 'b')).toBe('b')
    expect(tabRovingId([], 'b')).toBeNull()
  })

  test('arrows wrap and Home/End use visible strip order', () => {
    expect(tabNavigationTarget(tabs, 'a', 'ArrowLeft')).toBe('c')
    expect(tabNavigationTarget(tabs, 'c', 'ArrowRight')).toBe('a')
    expect(tabNavigationTarget(tabs, 'b', 'Home')).toBe('a')
    expect(tabNavigationTarget(tabs, 'b', 'End')).toBe('c')
    expect(tabNavigationTarget(tabs, 'b', 'Enter')).toBeNull()
    expect(tabNavigationTarget([], 'b', 'ArrowLeft')).toBeNull()
  })

  test('vertical profile accepts Up/Down and ignores Left/Right', () => {
    expect(tabNavigationTarget(tabs, 'a', 'ArrowDown', 'vertical')).toBe('b')
    expect(tabNavigationTarget(tabs, 'a', 'ArrowUp', 'vertical')).toBe('c')
    expect(tabNavigationTarget(tabs, 'a', 'ArrowRight', 'vertical')).toBeNull()
    expect(tabNavigationTarget(tabs, 'a', 'ArrowRight', 'horizontal')).toBe('b')
  })

  test('navigation and roving skip disabled items', () => {
    const withDisabled = [{ id: 'a' }, { id: 'b', disabled: true }, { id: 'c' }]
    expect(tabNavigationTarget(withDisabled, 'a', 'ArrowRight')).toBe('c')
    expect(tabNavigationTarget(withDisabled, 'c', 'ArrowLeft')).toBe('a')
    expect(tabNavigationTarget(withDisabled, 'b', 'ArrowRight')).toBe('c')
    expect(tabRovingId([{ id: 'a', disabled: true }, { id: 'b' }], 'a')).toBe('b')
    expect(tabRovingId([{ id: 'a', disabled: true }], 'a')).toBeNull()
  })

  test('close chooses a surviving neighbour without activating a hidden browser', () => {
    expect(tabCloseTarget(tabs, 'b', 'b')).toBe('c')
    expect(tabCloseTarget(tabs, 'c', 'c')).toBe('b')
    expect(tabCloseTarget(tabs, 'b', 'a')).toBe('a')
    expect(tabCloseTarget(tabs, 'b', 'hidden-browser')).toBe('a')
    expect(tabCloseTarget([{ id: 'a' }], 'a', 'a')).toBeNull()
    expect(tabCloseTarget(tabs, 'missing', 'a')).toBeNull()
  })
})

describe('surface tab keyboard navigation', () => {
  test('has no keyboard target for empty and browser-only strips', () => {
    expect(tabRovingId([], null)).toBeNull()
    const visible = [{ id: 'browser', kind: 'browser' }].filter((tab) => tab.kind !== 'browser')
    expect(tabRovingId(visible, 'browser')).toBeNull()
    expect(tabNavigationTarget(visible, 'browser', 'ArrowRight')).toBeNull()
  })

  test('falls back to the first visible tab when browser focus is filtered out', () => {
    const store = createStore()
    store.set(pushPanelAtom, { route: routes.view.notes('draft') })
    store.set(pushPanelAtom, { route: routes.view.allSessions('chat') })
    store.set(pushPanelAtom, { route: routes.view.browser('embedded') })
    const panels = store.get(panelStackAtom)
    const visible = panels.filter((panel) => panel.panelType !== 'browser').map((panel) => ({ id: panel.id }))
    expect(tabRovingId(visible, store.get(focusedPanelIdAtom))).toBe(panels[0].id)
    const next = tabNavigationTarget(visible, panels[0].id, 'ArrowRight')
    expect(next).toBe(panels[1].id)
    store.set(focusedPanelIdAtom, next)
    expect(tabRovingId(visible, store.get(focusedPanelIdAtom))).toBe(panels[1].id)
    expect(store.get(panelStackAtom)).toBe(panels)
  })

  test('wraps arrows and supports Home/End without entering hidden tabs', () => {
    const twoTabs = [{ id: 'first' }, { id: 'last' }]
    expect(tabNavigationTarget(twoTabs, 'first', 'ArrowLeft')).toBe('last')
    expect(tabNavigationTarget(twoTabs, 'last', 'ArrowRight')).toBe('first')
    expect(tabNavigationTarget(twoTabs, 'last', 'Home')).toBe('first')
    expect(tabNavigationTarget(twoTabs, 'first', 'End')).toBe('last')
    expect(tabNavigationTarget(twoTabs, 'first', 'Delete')).toBeNull()
    expect(tabRovingId(twoTabs, 'closed-panel')).toBe('first')
  })

  test('restores the surviving tab stop on close while preserving an independently focused browser', () => {
    const three = [{ id: 'first' }, { id: 'middle' }, { id: 'last' }]
    expect(tabCloseTarget(three, 'first', 'browser')).toBe('middle')
    expect(tabCloseTarget(three, 'middle', 'browser')).toBe('first')
    expect(tabCloseTarget(three, 'middle', 'last')).toBe('last')
    expect(tabCloseTarget(three, 'middle', 'middle')).toBe('last')
    expect(tabCloseTarget(three, 'last', 'last')).toBe('middle')
    expect(tabCloseTarget([{ id: 'only' }], 'only', 'browser')).toBeNull()
    expect(tabCloseTarget(three, 'missing', 'first')).toBeNull()
  })
})