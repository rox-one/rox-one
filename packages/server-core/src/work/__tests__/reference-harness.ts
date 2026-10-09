/** W1-06 (#1503) — Executor harness for reference-handler contract tests. */

import { CATALOGUE_FLAGS, COMMAND_CATALOGUE, CommandRegistry, registerCommandCatalogue, type Authorizer, type CommandReceipt } from '@rox/core/commands'
import { CommandExecutor } from '../../commands/executor'
import { COMMAND_MODULES, boundCommandTypes, createWiredCommandRegistry } from '../../commands/registry'
import { REFERENCE_SPECS } from '../reference'
import type { CommandStore } from '../../commands/store'
import { ACTOR_ID, REFERENCE_SCENARIO, U, WORKSPACE_ID, type ScenarioStep } from './reference-scenario'

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

/**
 * W1-11 (#1508, merged as #1623) — the agent-governance module binds its own
 * handlers for these command types (`packages/server-core/src/agents/module.ts:54-69`)
 * and `COMMAND_MODULES` lists `AGENTS_COMMAND_MODULE` before
 * `REFERENCE_COMMAND_MODULE` (`packages/server-core/src/commands/registry.ts:58`),
 * so the reference module skips any type that already has a handler
 * (`packages/server-core/src/work/reference/module.ts`).
 *
 * Those handlers run on `getAgentsRuntime()` (`agents/runtime.ts`) — its own
 * identity / governance stores, never the reference memory backend — and answer
 * with a `{ workspaceId, … }` result that carries no `collection`. So their
 * scenario steps can never apply against this harness, and any step scoped to
 * the chat they build is orphaned with them. The list is asserted against the
 * live module in the suite, so a future ownership change fails loudly instead of
 * silently shrinking the scenario's coverage.
 *
 * The Postgres reference suite keeps the same list
 * (`apps/workspace-service/test/reference-handlers.pg.test.ts`, `W1_11_OWNED_TYPES`).
 */
export const W1_11_OWNED_TYPES: readonly string[] = [
  'workspaces.create',
  'people.invite',
  'identity.ensure_placeholder',
  'identity.activate_placeholder',
  'identity.merge_placeholder',
  'im.create_chat',
  'im.join_chat',
  'im.leave_chat',
  'im.set_visibility',
  'im.browse_public_chats',
  'agents.provision_personal_agent',
  'agents.invoke',
  'agents.decide_approval',
  'agents.pause',
]

/** The channel built by the W1-11-owned `im.create_chat`: the reference store never gains it. */
export const W1_11_OWNED_CHAT = U('chat')

/**
 * True for a scenario step the reference engine does not own today: W1-11 bound
 * the type itself, or the step is scoped to (or delivers into via `toChatId`)
 * the channel whose creation W1-11 owns. W1-14's `tasks.create_from_message` /
 * `calendar.create_event_from_message` name that same channel in their payload
 * instead — `origin.chatRef` holds `channel:<id>` — so a payload-level reference
 * counts too.
 */
export function isW1_11Shadow(step: ScenarioStep): boolean {
  if (W1_11_OWNED_TYPES.includes(step.type)) return true
  if (step.target?.kind === 'channel' && step.target.id === W1_11_OWNED_CHAT) return true
  if (step.payload.toChatId === W1_11_OWNED_CHAT) return true
  const refs = Object.values(step.payload ?? {}).map(value =>
    typeof value === 'string' ? value : (value as { chatRef?: string } | null)?.chatRef)
  return refs.some(ref => ref === `channel:${W1_11_OWNED_CHAT}`)
}

/** The reference-owned remainder of the scenario: the steps that must apply here. */
export const REFERENCE_OWNED_SCENARIO: readonly ScenarioStep[] = REFERENCE_SCENARIO.filter(step => !isW1_11Shadow(step))

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
