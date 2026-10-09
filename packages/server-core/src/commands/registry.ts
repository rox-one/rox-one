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
import { AGENTS_COMMAND_MODULE } from '../agents/module.ts'
import { NOTIFY_COMMAND_MODULE } from './notify'
import { bindDomainSchemas, bindReferenceHandlers } from '../work/reference/module'
// W1-12 (#1509)
import { AUTOMATION_COMMAND_MODULE } from '../rules/command-module'
import { COLLAB_COMMAND_MODULE } from '../collab/module'
import { DRIVE_COMMAND_MODULE } from '../drive/module'
import { XSC_COMMAND_MODULE } from '../xsc/module'

/** One owner module's bindings (handlers + schemas) for its catalogue types. */
export interface CommandModule {
  /** Owner module name (diagnostics). */
  readonly name: string
  /** Bind this module's handlers / schemas. Must be idempotent. */
  bind(registry: CommandRegistry): void
}

/** The bus's own module: `system.ping`. */
export const SYSTEM_COMMAND_MODULE: CommandModule = Object.freeze({ name: 'system', bind: bindSystemPing })

/** W1-06 (#1503): `@rox/shared/domain` payload schemas for every catalogue command still on the placeholder. */
export const DOMAIN_SCHEMA_COMMAND_MODULE: CommandModule = Object.freeze({ name: 'domain-schemas', bind: bindDomainSchemas })

/**
 * W1-06 (#1503): CRUD-level reference handlers for every catalogue command
 * without a handler. Keep it LAST — a wave-2 module listed before it binds
 * its own handler and the reference handler for that type is skipped.
 */
export const REFERENCE_COMMAND_MODULE: CommandModule = Object.freeze({ name: 'reference-handlers', bind: bindReferenceHandlers })

/** Every module's bindings. Wave-2 modules register here, before the reference module (see the contract above). */
export const COMMAND_MODULES: readonly CommandModule[] = Object.freeze([
  SYSTEM_COMMAND_MODULE,
  // W1-06 (#1503)
  DOMAIN_SCHEMA_COMMAND_MODULE,
  // W1-12 (#1509) — the automation contract binds before the reference module,
  // so its daily-note / system-list / invite handlers win over the generic ones.
  AUTOMATION_COMMAND_MODULE,
  // W1-11 (#1508): identity lifecycle, team chats and agent governance.
  AGENTS_COMMAND_MODULE,
  // W1-14 (#1511) — own schemas, risk classes and handlers; must precede the
  // reference module, which skips types that already have a handler.
  COLLAB_COMMAND_MODULE,
  DRIVE_COMMAND_MODULE,
  XSC_COMMAND_MODULE,
  // W1-09 (#1506): notifications.* (binds only while a notify host is installed).
  NOTIFY_COMMAND_MODULE,
  REFERENCE_COMMAND_MODULE,
])

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
