/**
 * SE fluid panel measure (#2054 primitives wired under Rox Engineering).
 *
 * PanelSlot applies `.rox-panel-gutter` / `.rox-panel-measure` only when the
 * active profile is super-engineering and the route is not owned by another
 * surface agent (Home / Tasks / Messenger / Calls). Tokens still come from
 * `@container/panel` tiers and the SE ultra-wide bands (#2199).
 */

/** Minimal nav shape — avoids importing the heavy shared NavigationState graph. */
export type SePanelMeasureNav = {
  navigator: string
  surface?: string
} | null | undefined

/** Owner-managed full-bleed surfaces — Design must not force measure here. */
const SE_PANEL_MEASURE_BLEED_SURFACES = new Set([
  'messenger',
  // Calls (Rox Calls) live under the calendar surface (meetings alias).
  'calendar',
  // Canvas is an owned full-bleed board — measure would clip the stage.
  'canvas',
])

export function sePanelMeasureBleed(navState: SePanelMeasureNav): boolean {
  if (!navState) return false
  if (navState.navigator === 'home' || navState.navigator === 'tasks') return true
  if (navState.navigator === 'surface' && navState.surface && SE_PANEL_MEASURE_BLEED_SURFACES.has(navState.surface)) {
    return true
  }
  return false
}

/** True when PanelSlot should attach the #2054 gutter/measure primitives. */
export function sePanelMeasureActive(
  seProfile: boolean,
  navState: SePanelMeasureNav,
  opts?: { tool?: boolean },
): boolean {
  if (!seProfile || opts?.tool) return false
  return !sePanelMeasureBleed(navState)
}
