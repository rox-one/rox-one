/**
 * W1-03 (#1500) — The wired command registry: full catalogue + every module's
 * bindings, in exactly one place.
 *
 * CONTRACT (owner decision, #1507 review): handlers and payload schemas are
 * bound ONLY through `COMMAND_MODULES`. Every wave-2 module — W1-06 and later,
 * including the `bindSchema` work of #1503 / #1508 — adds one
 * `CommandModule` entry to that list (its `bind` calls `registry.bind` /
 * `registry.bindSchema` for its own command types) instead of binding on a
 * registry instance somewhere else. Both authorities build their registry
 * with `createWiredCommandRegistry()`: the local RPC registry
 * (`handlers/rpc/commands.ts`) and the workspace service
 * (`apps/workspace-service/src/modules/commands/service.ts`), so the two can
 * never bind different sets. A test asserts that they match.
 */

import { CommandRegistry, registerCommandCatalogue } from '@rox/core/commands'
import { bindSystemPing } from './ping'

/** One owner module's bindings (handlers + schemas) for its catalogue types. */
export interface CommandModule {
  /** Owner module name (diagnostics). */
  readonly name: string
  /** Bind this module's handlers / schemas. Must be idempotent. */
  bind(registry: CommandRegistry): void
}

/** The bus's own module: `system.ping`. */
export const SYSTEM_COMMAND_MODULE: CommandModule = Object.freeze({ name: 'system', bind: bindSystemPing })

/** Every module's bindings. Wave-2 modules register here (see the contract above). */
export const COMMAND_MODULES: readonly CommandModule[] = Object.freeze([SYSTEM_COMMAND_MODULE])

export interface WiredCommandRegistryOptions {
  isFlagEnabled?: (flag: string) => boolean
}

/** The catalogue with every `COMMAND_MODULES` binding applied. */
export function createWiredCommandRegistry(options: WiredCommandRegistryOptions = {}): CommandRegistry {
  const registry = new CommandRegistry(options.isFlagEnabled ? { isFlagEnabled: options.isFlagEnabled } : {})
  registerCommandCatalogue(registry)
  for (const module of COMMAND_MODULES) module.bind(registry)
  return registry
}

/** Bound command types of a registry (handler present), sorted — for wiring checks. */
export function boundCommandTypes(registry: CommandRegistry): string[] {
  return registry.list().filter(definition => registry.handler(definition.type) !== undefined).map(definition => definition.type).sort()
}

/** @deprecated Same as `createWiredCommandRegistry` (kept for existing callers and tests). */
export const createCommandRegistry = createWiredCommandRegistry
