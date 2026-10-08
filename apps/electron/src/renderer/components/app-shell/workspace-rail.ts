export const COMPACT_VIEWPORT_WIDTH = 768
export const WORKSPACE_SELECTOR_RAIL_CHANGED_EVENT =
  'craft-workspace-selector-rail-changed'

export function shouldShowWorkspaceIconRail(
  workspaceSelectorRailEnabled: boolean,
  viewportWidth: number,
  /** When ActivityRail / unified shell owns the left edge, hide Discord-style workspace icons. */
  unifiedShellChromeActive = false,
): boolean {
  if (unifiedShellChromeActive) return false
  return (
    workspaceSelectorRailEnabled && viewportWidth >= COMPACT_VIEWPORT_WIDTH
  )
}