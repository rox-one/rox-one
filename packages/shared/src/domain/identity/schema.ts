/** W1-06 (#1503) — Onboarding: TECH-SPEC §12–§15, §17.2. */
import { z } from 'zod'
import { cmd, type CommandSchemaMap } from '../common'

/**
 * PRECEDENCE (command-schema binding): the *owning* module's schema is the one
 * the registry keeps. `AGENTS_COMMAND_MODULE` (W1-11 #1508) owns every
 * identity-lifecycle, team-chat and agent-governance payload below, so this
 * W1-06 placeholder map would only shadow it — the stale entries were removed
 * (`workspaces.create`, `identity.{ensure,activate,merge}_placeholder`,
 * `people.invite`, `im.*`, `agents.*`). Never re-add an entry for a command an
 * owner module binds: `bindSchema` is last-wins, so a placeholder here silently
 * overwrites the real payload schema. Only commands with no owner-module schema
 * belong in `COMMAND_PAYLOAD_SCHEMAS`.
 */
export const IDENTITY_COMMAND_SCHEMAS: CommandSchemaMap = {
  'onboarding.seed_starter_content': cmd({ pack: z.enum(['welcome', 'team', 'personal']).default('welcome'), locale: z.string().max(16).optional() }),
}