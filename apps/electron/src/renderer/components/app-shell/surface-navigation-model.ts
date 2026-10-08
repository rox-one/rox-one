/** Stable positions shared by the desktop and compact application rail. */
export const PRIMARY_SURFACE_IDS = ['inbox', 'feed', 'plan', 'projects', 'pages', 'dialogues', 'agents'] as const
export type PrimarySurfaceId = typeof PRIMARY_SURFACE_IDS[number]

export const WORKSPACE_TOOL_IDS = ['tasks', 'automations', 'memory', 'agent'] as const
export type WorkspaceToolId = typeof WORKSPACE_TOOL_IDS[number]

export const SURFACE_RAIL_CONTROL_IDS = [...PRIMARY_SURFACE_IDS, ...WORKSPACE_TOOL_IDS, 'settings'] as const
export type SurfaceRailControlId = typeof SURFACE_RAIL_CONTROL_IDS[number]

/** Move focus without changing the surface or opening a tool. Tab remains native. */
export function resolveRailFocusTarget(
  visibleControls: readonly SurfaceRailControlId[],
  current: SurfaceRailControlId | null,
  key: string,
): SurfaceRailControlId | null {
  if (visibleControls.length === 0) return null
  if (key === 'Home') return visibleControls[0]
  if (key === 'End') return visibleControls[visibleControls.length - 1]
  if (key !== 'ArrowDown' && key !== 'ArrowUp') return null
  const index = current === null ? -1 : visibleControls.indexOf(current)
  if (index === -1) return key === 'ArrowDown' ? visibleControls[0] : visibleControls[visibleControls.length - 1]
  const direction = key === 'ArrowDown' ? 1 : -1
  return visibleControls[(index + direction + visibleControls.length) % visibleControls.length]
}
