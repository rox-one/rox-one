import { describe, expect, it } from 'bun:test'
import { createStore } from 'jotai'
import {
  focusedPanelIdAtom,
  panelStackAtom,
  pushPanelAtom,
} from '../../../atoms/panel-stack'
import { parseRouteToNavigationState } from '../../../../shared/route-parser'
import { routes } from '../../../../shared/routes'
import { APP_NAV_DESTINATIONS } from '../nav-destinations'
import {
  focusServicePanelAtom,
  getActiveService,
  getServiceContextLinks,
  getSidebarKeyboardTargets,
  serviceHasNavigator,
} from '../service-navigation'

describe('service panel activation', () => {
  it('focuses an open note without changing routes, geometry or panel identities', () => {
    const store = createStore()
    store.set(pushPanelAtom, { route: routes.view.notes('draft-note') })
    store.set(pushPanelAtom, { route: routes.view.allSessions('running-agent') })
    const panels = store.get(panelStackAtom)
    const notePanel = panels[0]

    expect(store.set(focusServicePanelAtom, 'notes')).toBe(true)
    expect(store.get(focusedPanelIdAtom)).toBe(notePanel.id)
    expect(store.get(panelStackAtom)).toBe(panels)
    expect(store.get(panelStackAtom)[0]).toBe(notePanel)
    expect(store.get(panelStackAtom)[1].route).toBe(routes.view.allSessions('running-agent'))
  })

  it('keeps the focused agent when multiple agents are open', () => {
    const store = createStore()
    store.set(pushPanelAtom, { route: routes.view.allSessions('first') })
    store.set(pushPanelAtom, { route: routes.view.flagged('second') })
    const focusedId = store.get(focusedPanelIdAtom)
    const panels = store.get(panelStackAtom)

    expect(store.set(focusServicePanelAtom, 'sessions')).toBe(true)
    expect(store.get(focusedPanelIdAtom)).toBe(focusedId)
    expect(store.get(panelStackAtom)).toBe(panels)
  })

  it('recognizes a filtered service detail and preserves that filter', () => {
    const store = createStore()
    store.set(pushPanelAtom, { route: routes.view.automationsScheduled('morning-review') })
    store.set(pushPanelAtom, { route: routes.view.notes() })
    const panels = store.get(panelStackAtom)

    expect(store.set(focusServicePanelAtom, 'automations')).toBe(true)
    expect(store.get(focusedPanelIdAtom)).toBe(panels[0].id)
    expect(store.get(panelStackAtom)).toBe(panels)
    expect(store.get(panelStackAtom)[0].route).toBe(routes.view.automationsScheduled('morning-review'))
  })

  it('leaves the stack unchanged when a service needs its normal opener', () => {
    const store = createStore()
    store.set(pushPanelAtom, { route: routes.view.allSessions('agent') })
    const panels = store.get(panelStackAtom)
    const focusedId = store.get(focusedPanelIdAtom)

    expect(store.set(focusServicePanelAtom, 'browser')).toBe(false)
    expect(store.get(panelStackAtom)).toBe(panels)
    expect(store.get(focusedPanelIdAtom)).toBe(focusedId)
  })

  it('focuses an existing embedded browser instead of creating another instance', () => {
    const store = createStore()
    store.set(pushPanelAtom, { route: routes.view.browser('existing-instance') })
    store.set(pushPanelAtom, { route: routes.view.notes('working-note') })
    const panels = store.get(panelStackAtom)

    expect(store.set(focusServicePanelAtom, 'browser')).toBe(true)
    expect(store.get(focusedPanelIdAtom)).toBe(panels[0].id)
    expect(store.get(panelStackAtom)).toBe(panels)
  })
})

describe('service reachability', () => {
  it('keeps the five primary services stable and settings separate', () => {
    expect(APP_NAV_DESTINATIONS.filter((destination) => destination.railGroup === 'primary').map((destination) => destination.id))
      .toEqual(['sessions', 'notes', 'memory', 'browser', 'automations'])
    expect(APP_NAV_DESTINATIONS.filter((destination) => destination.railGroup === 'footer').map((destination) => destination.id))
      .toEqual(['settings'])
  })

  it('gives every route destination a valid route back to the same service', () => {
    const ids = new Set<string>()
    for (const destination of APP_NAV_DESTINATIONS) {
      expect(ids.has(destination.id)).toBe(false)
      ids.add(destination.id)
      if (destination.action) {
        expect(destination.action).toBe('open-browser')
        continue
      }
      expect(destination.route).not.toBeNull()
      const state = parseRouteToNavigationState(destination.route!())
      expect(state).not.toBeNull()
      expect(getActiveService(state!)).toBe(destination.id)
    }
    expect(ids.has('meetings')).toBe(true)
    expect(ids.has('connections')).toBe(true)
    expect(ids.has('home')).toBe(true)
    expect(ids.has('knowledge')).toBe(true)
  })

  it('keeps local Notes distinct from Knowledge and its review surface', () => {
    expect(getActiveService(parseRouteToNavigationState(routes.view.notes('local'))!)).toBe('notes')
    expect(getActiveService(parseRouteToNavigationState(routes.view.siyuan({ kind: 'document', id: 'remote' }))!)).toBe('knowledge')
    expect(getActiveService(parseRouteToNavigationState(routes.view.proposal('review'))!)).toBe('knowledge')
    expect(getActiveService(parseRouteToNavigationState(routes.view.terminal('shell'))!)).toBeNull()
  })
})

