/**
 * W1-14 (#1511) — Cross-surface reference handlers (`@rox/server-core/xsc`).
 *
 * The TECH-SPEC §12 handlers: the block commands, the task/event/call
 * creations from a selection, a checklist or a message, the group chat and the
 * agent invocation. Wave-2 surfaces (XSC, MSG-2, TSK-1, CAL, MTG) replace them.
 */

export { XSC_REFERENCE_SPECS } from './reference-handlers.ts'
export { XSC_COMMAND_MODULE, bindXscContracts } from './module.ts'
