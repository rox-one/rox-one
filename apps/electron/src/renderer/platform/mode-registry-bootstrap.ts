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
 * W1-07 (#1504): register a mode from a wave-2 package without touching shell
 * code. Give the contribution `when: '<its workbench flag id>'` so it stays
 * absent from the pill, ⌘1…7 and every `list()` while the flag is off.
 */
export function registerSeededMode(mode: SeededMode): Disposable {
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
