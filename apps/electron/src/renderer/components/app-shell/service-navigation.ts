import { atom } from 'jotai'
import {
  focusedPanelIdAtom,
  panelStackAtom,
  type PanelStackEntry,
} from '@/atoms/panel-stack'
import { parseRouteToNavigationState } from '../../../shared/route-parser'
import type { NavigationState } from '../../../shared/types'
import {
  APP_NAV_DESTINATIONS,
  APP_NAV_DESTINATIONS_BY_ID,
  type AppNavDestinationId,
} from './nav-destinations'

/** The focused route determines the sidebar context; unrelated routes get no agent filters. */
export function getActiveService(navState: NavigationState): AppNavDestinationId | null {
  return APP_NAV_DESTINATIONS.find((destination) => destination.isActive(navState))?.id ?? null
}

/** Only services with an actual AppShell navigator receive that column. */
export function serviceHasNavigator(navState: NavigationState): boolean {
  return ['sessions', 'sources', 'skills', 'automations', 'projects', 'memory', 'settings', 'knowledge']
    .includes(navState.navigator)
}

export interface ServiceSidebarItem {
  id: string
  type?: 'separator'
  expanded?: boolean
  items?: readonly ServiceSidebarItem[]
}

/** Keep the original item objects so actions, context menus and disclosure state survive. */
export function getServiceContextLinks<T extends ServiceSidebarItem>(
  links: readonly T[],
  serviceId: AppNavDestinationId | null,
): T[] {
  if (!serviceId) return []
  const allowed = new Set(APP_NAV_DESTINATIONS_BY_ID[serviceId].contextLinkIds)
  const seen = new Set<string>()
  return links.filter((link) => {
    if (link.type === 'separator' || !allowed.has(link.id) || seen.has(link.id)) return false
    seen.add(link.id)
    return true
  })
}

export interface SidebarKeyboardTarget {
  id: string
  element: HTMLElement
}

/**
 * The rendered buttons are the keyboard source of truth. This includes service
 * children without maintaining a second list of their actions in AppShell.
 */
export function getSidebarKeyboardTargets(
  mountedItems: ReadonlyMap<string, HTMLElement>,
): SidebarKeyboardTarget[] {
  return Array.from(mountedItems, ([id, element]) => ({ id, element }))
    .filter(({ element }) => element.isConnected &&
      !element.closest('[hidden], [inert], [aria-hidden="true"]') &&
      !element.hasAttribute('disabled') &&
      element.getAttribute('aria-disabled') !== 'true' &&
      element.getClientRects().length > 0)
    .sort((a, b) => {
      const position = a.element.compareDocumentPosition(b.element)
      // DOM's DOCUMENT_POSITION_FOLLOWING/PRECEDING bit values are stable.
      if (position & 4) return -1
      if (position & 2) return 1
      return 0
    })
}

/** Prefer the current panel when multiple panels of the same service are open. */
export function findServicePanel(
  panels: readonly PanelStackEntry[],
  focusedPanelId: string | null,
  serviceId: AppNavDestinationId,
): PanelStackEntry | undefined {
  const destination = APP_NAV_DESTINATIONS_BY_ID[serviceId]
  const matches = (panel: PanelStackEntry) => {
    const navState = parseRouteToNavigationState(panel.route)
    return navState !== null && destination.isActive(navState)
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
