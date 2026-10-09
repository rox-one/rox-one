// W1-12 (#1509) — Domain rule engine commands (TECH-SPEC §14).
//
// Names the R-rules dispatch that were not in the W1-03 catalogue. Everything
// else (docs.ensure_daily_note, docs.append_daily_link, docs.create_meeting_notes,
// tasks.create, links.add, im.*, agents.*, drive.*, identity.*) is declared in
// its owner module's file and is only bound / extended here.
import { CATALOGUE_FLAGS as F, moduleCatalogue } from './entry.ts'

export const AUTOMATION_COMMANDS = moduleCatalogue('automation', F.automation, [
  // R1 step 1 (DATA-MODEL §5.16): the per-user system list «Бэклог» (D-v2-4).
  ['task_lists.ensure_system_list', 'by-target', 'write'],
  // R4 step 4: the invitation email (TECH-SPEC §15.2).
  ['notify.send_invite_email', 'workspace', 'write'],
])