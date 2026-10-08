import { expect, test } from 'bun:test'
import { createStore } from 'jotai'
import { NAVIGATE_EVENT, routes, subscribeNavigateEvents } from '../navigate'
import { panelStackAtom, focusedPanelIdAtom, openAuxiliaryPanelAtom, primaryPanelRouteAtom, updatePrimaryPanelRouteAtom, updateFocusedPanelRouteAtom } from '../../atoms/panel-stack'

test('surface navigation through the real event receiver retains a focused agent and its context', () => {
  const store = createStore(), events = new EventTarget()
  store.set(updatePrimaryPanelRouteAtom, routes.view.meetings())
  store.set(openAuxiliaryPanelAtom, { tool: 'agent', route: routes.view.allSessions('dialogue'), context: { workspaceId: 'workspace', projectId: 'project', route: routes.view.meetings() } })
  const agent = store.get(panelStackAtom).find(entry => entry.tool === 'agent')!
  const stop = subscribeNavigateEvents((route, options) => {
    store.set(options?.primary ? updatePrimaryPanelRouteAtom : updateFocusedPanelRouteAtom, route as typeof agent.route)
  }, events)
  events.dispatchEvent(new CustomEvent(NAVIGATE_EVENT, { detail: { route: routes.view.feed(), primary: true, skipAutoSelect: true } }))
  expect(store.get(primaryPanelRouteAtom)).toBe(routes.view.feed())
  expect(store.get(panelStackAtom).find(entry => entry.tool === 'agent')).toEqual(agent)
  expect(store.get(panelStackAtom).find(entry => entry.id === store.get(focusedPanelIdAtom))?.tool).toBeUndefined()
  stop()
  events.dispatchEvent(new CustomEvent(NAVIGATE_EVENT, { detail: { route: routes.view.inbox(), primary: true } }))
  expect(store.get(primaryPanelRouteAtom)).toBe(routes.view.feed())
})

test('new-panel and auto-selection options survive the same receiver', () => {
  const events = new EventTarget(), seen: unknown[] = []
  const stop = subscribeNavigateEvents((route, options) => { seen.push({ route, ...options }) }, events)
  const detail = { route: routes.view.inbox(), newPanel: true, targetLaneId: 'main', skipAutoSelect: true }
  events.dispatchEvent(new CustomEvent(NAVIGATE_EVENT, { detail }))
  expect(seen).toEqual([detail])
  stop()
})
