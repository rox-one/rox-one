/**
 * Core mode registry bootstrap — singleton, same discipline as omnibox.
 */

import {
  createCoreModeContributions,
  createModeRegistry,
  type ModeRegistry,
} from '@craft-agent/core/platform'
import { routes } from '../../shared/routes'

let registry: ModeRegistry | null = null

export function getWorkbenchModeRegistry(): ModeRegistry {
  if (!registry) {
    registry = createModeRegistry(
      createCoreModeContributions({
        chat: routes.view.allSessions(),
        knowledge: routes.view.knowledge(),
        settings: routes.view.settings(),
      }),
    )
  }
  return registry
}
