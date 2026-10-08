import type { WorkbenchChrome } from './workbench-chrome'

export interface WorkspaceSurfaceLayoutInput {
  isCompact: boolean
  panelCount: number
  catalogOnly?: boolean
  chrome: Pick<WorkbenchChrome, 'showSurfaceTabs' | 'showInspector'>
  browser?: {
    isWebUI: boolean
    visible: boolean
    chromeCollapsed: boolean
    section: string
  }
}

/** Layout availability is separate from stored feature preferences. */
export function resolveWorkspaceSurfaceLayout({ isCompact, panelCount, catalogOnly = false, chrome, browser }: WorkspaceSurfaceLayoutInput) {
  const showServiceRail = !isCompact
  const showTabs = !isCompact && (!catalogOnly || panelCount > 1) && (chrome.showSurfaceTabs || panelCount > 1)
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
