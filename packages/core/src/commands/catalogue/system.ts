// W1-03 (#1500) — `system.*`: bus infrastructure commands.
import type { SchemaLike, CommandDefinition } from '../registry.ts'

export interface SystemPingPayload {
  /** Echoed back in the `system.pinged` event (≤ 128 chars). */
  nonce?: string
}

/** Structural strict schema; `@rox/shared/commands/schemas` has the zod twin. */
export const SYSTEM_PING_SCHEMA: SchemaLike<SystemPingPayload> = {
  safeParse(value: unknown) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return { success: false, error: new Error('system.ping payload must be an object') }
    }
    const keys = Object.keys(value)
    if (keys.some(key => key !== 'nonce')) return { success: false, error: new Error('Unknown system.ping field') }
    const nonce = (value as { nonce?: unknown }).nonce
    if (nonce !== undefined && (typeof nonce !== 'string' || nonce.length > 128)) {
      return { success: false, error: new Error('system.ping nonce must be a string of at most 128 chars') }
    }
    return { success: true, data: nonce === undefined ? {} : { nonce } }
  },
}

export const SYSTEM_COMMANDS: CommandDefinition<unknown>[] = [
  {
    type: 'system.ping',
    module: 'system',
    authority: 'by-target',
    verb: 'read',
    schema: SYSTEM_PING_SCHEMA as SchemaLike<unknown>,
    schemaBound: true,
    riskClass: () => 'routine',
    maxPayloadBytes: 1024,
    description: 'Round-trip probe: receipt + system.pinged event + realtime push to user:{actor}.',
  },
]
