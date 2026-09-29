/**
 * Extra workbench screens («Ещё» group in the ActivityRail): Досье, Радар,
 * Решения, Центр агентов, Фокус. They share ONE navigator (`screen`) so the
 * route parser / navigation-state plumbing is touched once, not per screen.
 *
 * Route format: `<screenId>` or `<screenId>/item/<itemId>`.
 * Add a screen = append its id here + register it in
 * `renderer/pages/extra-screens/registry.ts`.
 */
export const EXTRA_SCREEN_IDS = ['dossier', 'radar', 'decisions'] as const

export type ExtraScreenId = (typeof EXTRA_SCREEN_IDS)[number]

export type ExtraScreenRoute = ExtraScreenId | `${ExtraScreenId}/item/${string}`

export function isExtraScreenId(value: string | undefined | null): value is ExtraScreenId {
  return typeof value === 'string' && (EXTRA_SCREEN_IDS as readonly string[]).includes(value)
}

export function buildExtraScreenRoute(screen: ExtraScreenId, itemId?: string | null): ExtraScreenRoute {
  if (!itemId) return screen
  return `${screen}/item/${encodeURIComponent(itemId)}`
}

/** Parse path segments (already split on '/'). Returns null when not an extra screen. */
export function parseExtraScreenSegments(
  segments: readonly string[],
): { screen: ExtraScreenId; itemId: string | null } | null {
  const [first, kind, rawId] = segments
  if (!isExtraScreenId(first)) return null
  if (kind === 'item' && rawId) {
    let itemId = rawId
    try {
      itemId = decodeURIComponent(rawId)
    } catch {
      // keep raw segment
    }
    return { screen: first, itemId }
  }
  return { screen: first, itemId: null }
}
