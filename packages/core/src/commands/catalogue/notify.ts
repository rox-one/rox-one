// W1-03 (#1500) — Notifications `notifications.*` (TECH-SPEC §4.11) and reminders (§20 X-16).
import { CATALOGUE_FLAGS as F, moduleCatalogue } from './entry.ts'

export const NOTIFY_COMMANDS = moduleCatalogue('notify', undefined, [
  ['notifications.mark_read', 'workspace'],
  ['notifications.mark_all_read', 'workspace'],
  ['notifications.update_prefs', 'workspace'],
  ['reminders.create', 'local', 'write', F.xfn],
  ['reminders.cancel', 'local', 'write', F.xfn],
])
