/**
 * W1-03 (#1500) — `system.ping`: the bus round-trip probe.
 *
 * Bound on both authorities. Applied receipt + one `system.pinged` domain
 * event, which the default projection publishes to `user:{actor}`.
 */

import type { CommandHandler, CommandRegistry, SystemPingPayload } from '@rox/core/commands'

export interface SystemPingResult {
  pong: true
  nonce?: string
  authority: 'local' | 'workspace'
}

export const systemPingHandler: CommandHandler<SystemPingPayload, SystemPingResult> = ctx => {
  const result: SystemPingResult = { pong: true, authority: ctx.authority }
  if (ctx.payload.nonce !== undefined) result.nonce = ctx.payload.nonce
  return {
    result,
    events: [{ type: 'system.pinged', payload: ctx.payload.nonce !== undefined ? { nonce: ctx.payload.nonce } : {} }],
  }
}

export function bindSystemPing(registry: CommandRegistry): void {
  if (!registry.handler('system.ping')) registry.bind('system.ping', systemPingHandler)
}
