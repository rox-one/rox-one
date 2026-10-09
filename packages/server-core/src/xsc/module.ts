/**
 * W1-14 (#1511) — Command module: §12 handlers + schemas + risk classes.
 *
 * Every one of the fourteen names is declared by the W1-03 catalogue; this
 * module replaces their placeholder schema with the §12 payload, attaches the
 * §12 risk class and binds the reference handler — before the W1-06 reference
 * module, which then skips them.
 */

import { XSC_COMMAND_RISK, type XscCommandType } from '@rox/core/xsc'
import type { CommandRegistry } from '@rox/core/commands'
import { XSC_COMMAND_SCHEMAS } from '@rox/shared/xsc'
import type { CommandModule } from '../commands/registry'
import { bindDriveReferenceSpecs } from '../drive/module'
import { XSC_REFERENCE_SPECS } from './reference-handlers'

/** Binds the §12 payload schemas, risk classes and handlers. */
export function bindXscContracts(registry: CommandRegistry): void {
  for (const [type, schema] of Object.entries(XSC_COMMAND_SCHEMAS)) {
    if (!registry.has(type)) continue
    registry.bindSchema(type, schema, { riskClass: XSC_COMMAND_RISK[type as XscCommandType] })
  }
  bindDriveReferenceSpecs(registry, XSC_REFERENCE_SPECS)
}

const xscCommandModule: CommandModule = {
  name: 'xsc',
  bind(registry) {
    bindXscContracts(registry)
  },
}

export const XSC_COMMAND_MODULE: CommandModule = Object.freeze(xscCommandModule)
