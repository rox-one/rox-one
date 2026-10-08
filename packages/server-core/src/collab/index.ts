/**
 * W1-14 (#1511) — Local collaboration handlers (`@rox/server-core/collab`).
 *
 * The command-module half of the collaboration contracts: the presence store,
 * the suggestion index, receipts, doc views and the free-busy aggregate. Both
 * authorities bind it through `COMMAND_MODULES`
 * (`packages/server-core/src/commands/registry.ts`), before the W1-06
 * reference module, so its handlers win over the placeholders.
 */

export { bindCollabContracts, COLLAB_DIRECT_HANDLER_TYPES, COLLAB_REFERENCE_SPECS, collabPresenceStore, configureCollabRuntime, freeBusyOp, presenceHandlers, resetCollabRuntime } from './reference-handlers.ts'
export type { CollabCommandBindings, CollabRuntime, FreeBusyEventQuery, PresenceCommandHandlers, PresenceFrameHint } from './reference-handlers.ts'
export { PresenceStore } from './presence-store.ts'
export type { PresenceSnapshot } from './presence-store.ts'
export { COLLAB_COMMAND_MODULE } from './module.ts'