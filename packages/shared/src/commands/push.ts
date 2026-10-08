/**
 * W1-03 (#1500) — Payload of the `commands:event` push channel.
 */

import type { CommandReceipt } from '@rox/core/commands'
import type { RealtimeFrame } from '@rox/core/events'

export type CommandBusPushEvent =
  /** A realtime frame from the workspace gateway (or the local bus). */
  | { kind: 'realtime'; frame: RealtimeFrame }
  /** A queued command reached a terminal receipt after an outbox drain. */
  | { kind: 'receipt'; receipt: CommandReceipt }
  /** Outbox status changed (pending count, last transport error). */
  | { kind: 'outbox'; pending: number; lastError?: string }
