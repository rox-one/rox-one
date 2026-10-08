/**
 * W1-14 (#1511) — Command module: collaboration handlers + schemas + risks.
 *
 * Listed in `COMMAND_MODULES` **before** the W1-06 reference module, so the
 * handlers here replace the placeholders of `docs.suggest_changes`,
 * `docs.sync_suggestions`, `docs.decide_suggestion`, `docs.record_view` and
 * `im.mark_read`, and own the new `presence.*` / `calendar.free_busy` entries.
 */

import type { CommandModule } from '../commands/registry'
import { referenceBackendFor, referenceRuntimeNow } from '../work/reference/module'
import { bindCollabContracts } from './reference-handlers'

const collabCommandModule: CommandModule = {
  name: 'collab',
  bind(registry) {
    bindCollabContracts(registry, { now: referenceRuntimeNow, backendFor: referenceBackendFor })
  },
}

export const COLLAB_COMMAND_MODULE: CommandModule = Object.freeze(collabCommandModule)