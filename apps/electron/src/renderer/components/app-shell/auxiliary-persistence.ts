import type { PanelStackEntry, ToolContextReference } from '@/atoms/panel-stack'
import { parseRouteToNavigationState } from '../../../shared/route-parser'

export function encodeToolContexts(panels: readonly PanelStackEntry[]): string {
  return JSON.stringify(panels.map(panel => panel.tool ? panel.toolContext ?? null : null))
}

/** URLs restore display context only. Every write is still checked by the host. */
export function decodeToolContexts(value: string | null, workspaceId: string): Array<ToolContextReference | undefined> {
  try {
    const parsed: unknown = JSON.parse(value ?? '[]')
    if (!Array.isArray(parsed) || parsed.length > 32) return []
    return parsed.map(item => {
      if (!item || typeof item !== 'object' || item.workspaceId !== workspaceId
        || typeof item.route !== 'string' || !parseRouteToNavigationState(item.route)
        || (item.projectId !== undefined && typeof item.projectId !== 'string')) return undefined
      return { workspaceId, route: item.route, ...(item.projectId ? { projectId: item.projectId } : {}) } as ToolContextReference
    })
  } catch { return [] }
}
