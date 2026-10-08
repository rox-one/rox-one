/**
 * W1-03 (#1500) — Valkey fan-out sink (multi-instance gateways).
 *
 * Takes any client with `publish(channel, message)` (node-redis / iovalkey /
 * Bun's RedisClient all fit), so the service adds no dependency. Messages carry
 * ids only (event id, type, subject, revision, sequence) — never payload
 * content; subscribers re-read the event under their own ACL.
 */

import type { DomainEvent } from '../../../../../packages/core/src/events/index.ts'
import type { DomainEventSink } from './relay.ts'

export interface ValkeyPublishClient {
  publish(channel: string, message: string): Promise<unknown> | unknown
}

export const VALKEY_EVENT_CHANNEL_PREFIX = 'rox:events:'

export function valkeyEventSink(client: ValkeyPublishClient, prefix = VALKEY_EVENT_CHANNEL_PREFIX): DomainEventSink {
  return async events => {
    for (const event of events) {
      await client.publish(prefix + event.workspaceId, JSON.stringify({
        eventId: event.eventId,
        sequence: event.sequence ?? null,
        type: event.type,
        subject: event.subject ?? null,
        aggregateRevision: event.aggregateRevision,
        actorId: event.actorId ?? null,
        causationId: event.causationId ?? null,
      }))
    }
  }
}