describe('context sidebar and keyboard order', () => {
  interface SidebarFixture {
    id: string
    onClick?: () => void
    expanded?: boolean
    items?: SidebarFixture[]
  }
  const onClick = () => undefined
  const notes = { id: 'nav:notes', onClick }
  const pages = { id: 'nav:pages', onClick }
  const links: SidebarFixture[] = [
    { id: 'nav:allSessions', expanded: false, items: [{ id: 'nav:flagged', onClick }] },
    { id: 'nav:labels', expanded: true, items: [{ id: 'nav:label:work', onClick }] },
    { id: 'nav:views', onClick },
    { id: 'nav:skills', onClick },
    notes,
    { id: 'nav:memory', onClick },
    pages,
    { id: 'nav:pages', onClick: () => undefined },
  ]

  it('limits Notes and Memory to their own controls and leaves actions intact', () => {
    expect(getServiceContextLinks(links, 'notes')).toEqual([notes])
    expect(getServiceContextLinks(links, 'notes')[0]).toBe(notes)
    expect(getServiceContextLinks(links, 'memory').map((item) => item.id)).toEqual(['nav:memory'])
    expect(getServiceContextLinks(links, null)).toEqual([])
  })

  it('retains agent filters and skills only in the agent context', () => {
    const context = getServiceContextLinks(links, 'sessions')
    expect(context.map((item) => item.id)).toEqual(['nav:allSessions', 'nav:labels', 'nav:views', 'nav:skills'])
    expect(context[1].items?.[0].onClick).toBe(onClick)
  })

  it('deduplicates repeated service sections without replacing their objects', () => {
    expect(getServiceContextLinks(links, 'pages')).toEqual([pages])
    expect(getServiceContextLinks(links, 'pages')[0]).toBe(pages)
  })

  it('uses visible DOM order for service children absent from the former action list', () => {
    let activated = false
    const button = (order: number, options: { hidden?: boolean; disconnected?: boolean; noBounds?: boolean } = {}) => ({
      order,
      isConnected: !options.disconnected,
      closest: () => options.hidden ? {} : null,
      hasAttribute: () => false,
      getAttribute: () => null,
      getClientRects: () => options.noBounds ? [] : [{}],
      compareDocumentPosition: (other: { order: number }) => order < other.order ? 4 : 2,
      click: () => { activated = true },
    }) as unknown as HTMLElement
    const parent = button(0)
    const api = button(1)
    const mcp = button(2)
    const refs = new Map([
      ['nav:sources:mcp', mcp],
      ['nav:hidden', button(3, { hidden: true })],
      ['nav:sources', parent],
      ['nav:removed', button(4, { disconnected: true })],
      ['nav:sources:api', api],
      ['nav:collapsed', button(5, { noBounds: true })],
    ])
    const targets = getSidebarKeyboardTargets(refs)
    expect(targets.map((item) => item.id)).toEqual(['nav:sources', 'nav:sources:api', 'nav:sources:mcp'])
    expect(targets[1].element).toBe(api)
    targets[1].element.click()
    expect(activated).toBe(true)
  })

  it('allocates a navigator only for services that render one', () => {
    for (const route of [routes.view.allSessions(), routes.view.sources(), routes.view.skills(), routes.view.automations(), routes.view.projects(), routes.view.memory(), routes.view.settings(), routes.view.knowledge()]) {
      expect(serviceHasNavigator(parseRouteToNavigationState(route)!)).toBe(true)
    }
    for (const route of [routes.view.notes(), routes.view.browser('browser'), routes.view.tasks(), routes.view.meetings(), routes.view.connections(), routes.view.pages(), routes.view.home(), routes.view.terminal('shell'), routes.view.cloudRun('run'), routes.view.extension('extension', 'view'), routes.view.proposal('diff')]) {
      expect(serviceHasNavigator(parseRouteToNavigationState(route)!)).toBe(false)
    }
  })
})
