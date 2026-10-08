/**
 * W1-03 (#1500) — Registry factory: full catalogue + the bus's own bindings.
 * Module packages (W1-06+) bind their handlers on the returned registry.
 */

import { CommandRegistry, registerCommandCatalogue } from '@rox/core/commands'
import { bindSystemPing } from './ping'

export function createCommandRegistry(options: { isFlagEnabled?: (flag: string) => boolean } = {}): CommandRegistry {
  const registry = new CommandRegistry(options.isFlagEnabled ? { isFlagEnabled: options.isFlagEnabled } : {})
  registerCommandCatalogue(registry)
  bindSystemPing(registry)
  return registry
}
