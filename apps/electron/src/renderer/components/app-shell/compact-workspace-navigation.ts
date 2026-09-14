import type { PanelStackEntry } from '@/atoms/panel-stack'
import type { ViewRoute } from '../../../shared/routes'
import { APP_NAV_DESTINATIONS_BY_ID, type AppNavDestinationId } from './nav-destinations'
import { findServicePanel } from './service-navigation'

export type CompactWorkspaceSelection =
  | { kind: 'panel'; panelId: string }
  | { kind: 'service'; serviceId: AppNavDestinationId }

export type CompactWorkspaceAction =
  | { kind: 'focus'; panelId: string }
  | { kind: 'navigate'; route: ViewRoute }
  | { kind: 'open-browser' }

/** The compact menu uses exactly the same existing-panel preference as the rail. */
export function resolveCompactWorkspaceSelection(
  panels: readonly PanelStackEntry[],
  focusedPanelId: string | null,
  selection: CompactWorkspaceSelection,
): CompactWorkspaceAction | null {
  if (selection.kind === 'panel') {
    return panels.some((panel) => panel.id === selection.panelId)
      ? { kind: 'focus', panelId: selection.panelId } : null
  }
  const panel = findServicePanel(panels, focusedPanelId, selection.serviceId)
  if (panel) return { kind: 'focus', panelId: panel.id }
  const destination = APP_NAV_DESTINATIONS_BY_ID[selection.serviceId]
  if (destination.action === 'open-browser') return { kind: 'open-browser' }
  return destination.route ? { kind: 'navigate', route: destination.route() } : null
}
