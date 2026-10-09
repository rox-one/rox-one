// W1-15 (#1512) — Cross-functional capability names (TECH-SPEC §20, Z-13…X-26).
//
// W1-03 (#1500) already declares every X-command that an owner module had a
// natural home for, so those are NOT repeated here (the registry rejects
// duplicate names) — `bindXfnContracts` replaces their schemas and risk
// classes instead. This file registers only the two names X-15 / X-23 need and
// no owner module had introduced yet:
//
// - `decisions.create` — X-15 writes `decision` records (kind 49);
// - `tables.insert_row` — the X-23 runtime action for a form response.
//
// The XFN command / query / UI-command name lists are re-exported here so the
// whole contract has one index: `XFN_COMMAND_NAMES` (bus commands),
// `XFN_QUERY_NAMES` (read models — never commands) and
// `XFN_UI_COMMAND_NAMES` (renderer entries).
import { CATALOGUE_FLAGS as F, moduleCatalogue } from './entry.ts'
import { XFN_COMMAND_NAMES, XFN_QUERY_NAMES, XFN_UI_COMMAND_NAMES } from '../../xfn/commands.ts'

/** Only the names this package introduces; the rest stay in their owner files. */
export const XFN_NEW_COMMANDS = moduleCatalogue('core', F.xfn, [
  ['decisions.create', 'by-target'],
  ['tables.insert_row', 'workspace'],
])

export { XFN_COMMAND_NAMES, XFN_QUERY_NAMES, XFN_UI_COMMAND_NAMES }