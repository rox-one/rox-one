import { createModeRegistry, type ModeRegistry } from '@craft-agent/core/platform'
import { CORE_MODES } from './modes-seed'

let registry: ModeRegistry | null = null

export function getModeRegistry(): ModeRegistry {
  if (!registry) {
    registry = createModeRegistry()
    for (const mode of CORE_MODES) {
      registry.register(mode.contribution)
    }
  }
  return registry
}

export function __resetModeRegistryForTests(): void {
  registry = null
}
