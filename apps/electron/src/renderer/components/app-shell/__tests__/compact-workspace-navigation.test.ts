import { describe, expect, it } from 'bun:test'
import { createStore } from 'jotai'
import { focusedPanelIdAtom, panelStackAtom, pushPanelAtom } from '../../../atoms/panel-stack'
import { routes } from '../../../../shared/routes'
import { parseRouteToNavigationState } from '../../../../shared/route-parser'
import { APP_NAV_DESTINATIONS } from '../nav-destinations'
import { getActiveService } from '../service-navigation'
import { resolveCompactWorkspaceSelection } from '../compact-workspace-navigation'

describe('compact workspace navigation', () => {
  it('keeps every registered service reachable without a desktop rail or sidebar', () => {
    for (const destination of APP_NAV_DESTINATIONS) {
      const action = resolveCompactWorkspaceSelection([], null, { kind: 'service', serviceId: destination.id })
      if (destination.action === 'open-browser') expect(action).toEqual({ kind: 'open-browser' })
      else {
        expect(action?.kind).toBe('navigate')
        if (action?.kind === 'navigate') {
          expect(getActiveService(parseRouteToNavigationState(action.route)!)).toBe(destination.id)
        }
      }
    }
  })

  it('selects any open panel and preserves its identity, route, filter and sizing', () => {
    const store = createStore()
    store.set(pushPanelAtom, { route: routes.view.notes('draft') })
    store.set(pushPanelAtom, { route: routes.view.automationsScheduled('job') })
    store.set(pushPanelAtom, { route: routes.view.allSessions('chat') })
    const panels = store.get(panelStackAtom)
    for (const panel of panels) {
      const action = resolveCompactWorkspaceSelection(panels, store.get(focusedPanelIdAtom), { kind: 'panel', panelId: panel.id })
      expect(action).toEqual({ kind: 'focus', panelId: panel.id })
      if (action?.kind === 'focus') store.set(focusedPanelIdAtom, action.panelId)
      expect(store.get(panelStackAtom)).toBe(panels)
    }
    expect(resolveCompactWorkspaceSelection(panels, null, { kind: 'panel', panelId: 'closed' })).toBeNull()
  })

  it('reuses an open service and browser before calling their normal opener', () => {
    const store = createStore()
    store.set(pushPanelAtom, { route: routes.view.browser('embedded') })
    store.set(pushPanelAtom, { route: routes.view.notes('draft') })
    store.set(pushPanelAtom, { route: routes.view.allSessions('chat') })
    const panels = store.get(panelStackAtom)
    expect(resolveCompactWorkspaceSelection(panels, panels[2].id, { kind: 'service', serviceId: 'browser' }))
      .toEqual({ kind: 'focus', panelId: panels[0].id })
    expect(resolveCompactWorkspaceSelection(panels, panels[2].id, { kind: 'service', serviceId: 'notes' }))
      .toEqual({ kind: 'focus', panelId: panels[1].id })
  })
})
