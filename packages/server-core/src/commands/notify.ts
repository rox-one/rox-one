/**
 * W1-09 (#1506) — The notify module's command bindings.
 *
 * Bound through `COMMAND_MODULES` so the local RPC registry and the workspace
 * service can never bind different sets (W1-03 contract). The handlers bind
 * only while a notify host is installed (`setNotifyCommandHost`, done by the
 * workspace service), so a process without a notification store reports
 * `notifications.*` as `not_bound` instead of advertising a capability that
 * would always fail.
 */

import type { CommandRegistry } from '@rox/core/commands'
import { bindNotifyCommands } from '@rox/core/notify'
import type { CommandModule } from './registry'

export const NOTIFY_COMMAND_MODULE: CommandModule = Object.freeze({
  name: 'notify',
  bind(registry: CommandRegistry) { bindNotifyCommands(registry) },
})