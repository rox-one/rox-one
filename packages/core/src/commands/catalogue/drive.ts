// W1-03 (#1500) — Drive `drive.*` and Wiki `wiki.*` (TECH-SPEC §4.2, §16, §20 X-22).
import { DRIVE_COMMAND_RISK } from '../../drive/commands.ts'
import { PLACEHOLDER_PAYLOAD_SCHEMA, type CommandDefinition } from '../registry.ts'
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

/**
 * W1-14 (#1511) — `drive.abort_upload` (TECH-SPEC §16.2 step 4).
 *
 * Aborting or abandoning an upload session must release its quota
 * reservation, and a state change inside the workspace authority is a
 * command. `drive.open_upload` / `complete_upload` are declared by #1500; this
 * is the missing half of the protocol, so the upload panel's ✕ (UI-SPEC
 * §20.4) has something to dispatch.
 */
export const DRIVE_UPLOAD_COMMANDS: CommandDefinition<unknown>[] = [
  {
    type: 'drive.abort_upload',
    module: 'drive',
    authority: 'workspace',
    verb: 'write',
    schema: PLACEHOLDER_PAYLOAD_SCHEMA,
    schemaBound: false,
    flag: F.drivePersonal,
    riskClass: DRIVE_COMMAND_RISK['drive.abort_upload'],
    description: 'Abort an open upload session and release its quota reservation.',
  },
]
