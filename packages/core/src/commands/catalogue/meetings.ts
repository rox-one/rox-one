// W1-03 (#1500) — Meetings `vc.*`, `meetings.*` (TECH-SPEC §4.5, §12, §20 X-15 / X-24).
import { CATALOGUE_FLAGS as F, moduleCatalogue } from './entry.ts'

export const MEETINGS_COMMANDS = moduleCatalogue('meetings', F.vc, [
  ['vc.start_meeting', 'workspace'],
  ['vc.join', 'workspace'],
  ['vc.end', 'workspace'],
  ['vc.set_recording', 'workspace'],
  ['meetings.publish_outcomes', 'by-target', 'write', F.xfn],
])
