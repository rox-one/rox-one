// W1-03 (#1500) — Agent governance `agents.*` (TECH-SPEC §12, §13, §14.2).
import { CATALOGUE_FLAGS as F, moduleCatalogue } from './entry.ts'

export const AGENTS_COMMANDS = moduleCatalogue('agents', F.agents, [
  ['agents.provision_personal_agent', 'workspace'],
  ['agents.invoke', 'workspace'],
  ['agents.decide_approval', 'workspace'],
  ['agents.pause', 'workspace'],
])
