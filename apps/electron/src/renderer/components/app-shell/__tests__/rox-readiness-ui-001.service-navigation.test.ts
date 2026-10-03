import { describe, expect, it } from 'bun:test'
import { createStore } from 'jotai'
import { focusedPanelIdAtom, panelStackAtom, pushPanelAtom } from '../../../atoms/panel-stack'
import { APP_NAV_DESTINATIONS } from '../nav-destinations'
import { findServicePanel, focusServicePanelAtom } from '../service-navigation'
import { routes, type ViewRoute } from '../../../../shared/routes'
import { join } from 'node:path'
import { invokeShellNavigationCallback } from './rox-readiness-ui-001.shell-callback'

describe('UI-001 retained addresses and service focus', () => {
  it('cannot classify unavailable or malformed addresses as an existing service', () => {
    for (const route of ['knowledge/unknown/doc', 'allSessions/session/s1/future', 'notes/note/%GG', 'future/session/private']) {
      const store = createStore()
      store.set(pushPanelAtom, { route: route as ViewRoute })
      for (const destination of APP_NAV_DESTINATIONS) {
        expect(findServicePanel(store.get(panelStackAtom), store.get(focusedPanelIdAtom), destination.id)).toBeUndefined()
      }
    }
  })
  it('refuses to focus an unavailable panel and preserves its address', () => {
    const store = createStore()
    store.set(pushPanelAtom, { route: 'knowledge/unknown/doc' as ViewRoute })
    const panels = store.get(panelStackAtom), focused = store.get(focusedPanelIdAtom)
    expect(store.set(focusServicePanelAtom, 'sessions')).toBe(false)
    expect(store.get(panelStackAtom)).toBe(panels)
    expect(store.get(focusedPanelIdAtom)).toBe(focused)
  })
  it('focuses a valid service sibling while preserving all retained panel identities', () => {
    const store = createStore()
    store.set(pushPanelAtom, { route: 'allSessions/session/s1' as ViewRoute })
    const target = store.get(focusedPanelIdAtom)
    store.set(pushPanelAtom, { route: 'knowledge/unknown/doc' as ViewRoute })
    const panels = store.get(panelStackAtom)
    expect(store.set(focusServicePanelAtom, 'sessions')).toBe(true)
    expect(store.get(focusedPanelIdAtom)).toBe(target)
    expect(store.get(panelStackAtom)).toBe(panels)
  })
  it('actual Sessions callback opens its canonical route rather than reusing an unavailable panel', () => {
    const store = createStore()
    store.set(pushPanelAtom, { route: 'knowledge/unknown/doc' as ViewRoute })
    const panels = store.get(panelStackAtom), focused = store.get(focusedPanelIdAtom)
    expect(invokeShellNavigationCallback(join(__dirname, '../AppShell.tsx'), { name: 'handleAllSessionsClick' }, store))
      .toEqual([routes.view.allSessions()])
    expect(store.get(panelStackAtom)).toBe(panels)
    expect(store.get(focusedPanelIdAtom)).toBe(focused)
  })

})
