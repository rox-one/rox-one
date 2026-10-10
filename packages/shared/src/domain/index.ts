/**
 * W1-06 (#1503) — Domain zod schemas for every Rox Unified module.
 *
 * `COMMAND_PAYLOAD_SCHEMAS` covers every non-system catalogue command
 * (`@rox/core/commands/catalogue`) whose payload schema is not owned by a
 * wave-2 module: the W1-11 identity / team-chat / agent-governance schemas live
 * with `AGENTS_COMMAND_MODULE` (`@rox/shared/identity` + `@rox/shared/agents`)
 * and are deliberately absent here (precedence rule — see
 * `packages/server-core/src/commands/registry.ts`). The server-core command
 * modules bind the rest via `registry.bindSchema`. `ENTITY_SCHEMAS` are the
 * stored shapes reference handlers emit (local JSON work store and server rows).
 */

import type { z } from 'zod'
import type { CommandSchemaMap } from './common'
import { ACL_COMMAND_SCHEMAS, ACL_ENTITY_SCHEMAS } from './acl/schema'
import { CALENDAR_COMMAND_SCHEMAS, CALENDAR_ENTITY_SCHEMAS } from './calendar/schema'
import { CONTACTS_COMMAND_SCHEMAS, CONTACTS_ENTITY_SCHEMAS } from './contacts/schema'
import { DOCS_COMMAND_SCHEMAS, DOCS_ENTITY_SCHEMAS, DRIVE_COMMAND_SCHEMAS, WIKI_COMMAND_SCHEMAS } from './docs/schema'
import { ENTITIES_COMMAND_SCHEMAS } from './entities/schema'
import { GOALS_COMMAND_SCHEMAS, GOALS_ENTITY_SCHEMAS } from './goals/schema'
import { IDENTITY_COMMAND_SCHEMAS } from './identity/schema'
import { KPIS_COMMAND_SCHEMAS, KPIS_ENTITY_SCHEMAS } from './kpis/schema'
import { MEETINGS_COMMAND_SCHEMAS, MEETINGS_ENTITY_SCHEMAS } from './meetings/schema'
import { MESSENGER_COMMAND_SCHEMAS, MESSENGER_ENTITY_SCHEMAS } from './messenger/schema'
import { NOTIFY_COMMAND_SCHEMAS, NOTIFY_ENTITY_SCHEMAS } from './notify/schema'
import { PROJECTS_COMMAND_SCHEMAS, PROJECTS_ENTITY_SCHEMAS } from './projects/schema'
import { SOCIAL_COMMAND_SCHEMAS, SOCIAL_ENTITY_SCHEMAS } from './social/schema'
import { SPACES_COMMAND_SCHEMAS, SPACES_ENTITY_SCHEMAS } from './spaces/schema'
import { TASKS_COMMAND_SCHEMAS, TASKS_ENTITY_SCHEMAS } from './tasks/schema'
import { WORKPLACE_COMMAND_SCHEMAS } from './workplace/schema'
// W1-12 (#1509)
import { AUTOMATION_COMMAND_SCHEMAS } from '../automation/schemas'
import { COLLAB_COMMAND_SCHEMAS } from '../collab/schemas'
import { DRIVE_CONTRACT_COMMAND_SCHEMAS } from '../drive/schemas'
import { XSC_COMMAND_SCHEMAS } from '../xsc/schemas'
// W1-11 (#1508) — the one team-chat payload schema that ships outside this folder.
import { browsePublicChatsSchema } from '../identity/schemas'

export * from './common'
export * from './acl/schema'
export * from './calendar/schema'
export * from './contacts/schema'
export * from './docs/schema'
export * from './entities/schema'
export * from './goals/schema'
export * from './identity/schema'
export * from './kpis/schema'
export * from './meetings/schema'
export * from './messenger/schema'
export * from './notify/schema'
export * from './projects/schema'
export * from './social/schema'
export * from './spaces/schema'
export * from './tasks/schema'
export * from './workplace/schema'
export * from '../collab/schemas'
export * from '../drive/schemas'
export * from '../xsc/schemas'

