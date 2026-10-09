/**
 * W1-14 (#1511) — the §12 cross-surface commands in the catalogue.
 *
 * All fourteen names of TECH-SPEC §12 are already declared by #1500 (`docs.*`,
 * `tasks.*`, `calendar.*`, `vc.*`, `im.*`, `agents.*`), so this file declares
 * **no** definition: a second definition of a declared name is a
 * `CommandRegistryError` (duplicate command). What W1-14 owns is the entry's
 * *contract* — the payload schema and the risk class — which
 * `@rox/server-core/xsc` binds through `registry.bindSchema`.
 *
 * `XSC_CATALOGUE_TYPES` is the list those bindings must cover; a contract test
 * asserts it against the catalogue so a rename cannot silently drop one.
 */

import { XSC_COMMAND_RISK, XSC_COMMAND_TYPES, type XscCommandType } from '../../xsc/commands.ts'

export { XSC_COMMAND_RISK, XSC_COMMAND_TYPES }
export type { XscCommandType }

/** The catalogue types this package re-binds (schema + risk class + handler). */
export const XSC_CATALOGUE_TYPES: readonly XscCommandType[] = XSC_COMMAND_TYPES