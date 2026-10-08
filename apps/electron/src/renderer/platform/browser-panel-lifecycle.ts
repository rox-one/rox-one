import { routes, type ViewRoute } from '../../shared/routes'
import type {
  OpenOrFocusBrowserPanelInput,
  OpenOrFocusPanelRouteResult,
} from '@/atoms/panel-stack'
import { surfaceTabFromRoute } from './layout-snapshot'

export type OpenOrFocusBrowserPanelAction = (
  input: OpenOrFocusBrowserPanelInput
) => OpenOrFocusPanelRouteResult

export function browserInstanceIdFromRoute(route: ViewRoute | string): string | null {
  const surface = surfaceTabFromRoute(route)
  return surface?.kind === 'browser' ? surface.tabId : null
}

export function browserRouteForInstanceId(instanceId: string): ViewRoute {
  return routes.view.browser(instanceId)
}

/**
 * Open-or-focus semantics for retained embedded browser panels.
 *
 * The Jotai write atom remains the synchronization point. Calling through this
 * adapter avoids render-time panel-stack snapshots: two rapid resume actions
 * share the same store transaction path, so the second call sees the route
 * created by the first and focuses it instead of pushing a duplicate panel.
 */
export function openOrFocusEmbeddedBrowserPanel({
  instanceId,
  openOrFocusBrowserPanel,
}: {
  instanceId: string
  openOrFocusBrowserPanel: OpenOrFocusBrowserPanelAction
}): OpenOrFocusPanelRouteResult {
  return openOrFocusBrowserPanel({ instanceId })
}

/**
 * Explicit browser-panel close semantics.
 *
 * Route changes and React unmount only detach the native embedded views; user
 * close actions call this helper before removing the panel route so retained
 * embedded browsers do not become inaccessible.
 */
export function destroyBrowserInstanceForRoute(route: ViewRoute | string): string | null {
  const instanceId = browserInstanceIdFromRoute(route)
  if (!instanceId) return null

  const browserPaneApi = typeof window === 'undefined' ? undefined : window.electronAPI?.browserPane
  if (!browserPaneApi) {
    console.warn(`[browser-panel] browserPane API unavailable while closing ${instanceId}`)
    return instanceId
  }

  void browserPaneApi.destroy(instanceId).catch((error) => {
    console.warn(`[browser-panel] Failed to destroy browser panel ${instanceId}:`, error)
  })
  return instanceId
}
