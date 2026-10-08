// W1-03 (#1500) — Calendar `calendar.*` (TECH-SPEC §4.4, §12, §20 X-14 / X-22).
import { CATALOGUE_FLAGS as F, moduleCatalogue } from './entry.ts'

export const CALENDAR_COMMANDS = moduleCatalogue('calendar', F.calendar, [
  ['calendar.create_event', 'by-target'],
  ['calendar.update_event', 'by-target'],
  ['calendar.delete_event', 'by-target', 'destroy'],
  ['calendar.rsvp', 'by-target'],
  ['calendar.create_calendar', 'workspace'],
  ['calendar.subscribe', 'workspace'],
  ['calendar.book_room', 'workspace'],
  ['calendar.create_event_from_message', 'workspace', 'write', F.xsc],
  ['calendar.create_time_block', 'by-target', 'write', F.xfn],
  ['calendar.create_event_from_email', 'by-target', 'write', F.xfn],
])
