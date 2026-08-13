/**
 * Mode ↔ navigator matching for the Activity Rail / Mode Bar.
 */

import {
  isKnowledgeNavigation,
  isSessionsNavigation,
  isSettingsNavigation,
  type NavigationState,
} from '../../shared/types'

export function coreModeIsActive(modeId: string, navState: NavigationState): boolean {
  switch (modeId) {
    case 'core.chat':
      return isSessionsNavigation(navState)
    case 'core.knowledge':
      return isKnowledgeNavigation(navState)
    case 'core.settings':
      return isSettingsNavigation(navState)
    default:
      return false
  }
}
