import { describe, expect, it } from 'bun:test'
import { createStore } from 'jotai'
import { closePanelAtom, focusedPanelIdAtom, panelStackAtom, primaryPanelIdAtom, type PanelStackEntry } from '../../atoms/panel-stack'
import { activeWorkspaceContextAtom } from '../../atoms/workspace-context'
import { captureWorkspaceToolOpen, openWorkspaceTool } from '../open-workspace-tool'
import { routes } from '../../../shared/routes'

function setup(existingTool?: PanelStackEntry) {
  const store = createStore()
  const main: PanelStackEntry = { id: 'main', route: routes.view.pages(), proportion: 1, panelType: 'other', laneId: 'main' }
  store.set(panelStackAtom, existingTool ? [main, existingTool] : [main])
  store.set(primaryPanelIdAtom, main.id)
  store.set(focusedPanelIdAtom, main.id)
  store.set(activeWorkspaceContextAtom, 'workspace-a')
  return { store, main }
}

const existingAgent: PanelStackEntry = { id: 'agent', route: routes.view.allSessions('previous'), proportion: 0.5, panelType: 'session', laneId: 'main', tool: 'agent' }

describe('explicit workspace utility links', () => {
  it('opens an automation separately without replacing the Pages primary panel', () => {
    const { store, main } = setup()
    const intent = captureWorkspaceToolOpen(store, { workspaceId: 'workspace-a', projectId: 'project-a', tool: 'automations', originPanelId: main.id })!
    expect(openWorkspaceTool(store, intent, routes.view.automations({ automationId: 'rule-a' }))).toBe(true)
    const stack = store.get(panelStackAtom)
    expect(stack[0].id).toBe(main.id)
    expect(stack[0].route).toBe(main.route)
    expect(stack[1].tool).toBe('automations')
    expect(stack[1].toolContext).toEqual({ workspaceId: 'workspace-a', projectId: 'project-a', route: main.route })
    expect(store.get(primaryPanelIdAtom)).toBe(main.id)
    expect(store.get(focusedPanelIdAtom)).toBe(stack[1].id)
  })

  it('retargets an existing utility rather than duplicating it or redirecting the main', () => {
    const { store, main } = setup(existingAgent)
    const intent = captureWorkspaceToolOpen(store, { workspaceId: 'workspace-a', tool: 'agent' })!
    expect(openWorkspaceTool(store, intent, routes.view.allSessions('new-agent-dialogue'))).toBe(true)
    expect(store.get(panelStackAtom)).toHaveLength(2)
    expect(store.get(panelStackAtom)[0]).toBe(main)
    expect(store.get(panelStackAtom)[1].id).toBe(existingAgent.id)
    expect(store.get(panelStackAtom)[1].route).toBe(routes.view.allSessions('new-agent-dialogue'))
  })

  it('does not deliver a late creation into another workspace', () => {
    const { store, main } = setup()
    const intent = captureWorkspaceToolOpen(store, { workspaceId: 'workspace-a', tool: 'agent' })!
    store.set(activeWorkspaceContextAtom, 'workspace-b')
    expect(openWorkspaceTool(store, intent, routes.view.allSessions('late'))).toBe(false)
    expect(store.get(panelStackAtom)).toEqual([main])
  })

  it('does not steal focus after the user moves to another pane in the same workspace', () => {
    const { store, main } = setup(existingAgent)
    const intent = captureWorkspaceToolOpen(store, { workspaceId: 'workspace-a', tool: 'agent' })!
    store.set(focusedPanelIdAtom, existingAgent.id)
    expect(openWorkspaceTool(store, intent, routes.view.allSessions('late'))).toBe(false)
    expect(store.get(panelStackAtom)[0]).toBe(main)
    expect(store.get(panelStackAtom)[1].route).toBe(existingAgent.route)
  })

  it('does not resurrect an explicitly closed agent after a pending creation', () => {
    const { store } = setup(existingAgent)
    const intent = captureWorkspaceToolOpen(store, { workspaceId: 'workspace-a', tool: 'agent' })!
    store.set(closePanelAtom, existingAgent.id)
    expect(openWorkspaceTool(store, intent, routes.view.allSessions('late'))).toBe(false)
    expect(store.get(panelStackAtom)).toHaveLength(1)
  })

  it('keeps late responses out of a primary surface that changed after the click', () => {
    const { store, main } = setup()
    const intent = captureWorkspaceToolOpen(store, { workspaceId: 'workspace-a', tool: 'agent' })!
    store.set(panelStackAtom, [{ ...main, route: routes.view.inbox() }])
    expect(openWorkspaceTool(store, intent, routes.view.allSessions('late'))).toBe(false)
    expect(store.get(panelStackAtom)[0].route).toBe(routes.view.inbox())
  })
})
