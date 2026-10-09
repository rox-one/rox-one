/**
 * W1-14 (#1511) — `presence.*` and the free-busy query (TECH-SPEC §11.1, §11.9).
 *
 * These four names are new in W1-14: `presence.heartbeat|join|leave` are what a
 * client sends over the WS gateway (once every 20 s, and on entering / leaving
 * an object), and `calendar.free_busy` is the aggregate the event editor's
 * "Find a time" calls. Everything else of §11 binds to names declared by #1500
 * (`docs.*`, `im.mark_read`) and is registered by the collab module in
 * `@rox/server-core/collab` rather than re-declared here.
 *
 * Definitions are object literals because each carries its `riskClass` from
 * the start: `@rox/server-core` binds the payload schema from
 * `@rox/shared/collab/schemas` and the handler together with it.
 */

import { COLLAB_COMMAND_RISK } from '../../collab/commands.ts'
import type { CommandDefinition, SchemaLike } from '../registry.ts'

/** Placeholder until the collab module binds the zod schema (kept honest by the wiring test). */
const PENDING_SCHEMA: SchemaLike<never> = {
  safeParse: () => ({ success: false, error: new Error('presence schemas are bound by @rox/server-core/collab') }),
}

type CollabCatalogueEntry = readonly [
  type: keyof typeof COLLAB_COMMAND_RISK,
  module: string,
  authority: 'by-target' | 'workspace' | 'local',
  verb: 'read' | 'write',
  flag: string | undefined,
]

const ENTRIES: readonly CollabCatalogueEntry[] = [
  ['presence.heartbeat', 'presence', 'workspace', 'write', 'collab.presence.v1'],
  ['presence.join', 'presence', 'workspace', 'write', 'collab.presence.v1'],
  ['presence.leave', 'presence', 'workspace', 'write', 'collab.presence.v1'],
  ['calendar.free_busy', 'calendar', 'workspace', 'read', 'workbench.mode.calendar.v1'],
]

export const COLLAB_COMMANDS: CommandDefinition<unknown>[] = ENTRIES.map(([type, module, authority, verb, flag]) => {
  const definition: CommandDefinition<unknown> = {
    type,
    module,
    authority,
    verb,
    schema: PENDING_SCHEMA as SchemaLike<unknown>,
    schemaBound: false,
    riskClass: COLLAB_COMMAND_RISK[type],
    maxPayloadBytes: 8 * 1024,
    description: 'W1-14 collaboration contract (TECH-SPEC §11).',
  }
  if (flag) definition.flag = flag
  return definition
})