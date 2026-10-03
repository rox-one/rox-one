import { atom } from 'jotai'
import { focusedPanelIdAtom, panelStackAtom, type PanelStackEntry } from '@/atoms/panel-stack'
import { resolveViewRoute } from '../../../shared/route-parser'
import { APP_NAV_DESTINATIONS_BY_ID, type AppNavDestinationId } from './nav-destinations'

/** Prefer the current panel when multiple panels of the same service are open. */
export function findServicePanel(
  panels: readonly PanelStackEntry[],
  focusedPanelId: string | null,
  serviceId: AppNavDestinationId,
): PanelStackEntry | undefined {
  const destination = APP_NAV_DESTINATIONS_BY_ID[serviceId]
  if (!destination) return undefined
  const matches = (panel: PanelStackEntry) => {
    return destination.isActive(resolveViewRoute(panel.route))
  }
  const focusedPanel = panels.find((panel) => panel.id === focusedPanelId)
  if (focusedPanel && matches(focusedPanel)) return focusedPanel
  return panels.find(matches)
}

/**
 * Focus only: panel routes, identities, proportions, drafts and mounted views
 * remain untouched. NavigationContext already synchronizes this atom to history.
 * False means the caller should open the service with its existing route/action.
 */
export const focusServicePanelAtom = atom(
  null,
  (get, set, serviceId: AppNavDestinationId): boolean => {
    const focusedId = get(focusedPanelIdAtom)
    const panel = findServicePanel(get(panelStackAtom), focusedId, serviceId)
    if (!panel) return false
    if (panel.id !== focusedId) set(focusedPanelIdAtom, panel.id)
    return true
  },
)
