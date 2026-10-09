/**
 * W1-14 (#1511) — Command module: personal Drive handlers + schemas + risks.
 *
 * Listed in `COMMAND_MODULES` before the W1-06 reference module, so the
 * quota-bearing handlers replace the placeholders of `drive.provision`,
 * `drive.open_upload` and `drive.complete_upload`, and own `drive.abort_upload`.
 */

import { DRIVE_COMMAND_RISK, type DriveContractType } from '@rox/core/drive'
import type { CommandHandlerContext, CommandRegistry } from '@rox/core/commands'
import { DRIVE_CONTRACT_COMMAND_SCHEMAS } from '@rox/shared/drive'
import type { CommandModule } from '../commands/registry'
import { referenceHandler } from '../work/reference/engine'
import { referenceBackendFor, referenceRuntimeNow } from '../work/reference/module'
import type { ReferenceSpecMap } from '../work/reference/specs/types'
import { DRIVE_REFERENCE_SPECS } from './reference-handlers'

/** Binds the drive payload schemas, risk classes and handlers. */
export function bindDriveContracts(registry: CommandRegistry): void {
  for (const [type, schema] of Object.entries(DRIVE_CONTRACT_COMMAND_SCHEMAS)) {
    if (!registry.has(type)) continue
    registry.bindSchema(type, schema, { riskClass: DRIVE_COMMAND_RISK[type as DriveContractType] })
  }
  bindDriveReferenceSpecs(registry, DRIVE_REFERENCE_SPECS)
}

/** The engine wiring both collab and drive use (one clock, one backend chooser). */
export function bindDriveReferenceSpecs(registry: CommandRegistry, specs: ReferenceSpecMap): void {
  for (const [type, spec] of Object.entries(specs)) {
    if (!registry.has(type) || registry.handler(type)) continue
    const { op, event } = typeof spec === 'function' ? { op: spec, event: undefined } : spec
    registry.bind(type, referenceHandler(type, op, {
      now: referenceRuntimeNow,
      backendFor: (ctx: CommandHandlerContext<unknown>) => referenceBackendFor(ctx),
      verb: registry.get(type)!.verb,
      ...(event ? { eventType: event } : {}),
    }))
  }
}

const driveCommandModule: CommandModule = {
  name: 'drive',
  bind(registry) {
    bindDriveContracts(registry)
  },
}

export const DRIVE_COMMAND_MODULE: CommandModule = Object.freeze(driveCommandModule)