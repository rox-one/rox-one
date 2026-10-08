import { describe, test, expect } from 'bun:test'
import { createStore } from 'jotai'
import { closePanelAtom, focusedPanelIdAtom, openAuxiliaryPanelAtom, panelStackAtom, primaryPanelRouteAtom, primaryPanelIdAtom, updatePrimaryPanelRouteAtom, updatePanelRouteByIdAtom, reconcilePanelStackAtom } from '../panel-stack'
import { visibleWorkspacePanels } from '../../components/app-shell/auxiliary-layout'
import { encodeToolContexts, decodeToolContexts } from '../../components/app-shell/auxiliary-persistence'

function start() {
  const store = createStore()
  store.set(updatePrimaryPanelRouteAtom, 'inbox')
  return store
}
describe('retained workspace panels', () => {
  test('tool focus and late dialogue creation cannot replace the main surface', () => {
    const store = start(), mainId = store.get(primaryPanelIdAtom)!
    store.set(openAuxiliaryPanelAtom, { tool: 'agent', route: 'allSessions/session/one', context: { workspaceId: 'ws', projectId: 'p', route: 'inbox' } })
    const agentId = store.get(focusedPanelIdAtom)!
    store.set(updatePrimaryPanelRouteAtom, 'pages')
    store.set(updatePanelRouteByIdAtom, { id: agentId, route: 'allSessions/session/two' })
    expect(store.get(primaryPanelRouteAtom)).toBe('pages')
    expect(store.get(panelStackAtom).find(e => e.id === mainId)?.route).toBe('pages')
    store.set(closePanelAtom, agentId)
    expect(store.set(updatePanelRouteByIdAtom, { id: agentId, route: 'allSessions/session/late' })).toBe(false)
    expect(store.get(primaryPanelRouteAtom)).toBe('pages')
  })
  test('tools are singletons and closing tools retains the owning main entry', () => {
    const store = start(), mainId = store.get(primaryPanelIdAtom)!
    store.set(openAuxiliaryPanelAtom, { tool: 'memory', route: 'memory' })
    store.set(openAuxiliaryPanelAtom, { tool: 'memory', route: 'memory' })
    expect(store.get(panelStackAtom)).toHaveLength(2)
    store.set(closePanelAtom, store.get(focusedPanelIdAtom)!)
    expect(store.get(panelStackAtom)[0].id).toBe(mainId)
    expect(store.get(primaryPanelRouteAtom)).toBe('inbox')
  })
  test('closing the last main surface with tools keeps a primary inbox', () => {
    const store = start(), mainId = store.get(primaryPanelIdAtom)!
    store.set(updatePrimaryPanelRouteAtom, 'pages')
    store.set(openAuxiliaryPanelAtom, { tool: 'tasks', route: 'tasks' })
    store.set(closePanelAtom, mainId)
    expect(store.get(primaryPanelRouteAtom)).toBe('inbox')
    expect(store.get(panelStackAtom).some(e => e.tool === 'tasks')).toBe(true)
  })
  test('reload preserves context and matching React ownership with equal routes', () => {
    const store = start()
    store.set(updatePrimaryPanelRouteAtom, 'memory')
    store.set(openAuxiliaryPanelAtom, { tool: 'memory', route: 'memory', context: { workspaceId: 'ws', projectId: 'project', route: 'pages' } })
    const before = store.get(panelStackAtom)
    const contexts = decodeToolContexts(encodeToolContexts(before), 'ws')
    store.set(reconcilePanelStackAtom, { entries: before.map((e, i) => ({ route: e.route, tool: e.tool, toolContext: contexts[i], proportion: e.proportion })), focusedIndex: 1 })
    expect(store.get(panelStackAtom).map(e => e.id)).toEqual(before.map(e => e.id))
    expect(store.get(panelStackAtom)[1].toolContext?.projectId).toBe('project')
    expect(decodeToolContexts(encodeToolContexts(before), 'foreign')).toEqual([undefined, undefined])
    expect(decodeToolContexts('{broken', 'ws')).toEqual([])
  })
  test('wide, intermediate and narrow layouts show reachable panels without removing entries', () => {
    const store = start(), primary = store.get(primaryPanelIdAtom)
    store.set(openAuxiliaryPanelAtom, { tool: 'agent', route: 'allSessions/session/one' })
    store.set(openAuxiliaryPanelAtom, { tool: 'tasks', route: 'tasks' })
    store.set(openAuxiliaryPanelAtom, { tool: 'memory', route: 'memory' })
    const entries = store.get(panelStackAtom), focus = store.get(focusedPanelIdAtom)
    expect(visibleWorkspacePanels(entries, 390, focus, 'memory', primary)).toEqual([focus!])
    expect(visibleWorkspacePanels(entries, 1000, focus, 'memory', primary)).toEqual([primary!, focus!])
    expect(visibleWorkspacePanels(entries, 1400, focus, 'memory', primary)).toEqual([primary!, entries[1].id, focus!])
    expect(store.get(panelStackAtom)).toHaveLength(4)
  })
})
