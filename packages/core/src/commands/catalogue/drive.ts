// W1-03 (#1500) — Drive `drive.*` and Wiki `wiki.*` (TECH-SPEC §4.2, §16, §20 X-22).
import { CATALOGUE_FLAGS as F, moduleCatalogue } from './entry.ts'

export const DRIVE_COMMANDS = moduleCatalogue('drive', F.docsDrive, [
  ['drive.create_folder', 'workspace'],
  ['drive.rename_folder', 'workspace'],
  ['drive.move_items', 'workspace'],
  ['drive.add_link', 'workspace'],
  ['drive.upload_file', 'workspace'],
  ['drive.favorite', 'workspace'],
  ['drive.add_shortcut', 'workspace'],
  // v2 personal drive (§16)
  ['drive.provision', 'workspace', 'write', F.drivePersonal],
  ['drive.open_upload', 'workspace', 'write', F.drivePersonal],
  ['drive.complete_upload', 'workspace', 'write', F.drivePersonal],
  ['drive.import_attachment', 'workspace', 'write', F.xfn],
])

export const WIKI_COMMANDS = moduleCatalogue('wiki', F.docsWiki, [
  ['wiki.create_space', 'workspace'],
  ['wiki.move_node', 'workspace'],
])
