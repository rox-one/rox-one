import { createModeRegistry, type Disposable, type ModeRegistry } from '@rox/core/platform'
import type { NavigationState } from '../../shared/types'
import { SEEDED_MODES, type SeededMode } from './modes-seed'

let registry: ModeRegistry | null = null
const activePredicates = new Map<string, SeededMode['isActive']>()

export function getModeRegistry(): ModeRegistry {
  if (!registry) {
    registry = createModeRegistry()
    // Unified modes (W1-07) carry `when: <flag>`; list() hides them until the
    // caller passes the enabled flags as context keys.
    for (const mode of SEEDED_MODES) {
      registry.register(mode.contribution)
      activePredicates.set(mode.contribution.id, mode.isActive)
    }
  }
  return registry
}

/**
 * Why a wave-2 mode registration is rejected, or null when it is valid.
 * Exported for tests and for packages that want to check before registering.
 */
export function seededModeProblem(mode: SeededMode): string | null {
  const { contribution } = mode
  if (!contribution.id || !/^[a-z][a-z0-9-]*$/.test(contribution.id)) return 'id must be a lowercase slug'
  if (!contribution.titleKey) return 'titleKey (an i18n key) is required'
  if (!contribution.icon) return 'icon (a Lucide icon name) is required'
  if (typeof contribution.rootRoute !== 'string' || contribution.rootRoute.trim() === '') {
    return 'rootRoute is required: a wave-2 mode must be navigable'
  }
  if (/^[a-z]+:\/\//i.test(contribution.rootRoute) || contribution.rootRoute.startsWith('/')) {
    return 'rootRoute must be an app route (e.g. "notes", "goals/goal/x"), not a URL or path'
  }
  if (!Number.isFinite(contribution.order)) return 'order must be a number'
  if (typeof mode.isActive !== 'function') return 'isActive(navState) is required'
  return null
}

/**
 * W1-07 (#1504): register a mode from a wave-2 package without touching shell
 * code. The pill, ⌘1…7 and tab titles re-render on registration.
 *
 * Requirements (validated, throws otherwise):
 * - `rootRoute`: an app route string that the route parser resolves while the
 *   mode's flag is on (an existing view, an entity route, or a unified surface
 *   root). `null` is reserved for the shell's legacy flagged modes.
 * - `when: '<its workbench flag id>'` (strongly recommended) so the mode stays
 *   absent from the pill, ⌘1…7 and every `list()` while the flag is off.
 * - `titleKey` (`workbench.mode.<id>` in all 12 locales), `icon` (Lucide
 *   name, resolved by the pill), `isActive(navState)`.
 */
export function registerSeededMode(mode: SeededMode): Disposable {
  const problem = seededModeProblem(mode)
  if (problem) throw new Error(`registerSeededMode(${mode.contribution.id || '?'}): ${problem}`)
  const handle = getModeRegistry().register(mode.contribution)
  activePredicates.set(mode.contribution.id, mode.isActive)
  return {
    dispose: () => {
      handle.dispose()
      if (activePredicates.get(mode.contribution.id) === mode.isActive) activePredicates.delete(mode.contribution.id)
    },
  }
}

/** True when `navState` belongs to mode `id` (its seeded `isActive`). */
export function isModeActive(id: string, navState: NavigationState): boolean {
  getModeRegistry()
  return activePredicates.get(id)?.(navState) ?? false
}

export function __resetModeRegistryForTests(): void {
  registry = null
  activePredicates.clear()
}
