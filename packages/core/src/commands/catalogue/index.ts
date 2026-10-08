/**
 * W1-03 (#1500) — The full command catalogue (names, modules, authorities,
 * verbs). Schemas are placeholders (`schemaBound: false`) until W1-06 binds
 * them; handlers are bound by module packages. Append new module files in
 * their own block at the end of `COMMAND_CATALOGUE` (`// W1-xx (#nnnn)`).
 */

import type { CommandDefinition, CommandRegistry } from '../registry.ts'
import { SYSTEM_COMMANDS } from './system.ts'
import { ENTITIES_COMMANDS } from './entities.ts'
import { SOCIAL_COMMANDS } from './social.ts'
import { ACL_COMMANDS } from './acl.ts'
import { IM_COMMANDS } from './im.ts'
import { DOCS_COMMANDS } from './docs.ts'
import { DRIVE_COMMANDS, WIKI_COMMANDS } from './drive.ts'
import { TASKS_COMMANDS } from './tasks.ts'
import { CALENDAR_COMMANDS } from './calendar.ts'
import { MEETINGS_COMMANDS } from './meetings.ts'
import { CONTACTS_COMMANDS } from './contacts.ts'
import { GOALS_COMMANDS } from './goals.ts'
import { PROJECTS_COMMANDS } from './projects.ts'
import { SPACES_COMMANDS } from './spaces.ts'
import { KPIS_COMMANDS } from './kpis.ts'
import { NOTIFY_COMMANDS } from './notify.ts'
import { MAIL_COMMANDS, TEMPLATES_COMMANDS, XFN_CORE_COMMANDS } from './workplace.ts'
import { IDENTITY_COMMANDS } from './identity.ts'
import { AGENTS_COMMANDS } from './agents.ts'

export const COMMAND_CATALOGUE: readonly CommandDefinition<unknown>[] = [
  // W1-03 (#1500)
  ...SYSTEM_COMMANDS,
  ...ENTITIES_COMMANDS,
  ...SOCIAL_COMMANDS,
  ...ACL_COMMANDS,
  ...IM_COMMANDS,
  ...DOCS_COMMANDS,
  ...DRIVE_COMMANDS,
  ...WIKI_COMMANDS,
  ...TASKS_COMMANDS,
  ...CALENDAR_COMMANDS,
  ...MEETINGS_COMMANDS,
  ...CONTACTS_COMMANDS,
  ...GOALS_COMMANDS,
  ...PROJECTS_COMMANDS,
  ...SPACES_COMMANDS,
  ...KPIS_COMMANDS,
  ...NOTIFY_COMMANDS,
  ...MAIL_COMMANDS,
  ...TEMPLATES_COMMANDS,
  ...XFN_CORE_COMMANDS,
  ...IDENTITY_COMMANDS,
  ...AGENTS_COMMANDS,
]

/** Define the whole catalogue in a registry (throws on any duplicate name). */
export function registerCommandCatalogue(registry: CommandRegistry): void {
  registry.defineAll(COMMAND_CATALOGUE)
}

export { CATALOGUE_FLAGS, moduleCatalogue, type CatalogueEntry } from './entry.ts'
export { SYSTEM_PING_SCHEMA, type SystemPingPayload } from './system.ts'
