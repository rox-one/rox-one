/**
 * W1-14 (#1511) — Local Drive handlers (`@rox/server-core/drive`).
 *
 * The quota-bearing commands of §16 with their ledger arithmetic; both
 * authorities bind them through `COMMAND_MODULES`.
 */

export { DRIVE_REFERENCE_SPECS } from './reference-handlers.ts'
export { DRIVE_COMMAND_MODULE, bindDriveContracts, bindDriveReferenceSpecs } from './module.ts'
