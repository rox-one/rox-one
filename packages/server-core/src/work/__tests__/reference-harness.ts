/** W1-06 (#1503) — Executor harness for reference-handler contract tests. */

import { CATALOGUE_FLAGS, COMMAND_CATALOGUE, CommandRegistry, registerCommandCatalogue, type Authorizer, type CommandReceipt } from '@rox/core/commands'
import { CommandExecutor } from '../../commands/executor'
import { COMMAND_MODULES, boundCommandTypes, createWiredCommandRegistry } from '../../commands/registry'
import { REFERENCE_SPECS } from '../reference'
import type { CommandStore } from '../../commands/store'
import { ACTOR_ID, WORKSPACE_ID, type ScenarioStep } from './reference-scenario'

export const ALL_FLAGS: ReadonlySet<string> = new Set(Object.values(CATALOGUE_FLAGS))
export const ALLOW_ALL: Authorizer = { can: async () => true }
export const DENY_ALL: Authorizer = { can: async () => false }
export const CATALOGUE_TYPES: string[] = COMMAND_CATALOGUE.map(definition => definition.type).filter(type => !type.startsWith('system.')).sort()

/** Types bound by the modules listed before `reference-handlers` in `COMMAND_MODULES`. */
export const OWNER_BOUND_TYPES: ReadonlySet<string> = (() => {
  const modules = COMMAND_MODULES.slice(0, COMMAND_MODULES.findIndex(module => module.name === 'reference-handlers'))
  const registry = new CommandRegistry()
  registerCommandCatalogue(registry)
  for (const module of modules) module.bind(registry)
  return new Set(boundCommandTypes(registry).filter(type => !type.startsWith('system.')))
})()

/**
 * Catalogue commands the reference layer serves (they have a reference spec and
 * a scenario step). Owner modules bind **before** the reference module, so a
 * command can be owner-bound (W1-12's `automation` module also overrides the
 * daily-note pair) — those run their owner's handler, and the scenario covers
 * them all the same.
 */
export const REFERENCE_TYPES = CATALOGUE_TYPES.filter(type => type in REFERENCE_SPECS)

export interface Harness {
  registry: CommandRegistry
  run(step: ScenarioStep, extra?: Record<string, unknown>): Promise<CommandReceipt>
}

let counter = 0

export function createHarness(options: {
  local: CommandStore
  workspace?: CommandStore
  flags?: ReadonlySet<string>
  authorizer?: Authorizer
  workspaceId?: string
  /** Unexpected handler / store errors (the receipt only says INTERNAL). */
  onError?: (error: unknown, type: string) => void
}): Harness {
  const flags = options.flags ?? ALL_FLAGS
  const registry = createWiredCommandRegistry({ isFlagEnabled: flag => flags.has(flag) })
  const authorizer = options.authorizer ?? ALLOW_ALL
  const hooks = options.onError
    ? { onHandlerError: (error: unknown, envelope: { type: string }) => options.onError!(error, envelope.type), onStoreError: (error: unknown, envelope: { type: string }) => options.onError!(error, envelope.type) }
    : {}
  const local = new CommandExecutor({ registry, store: options.local, authority: 'local', authorizer, ...hooks })
  const workspace = options.workspace ? new CommandExecutor({ registry, store: options.workspace, authority: 'workspace', authorizer, ...hooks }) : null
  const workspaceId = options.workspaceId ?? WORKSPACE_ID
  return {
    registry,
    async run(step, extra = {}) {
      const definition = registry.get(step.type)
      const executor = definition?.authority === 'local' || !workspace ? local : workspace
      counter += 1
      return executor.execute({
        workspaceId,
        actor: { principalId: step.actor ?? ACTOR_ID, kind: 'user' },
        envelope: {
          commandId: `cmd-${counter}-${step.type}`,
          type: step.type,
          payload: step.payload,
          issuedAt: '2026-10-08T12:00:00.000Z',
          ...(step.target ? { target: step.target } : {}),
          ...extra,
        },
      })
    },
  }
}
