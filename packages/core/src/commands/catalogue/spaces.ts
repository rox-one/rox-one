// W1-03 (#1500) — Spaces `spaces.*` (TECH-SPEC §4.10).
import { CATALOGUE_FLAGS as F, moduleCatalogue } from './entry.ts'

export const SPACES_COMMANDS = moduleCatalogue('spaces', F.spaces, [
  ['spaces.create', 'workspace'],
  ['spaces.update', 'workspace'],
  ['spaces.update_tools', 'workspace'],
  ['spaces.add_members', 'workspace', 'share'],
  ['spaces.remove_member', 'workspace', 'share'],
  ['spaces.update_members_permissions', 'workspace', 'share'],
  ['spaces.update_general_access', 'workspace', 'share'],
  ['spaces.update_task_statuses', 'workspace'],
  ['spaces.join', 'workspace'],
  ['spaces.leave', 'workspace'],
  ['spaces.delete', 'workspace', 'destroy'],
])
