// W1-03 (#1500) — People / contacts `people.*`, `contacts.*` (TECH-SPEC §4.6, §15.1).
import { CATALOGUE_FLAGS as F, moduleCatalogue } from './entry.ts'

export const CONTACTS_COMMANDS = moduleCatalogue('contacts', F.contacts, [
  ['people.update_profile', 'workspace'],
  ['people.set_manager', 'workspace'],
  ['people.invite', 'workspace', 'share'],
  ['people.convert_to_guest', 'workspace', 'share'],
  ['people.add_workspace_member', 'workspace', 'share'],
  ['contacts.create_card', 'by-target'],
  ['contacts.update_card', 'by-target'],
  ['contacts.merge_cards', 'by-target'],
  ['contacts.star', 'by-target'],
  ['contacts.add_touch', 'by-target'],
])
