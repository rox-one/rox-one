/**
 * W1-03 (#1500) — Catalogue helper. One file per module so later packages add
 * files (or bind) instead of editing one big list.
 *
 * Entries register the command **name**, owner module, authority and verb
 * with the placeholder schema (`schemaBound: false`). W1-06 (#1503) replaces
 * the schemas through `registry.bindSchema`, W1-11 (#1508) sets risk classes,
 * and module packages attach handlers with `registry.bind`.
 */

import type { Rox2Permission } from '../../rox2/platform-contract.ts'
import type { CommandType } from '../envelope.ts'
import { PLACEHOLDER_PAYLOAD_SCHEMA, type CommandAuthority, type CommandDefinition } from '../registry.ts'

/** `[type, authority, verb = 'write', flag override (null = no flag)]`. */
export type CatalogueEntry =
  | readonly [type: CommandType, authority: CommandAuthority]
  | readonly [type: CommandType, authority: CommandAuthority, verb: Rox2Permission]
  | readonly [type: CommandType, authority: CommandAuthority, verb: Rox2Permission, flag: string | null]

export function moduleCatalogue(module: string, flag: string | undefined, entries: readonly CatalogueEntry[]): CommandDefinition<unknown>[] {
  return entries.map(([type, authority, verb = 'write', flagOverride]) => {
    const effectiveFlag = flagOverride === undefined ? flag : flagOverride ?? undefined
    const definition: CommandDefinition<unknown> = {
      type,
      module,
      authority,
      verb,
      schema: PLACEHOLDER_PAYLOAD_SCHEMA,
      schemaBound: false,
    }
    if (effectiveFlag) definition.flag = effectiveFlag
    return definition
  })
}

/** Owner-module flags (TECH-SPEC §8), referenced by id; each package registers its own flag. */
export const CATALOGUE_FLAGS = {
  entitiesLinks: 'entities.links.v1',
  messenger: 'workbench.mode.messenger.v1',
  docsShared: 'docs.shared.v1',
  docsDrive: 'docs.drive.v1',
  docsWiki: 'docs.wiki.v1',
  tasksLark: 'tasks.lark.v1',
  tasksShared: 'tasks.shared.v1',
  goalsMode: 'workbench.mode.goals.v1',
  goals: 'goals.v1',
  goalsCheckins: 'goals.checkins.v1',
  spaces: 'spaces.v1',
  kpis: 'kpis.v1',
  calendar: 'workbench.mode.calendar.v1',
  vc: 'meetings.vc.v1',
  contacts: 'workbench.mode.contacts.v1',
  mail: 'mail.client.v2',
  collabPresence: 'collab.presence.v1',
  collabComments: 'collab.comments.v2',
  collabSuggestions: 'collab.suggestions.v1',
  xsc: 'xsc.create.v1',
  agents: 'agents.autonomy.v1',
  automation: 'automation.rules.v1',
  placeholders: 'identity.placeholders.v1',
  welcome: 'onboarding.welcome.v1',
  drivePersonal: 'drive.personal.v1',
  agentPanel: 'agent.panel.v1',
  xfn: 'xfn.capabilities.v1',
} as const
