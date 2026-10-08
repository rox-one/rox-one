/**
 * Key that resets a panel's StoplightProvider / RouteErrorBoundary whenever
 * the routed content changes (extracted from MainContentPanel unchanged).
 *
 * W1-07 (#1504): unified mode roots (`navigator: 'surface'`) all have
 * `details: null`, so the surface id is part of the key — a crash in one
 * `<surface>.page` must not stay on screen after switching to another. The
 * entry is appended only for surface routes, so every other key is
 * byte-identical to the baseline.
 */
import {
  isScreenNavigation,
  isSessionsNavigation,
  isSettingsNavigation,
  isSkillsNavigation,
  isSurfaceNavigation,
  type NavigationState,
} from '../../../shared/types'

export interface PanelRouteKeyContext {
  activeWorkspaceId: string | null | undefined
  unavailableWorkspaceSlug: string | null | undefined
  activeSessionWorkingDirectory: string | null | undefined
}

export function panelRouteKey(navState: NavigationState, context: PanelRouteKeyContext): string {
  const { activeWorkspaceId, unavailableWorkspaceSlug, activeSessionWorkingDirectory } = context
  return JSON.stringify([
    activeWorkspaceId,
    unavailableWorkspaceSlug,
    navState.navigator,
    isSessionsNavigation(navState) ? navState.viewMode : null,
    'details' in navState ? navState.details : null,
    isSettingsNavigation(navState) ? navState.subpage : null,
    isScreenNavigation(navState) ? navState.screen : null,
    navState.navigator === 'search' ? navState.query : null,
    navState.navigator === 'unavailable' ? [navState.route, navState.reason] : null,
    unavailableWorkspaceSlug,
    isSkillsNavigation(navState) ? activeSessionWorkingDirectory : null,
    ...(isSurfaceNavigation(navState) ? [navState.surface] : []),
  ])
}
