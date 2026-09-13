/**
 * Zen Shell top-bar safe area (ZS-03).
 *
 * Native traffic lights stay system-drawn. Web UI and non-mac never reserve
 * stoplight space. Fullscreen drops the inset. Zoom 100/125/150 scales the
 * desktop inset so controls do not sit under the cluster.
 */

export const ZEN_TOPBAR_WEB_INSET = 8
export const ZEN_TOPBAR_FULLSCREEN_INSET = 8
export const ZEN_TRAFFIC_LIGHT_INSET_100 = 82

export interface ZenTopBarSafeAreaInput {
  isMac: boolean
  isWebUI: boolean
  zoomPercent: number
  isFullScreen: boolean
}

export function zenTopBarSafeLeftPx(input: ZenTopBarSafeAreaInput): number {
  if (!input.isMac || input.isWebUI) return ZEN_TOPBAR_WEB_INSET
  if (input.isFullScreen) return ZEN_TOPBAR_FULLSCREEN_INSET
  const zoom = Number.isFinite(input.zoomPercent) ? input.zoomPercent : 100
  return Math.round(ZEN_TRAFFIC_LIGHT_INSET_100 * (zoom / 100))
}
