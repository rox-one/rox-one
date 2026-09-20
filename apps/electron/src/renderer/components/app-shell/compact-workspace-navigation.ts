import type { PanelStackEntry } from '@/atoms/panel-stack'
import { parseRouteToNavigationState } from '../../../shared/route-parser'
import type { ViewRoute } from '../../../shared/routes'
import type { NavigationState } from '../../../shared/types'
import {
  APP_NAV_DESTINATIONS,
  APP_NAV_DESTINATIONS_BY_ID,
  type AppNavDestinationId,
} from './nav-destinations'

export type CompactWorkspaceSelection =
  | { kind: 'panel'; panelId: string }
  | { kind: 'service'; serviceId: AppNavDestinationId }

export type CompactWorkspaceAction =
  | { kind: 'focus'; panelId: string }
  | { kind: 'navigate'; route: ViewRoute }
  | { kind: 'open-browser' }

/** The focused route determines which service the compact menu highlights. */
export function getActiveService(navState: NavigationState): AppNavDestinationId | null {
  return APP_NAV_DESTINATIONS.find((destination) => destination.isActive(navState))?.id ?? null
}

/** Prefer the current panel when multiple panels of the same service are open. */
function findServicePanel(
  panels: readonly PanelStackEntry[],
  focusedPanelId: string | null,
  serviceId: AppNavDestinationId,
): PanelStackEntry | undefined {
  const destination = APP_NAV_DESTINATIONS_BY_ID[serviceId]
  if (!destination) return undefined
  const matches = (panel: PanelStackEntry) => {
    const navState = parseRouteToNavigationState(panel.route)
    return navState !== null && destination.isActive(navState)
  }
  const focusedPanel = panels.find((panel) => panel.id === focusedPanelId)
  if (focusedPanel && matches(focusedPanel)) return focusedPanel
  return panels.find(matches)
}

/** The compact menu uses exactly the same existing-panel preference as the rail. */
export function resolveCompactWorkspaceSelection(
  panels: readonly PanelStackEntry[],
  focusedPanelId: string | null,
  selection: CompactWorkspaceSelection,
): CompactWorkspaceAction | null {
  if (selection.kind === 'panel') {
    return panels.some((panel) => panel.id === selection.panelId)
      ? { kind: 'focus', panelId: selection.panelId }
      : null
  }
  const panel = findServicePanel(panels, focusedPanelId, selection.serviceId)
  if (panel) return { kind: 'focus', panelId: panel.id }
  const destination = APP_NAV_DESTINATIONS_BY_ID[selection.serviceId]
  if (!destination) return null
  if ('action' in destination && destination.action === 'open-browser') return { kind: 'open-browser' }
  return destination.route ? { kind: 'navigate', route: destination.route() } : null
}
