import type { createStore } from 'jotai/vanilla'
import type { ViewRoute } from '../../shared/routes'
import {
  focusedPanelIdAtom, getPanelTypeFromRoute, openAuxiliaryPanelAtom, panelStackAtom, primaryPanelIdAtom,
  type AuxiliaryTool,
} from '@/atoms/panel-stack'
import { activeWorkspaceContextAtom } from '@/atoms/workspace-context'

type Store = ReturnType<typeof createStore>
export interface WorkspaceToolOpenIntent {
  workspaceId: string
  projectId?: string
  tool: AuxiliaryTool
  originPanelId: string
  originRoute: ViewRoute
  primaryPanelId: string
  primaryRoute: ViewRoute
  existingToolId?: string
}

/** Capture before awaiting creation. A response cannot redirect a later workspace or pane. */
export function captureWorkspaceToolOpen(store: Store, input: {
  workspaceId: string; tool: AuxiliaryTool; projectId?: string; originPanelId?: string
}): WorkspaceToolOpenIntent | null {
  if (store.get(activeWorkspaceContextAtom) !== input.workspaceId) return null
  const stack = store.get(panelStackAtom)
  const origin = stack.find(entry => entry.id === (input.originPanelId ?? store.get(focusedPanelIdAtom)))
  const primary = stack.find(entry => entry.id === store.get(primaryPanelIdAtom) && !entry.tool) ?? stack.find(entry => !entry.tool)
  if (!origin || !primary || store.get(focusedPanelIdAtom) !== origin.id) return null
  return { workspaceId: input.workspaceId, tool: input.tool, ...(input.projectId ? { projectId: input.projectId } : {}),
    originPanelId: origin.id, originRoute: origin.route, primaryPanelId: primary.id, primaryRoute: primary.route,
    existingToolId: stack.find(entry => entry.tool === input.tool)?.id }
}

/** Explicit utility links retarget that utility and preserve every primary panel identity. */
export function openWorkspaceTool(store: Store, intent: WorkspaceToolOpenIntent, route: ViewRoute): boolean {
  if (store.get(activeWorkspaceContextAtom) !== intent.workspaceId || store.get(focusedPanelIdAtom) !== intent.originPanelId) return false
  const stack = store.get(panelStackAtom)
  const origin = stack.find(entry => entry.id === intent.originPanelId)
  const primary = stack.find(entry => entry.id === intent.primaryPanelId && !entry.tool)
  if (!origin || origin.route !== intent.originRoute || !primary || primary.route !== intent.primaryRoute) return false
  if (intent.existingToolId && !stack.some(entry => entry.id === intent.existingToolId && entry.tool === intent.tool)) return false
  const context = { workspaceId: intent.workspaceId, projectId: intent.projectId, route: intent.primaryRoute }
  const existing = stack.find(entry => entry.tool === intent.tool)
  if (existing) {
    store.set(panelStackAtom, stack.map(entry => entry.id === existing.id ? { ...entry, route, panelType: getPanelTypeFromRoute(route), toolContext: context } : entry))
    store.set(focusedPanelIdAtom, existing.id)
  } else store.set(openAuxiliaryPanelAtom, { tool: intent.tool, route, context })
  return true
}
