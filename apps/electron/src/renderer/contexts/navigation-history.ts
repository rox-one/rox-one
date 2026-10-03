interface SemanticHistoryKeyInput {
  workspaceSlug: string | null
  panelRoutes: string[]
  focusedPanelIndex: number
  sidebarParam: string
}

interface InitialRestoreGateInput {
  isReady: boolean
  isSessionsReady: boolean
  workspaceId: string | null
  initialRouteRestored: boolean
}

/**
 * Builds a semantic history key used to dedupe pushState entries.
 *
 * Includes focused panel index so states with duplicate routes remain distinct
 * when focus moves between panels.
 */
export function buildSemanticHistoryKey({
  workspaceSlug,
  panelRoutes,
  focusedPanelIndex,
  sidebarParam,
}: SemanticHistoryKeyInput): string {
  return JSON.stringify([
    workspaceSlug ?? '',
    panelRoutes,
    focusedPanelIndex,
    sidebarParam,
  ])
}

interface PanelHistoryEntry {
  route: string
  proportion: number
}

/** Structured addresses cannot collide with commas or numeric colon suffixes. */
export function serializePanelHistory(entries: readonly PanelHistoryEntry[]): string {
  return `json:${JSON.stringify(entries.map(({ route, proportion }) => ({ route, proportion })))}`
}

/** Read the structured format and retain existing comma/ratio deep links. */
export function parsePanelHistory(value: string): PanelHistoryEntry[] {
  if (value.startsWith('json:')) {
    try {
      const entries: unknown = JSON.parse(value.slice(5))
      if (!Array.isArray(entries) || !entries.every(entry => entry && typeof entry.route === 'string' && entry.route.length > 0)) return []
      return entries.map(entry => ({
        route: entry.route,
        proportion: typeof entry.proportion === 'number' && Number.isFinite(entry.proportion)
          && entry.proportion >= 0 && entry.proportion <= 1 ? entry.proportion : 0,
      }))
    } catch {
      return []
    }
  }
  return value.split(',').filter(Boolean).map(entry => {
    const colonIndex = entry.lastIndexOf(':')
    if (colonIndex > 0) {
      const text = entry.slice(colonIndex + 1)
      const proportion = /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(text) ? Number(text) : NaN
      if (Number.isFinite(proportion) && proportion >= 0 && proportion <= 1) {
        return { route: entry.slice(0, colonIndex), proportion }
      }
    }
    return { route: entry, proportion: 0 }
  })
}

/**
 * Returns whether initial route restoration is allowed to run.
 */
export function canRunInitialRestore({
  isReady,
  isSessionsReady,
  workspaceId,
  initialRouteRestored,
}: InitialRestoreGateInput): boolean {
  return isReady && isSessionsReady && !!workspaceId && !initialRouteRestored
}
