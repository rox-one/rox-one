// W1-03 (#1500) — Workspaces, identity lifecycle, onboarding (TECH-SPEC §15, §17.2).
import { CATALOGUE_FLAGS as F, moduleCatalogue } from './entry.ts'

export const IDENTITY_COMMANDS = moduleCatalogue('identity', F.placeholders, [
  ['workspaces.create', 'workspace', 'write', null],
  ['identity.ensure_placeholder', 'workspace'],
  ['identity.activate_placeholder', 'workspace'],
  ['identity.merge_placeholder', 'workspace'],
  ['onboarding.seed_starter_content', 'by-target', 'write', F.welcome],
])
