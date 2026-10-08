/**
 * W1-11 (#1508) — The agent-governance command module: one `CommandModule`
 * entry that binds this package's payload schemas and reference handlers.
 *
 * Bound exactly as `packages/server-core/src/commands/registry.ts` prescribes:
 * both authorities build their registry with `createWiredCommandRegistry()`, so
 * the local RPC registry and the workspace service bind the same commands and
 * the same schemas. `bind` is idempotent, because the registry contract allows
 * a module to be bound twice (a test does exactly that).
 *
 * The schemas live in `@rox/shared` (zod is not a dependency of `@rox/core`);
 * the risk classes stay the ones the catalogue attached, so binding a schema
 * never changes a classification.
 */

import type { CommandRegistry, SchemaLike } from '@rox/core/commands'
import { AGENT_PAYLOAD_SCHEMAS } from '@rox/shared/agents/schemas'
import { IDENTITY_PAYLOAD_SCHEMAS, TEAM_CHAT_PAYLOAD_SCHEMAS } from '@rox/shared/identity/schemas'
import type { CommandModule } from '../commands/registry.ts'
import {
  activatePlaceholder,
  browsePublicChats,
  createChat,
  createWorkspace,
  decideApproval,
  ensurePlaceholder,
  invokeAgent,
  invitePeople,
  joinChat,
  leaveChat,
  mergePlaceholder,
  pauseAgent,
  provisionPersonalAgent,
  setChatVisibility,
} from './handlers.ts'

/** Every payload schema this package owns, keyed by command name. */
export const AGENTS_GOVERNANCE_SCHEMAS = {
  ...TEAM_CHAT_PAYLOAD_SCHEMAS,
  ...IDENTITY_PAYLOAD_SCHEMAS,
  ...AGENT_PAYLOAD_SCHEMAS,
} as const

/** Bind the payload schemas and the reference handlers of this package. */
export function bindAgentsGovernance(registry: CommandRegistry): void {
  // One boundary cast: the map's entries have different payload types, and
  // `bindSchema` is intentionally payload-agnostic (each handler re-narrows).
  const schemas = Object.entries(AGENTS_GOVERNANCE_SCHEMAS) as Array<[string, SchemaLike<unknown>]>
  for (const [type, schema] of schemas) {
    if (!registry.has(type)) continue
    if (registry.get(type)?.schemaBound) continue
    registry.bindSchema(type, schema)
  }
  const handlers: Record<keyof typeof AGENTS_GOVERNANCE_SCHEMAS, Parameters<CommandRegistry['bind']>[1]> = {
    'workspaces.create': createWorkspace as never,
    'people.invite': invitePeople as never,
    'identity.ensure_placeholder': ensurePlaceholder as never,
    'identity.activate_placeholder': activatePlaceholder as never,
    'identity.merge_placeholder': mergePlaceholder as never,
    'im.create_chat': createChat as never,
    'im.join_chat': joinChat as never,
    'im.leave_chat': leaveChat as never,
    'im.set_visibility': setChatVisibility as never,
    'im.browse_public_chats': browsePublicChats as never,
    'agents.provision_personal_agent': provisionPersonalAgent as never,
    'agents.invoke': invokeAgent as never,
    'agents.decide_approval': decideApproval as never,
    'agents.pause': pauseAgent as never,
  }
  for (const [type, handler] of Object.entries(handlers)) {
    if (registry.handler(type)) continue
    registry.bind(type, handler)
  }
}

/** The module entry for `COMMAND_MODULES`. */
export const AGENTS_COMMAND_MODULE: CommandModule = Object.freeze({
  name: 'agents',
  bind: bindAgentsGovernance,
})