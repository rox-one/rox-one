import type { WorkbenchChrome } from './workbench-chrome'

export interface WorkspaceSurfaceLayoutInput {
  isCompact: boolean
  panelCount: number
  chrome: Pick<WorkbenchChrome, 'showSurfaceTabs' | 'showInspector'>
  browser?: {
    isWebUI: boolean
    visible: boolean
    chromeCollapsed: boolean
    section: string
  }
}

/** Layout availability is separate from stored feature preferences. */
export function resolveWorkspaceSurfaceLayout({ isCompact, panelCount, chrome, browser }: WorkspaceSurfaceLayoutInput) {
  const showServiceRail = !isCompact
  const showTabs = !isCompact && (chrome.showSurfaceTabs || panelCount > 1)
  const browserRequested = browser !== undefined && !browser.isWebUI && browser.visible &&
    !browser.chromeCollapsed && browser.section === 'browser'
  const showInspector = chrome.showInspector || browserRequested
  return {
    showServiceRail,
    showTabs,
    showInspector,
    showAuxiliaryPanels: showServiceRail || showTabs || showInspector,
  }
}
