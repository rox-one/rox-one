import type { PanelStackEntry } from '@/atoms/panel-stack'
import { findServicePanel } from './service-navigation'
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
  /** W1-07 (#1504): a registered mode (root route); an open panel on it is focused. */
  | { kind: 'mode'; route: string }

export type CompactWorkspaceAction =
  | { kind: 'focus'; panelId: string }
  | { kind: 'navigate'; route: ViewRoute }
  | { kind: 'open-browser' }

/** The focused route determines which service the compact menu highlights. */
export function getActiveService(navState: NavigationState): AppNavDestinationId | null {
  return APP_NAV_DESTINATIONS.find((destination) => destination.isActive(navState))?.id ?? null
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
  if (selection.kind === 'mode') {
    const focused = panels.find((panel) => panel.id === focusedPanelId)
    const open = focused?.route === selection.route ? focused : panels.find((panel) => panel.route === selection.route)
    return open ? { kind: 'focus', panelId: open.id } : { kind: 'navigate', route: selection.route as ViewRoute }
  }
  const panel = findServicePanel(panels, focusedPanelId, selection.serviceId)
  if (panel) return { kind: 'focus', panelId: panel.id }
  const destination = APP_NAV_DESTINATIONS_BY_ID[selection.serviceId]
  if (!destination) return null
  if ('action' in destination && destination.action === 'open-browser') return { kind: 'open-browser' }
  return destination.route ? { kind: 'navigate', route: destination.route() } : null
}
