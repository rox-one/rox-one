/**
 * Navigation helpers
 *
 * Small pure helpers over `NavigationState`. Keep these stateless and free of
 * React/Jotai imports — they're consumed both inside hooks (PanelStackContainer)
 * and in synchronous callbacks (CompactBackButton).
 */

import type { NavigationState } from '../../shared/types'

/** A single session catalog is the workspace until an actual session is opened. */
export function sessionCatalogOwnsWorkspace(
  nav: NavigationState | null,
  options: { panelCount: number; isCompact: boolean; navigatorHidden: boolean },
): boolean {
  return !options.isCompact && !options.navigatorHidden && options.panelCount <= 1
    && nav?.navigator === 'sessions' && !nav.details
    && (!nav.viewMode || nav.viewMode === 'list')
}

/**
 * Returns true when the focused panel's nav state is in "detail" mode —
 * i.e. the user has drilled past the navigator into a specific item.
 *
 * Used by compact-mode logic to flip the layout from navigator-only to
 * content-only with a back-button overlay.
 *
 * Per-navigator semantics:
 * - sessions: a session is selected
 * - settings: Overview (bare `settings`) and every subpage are detail surfaces
 *   so compact mode shows Overview after navigating to Settings
 * - sources / skills / automations / projects / browser: a detail item is selected
 * - pages: always — both the library grid and a page render in the content
 *   panel (pages has no navigator list to fall back to)
 */
export function isDetailNavState(navState: NavigationState | null): boolean {
  if (!navState) return false
  switch (navState.navigator) {
    case 'sessions':
      return navState.details !== null
    case 'settings':
    case 'unavailable':
      return true
    case 'sources':
    case 'skills':
    case 'automations':
    case 'projects':
    case 'browser':
    case 'notes':
      return navState.details !== null
    case 'pages':
      // A failed address owns a content surface, including compact mode.
      return true
    case 'memory':
    case 'learning':
    case 'connections':
    case 'search':
      return false
    case 'inbox':
    case 'feed':
    case 'tasks':
    case 'meetings':
      return navState.details !== null
    case 'home':
      return true
    case 'surface':
      // Unified mode roots (W1-07) own the content panel like Home.
      return true
    case 'screen':
      // Extra screens render their own list + detail in the content panel
      return true
    case 'knowledge':
    case 'cloud-run':
    case 'extension':
    case 'diff':
    case 'terminal':
      return navState.details !== null
    case 'entity':
      // Entity routes always address a detail surface.
      return true
    default: {
      const _exhaustive: never = navState
      return false
    }
  }
}
