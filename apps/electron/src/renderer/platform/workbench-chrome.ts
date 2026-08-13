/**
 * Renderer chrome gates for Workbench v2 (ADR-0001).
 *
 * Core `resolveEnabledFlags` enforces flag dependencies for the workbench.*
 * set. The renderer also treats Mode Bar as on when *either* mode-registry
 * or top-chrome is requested, so a lone top-chrome toggle still shows it.
 */

export interface WorkbenchChromeInput {
  unifiedShell: boolean
  modeRegistry: boolean
  topChrome: boolean
  tabGroups: boolean
  browserSurface: boolean
  statusBar: boolean
}

export interface WorkbenchChrome {
  showRail: boolean
  showSurfaceTabs: boolean
  showInspector: boolean
  showModeBar: boolean
  hideBrowserTabStrip: boolean
  showStatusBar: boolean
  utilityRail: boolean
}

export function resolveWorkbenchChrome(input: WorkbenchChromeInput): WorkbenchChrome {
  return {
    showRail: input.unifiedShell || input.topChrome,
    showSurfaceTabs: input.unifiedShell || input.tabGroups || input.browserSurface,
    showInspector: input.unifiedShell,
    showModeBar: input.modeRegistry || input.topChrome,
    hideBrowserTabStrip: input.browserSurface,
    showStatusBar: input.statusBar,
    utilityRail: input.topChrome,
  }
}