/**
 * `im.browse_public_chats` (catalogue module `im`) is the one non-system command
 * whose payload schema ships outside `@rox/shared/domain`: W1-11 (#1508) defines
 * it in `@rox/shared/identity/schemas.ts` as a plain `z.object`, and the agents
 * module binds that copy. The domain payloads are strict (`./common.ts`: unknown
 * members are a VALIDATION rejection), so the strictness the wired registry must
 * keep is re-issued here: `DOMAIN_SCHEMA_COMMAND_MODULE` runs *before*
 * `AGENTS_COMMAND_MODULE` and binds this strict version first, and the agents
 * module then skips the already-bound type (`agents/module.ts`). This is the
 * only command where the domain map deliberately precedes its owner module;
 * every other owner-module command was removed from `COMMAND_PAYLOAD_SCHEMAS`
 * (precedence rule: the owning module's schema is the one the registry keeps).
 */
// The W1-11 schema is a `z.object()` at runtime; its declared type is widened to `z.ZodType`, which drops `.strict()`.
const browsePublicChatsObject = browsePublicChatsSchema as unknown as z.ZodObject<z.ZodRawShape>

const MESSENGER_TEAM_CHAT_SCHEMAS: CommandSchemaMap = {
  'im.browse_public_chats': browsePublicChatsObject.strict(),
}

/** Per-module maps, in catalogue module order. */
export const DOMAIN_COMMAND_SCHEMA_MODULES: Readonly<Record<string, CommandSchemaMap>> = Object.freeze({
  entities: ENTITIES_COMMAND_SCHEMAS,
  messenger: { ...MESSENGER_COMMAND_SCHEMAS, ...MESSENGER_TEAM_CHAT_SCHEMAS },
  docs: DOCS_COMMAND_SCHEMAS,
  drive: DRIVE_COMMAND_SCHEMAS,
  wiki: WIKI_COMMAND_SCHEMAS,
  tasks: TASKS_COMMAND_SCHEMAS,
  goals: GOALS_COMMAND_SCHEMAS,
  projects: PROJECTS_COMMAND_SCHEMAS,
  spaces: SPACES_COMMAND_SCHEMAS,
  kpis: KPIS_COMMAND_SCHEMAS,
  calendar: CALENDAR_COMMAND_SCHEMAS,
  meetings: MEETINGS_COMMAND_SCHEMAS,
  contacts: CONTACTS_COMMAND_SCHEMAS,
  social: SOCIAL_COMMAND_SCHEMAS,
  notify: NOTIFY_COMMAND_SCHEMAS,
  acl: ACL_COMMAND_SCHEMAS,
  identity: IDENTITY_COMMAND_SCHEMAS,
  workplace: WORKPLACE_COMMAND_SCHEMAS,
  // W1-12 (#1509): the automation module's own command names (appended).
  automation: AUTOMATION_COMMAND_SCHEMAS,
  // W1-14 (#1511) — the schemas that replaced #1503's placeholders for the §12,
  // collaboration and drive-quota commands.
  collab: COLLAB_COMMAND_SCHEMAS,
  driveContracts: DRIVE_CONTRACT_COMMAND_SCHEMAS,
  xsc: XSC_COMMAND_SCHEMAS,
})

function mergeUnique(maps: readonly CommandSchemaMap[]): CommandSchemaMap {
  const out: Record<string, z.ZodType> = {}
  for (const map of maps) {
    for (const [type, schema] of Object.entries(map)) {
      if (type in out) throw new Error(`duplicate domain command schema: ${type}`)
      out[type] = schema
    }
  }
  return Object.freeze(out)
}

/** Payload schema per catalogue command type. */
export const COMMAND_PAYLOAD_SCHEMAS: CommandSchemaMap = mergeUnique(Object.values(DOMAIN_COMMAND_SCHEMA_MODULES))

/** Stored entity shapes, keyed by record type. */
export const ENTITY_SCHEMAS = Object.freeze({
  ...TASKS_ENTITY_SCHEMAS,
  ...GOALS_ENTITY_SCHEMAS,
  ...PROJECTS_ENTITY_SCHEMAS,
  ...SPACES_ENTITY_SCHEMAS,
  ...KPIS_ENTITY_SCHEMAS,
  ...DOCS_ENTITY_SCHEMAS,
  ...MESSENGER_ENTITY_SCHEMAS,
  ...CALENDAR_ENTITY_SCHEMAS,
  ...MEETINGS_ENTITY_SCHEMAS,
  ...CONTACTS_ENTITY_SCHEMAS,
  ...SOCIAL_ENTITY_SCHEMAS,
  ...NOTIFY_ENTITY_SCHEMAS,
  ...ACL_ENTITY_SCHEMAS,
})
export type DomainEntityType = keyof typeof ENTITY_SCHEMAS
