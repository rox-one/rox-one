/**
 * Adapter from an {@link ImFeedItem} to a `domain_event` the existing notify
 * fan-out consumes. The call card is a kind-9 stream message, so the Лента /
 * notification fan-out treats it like an `im.message.receive_v1` event scoped
 * to the channel (`payload.channelId`).
 */

import type { DomainEvent } from '../../../../../packages/core/src/events/index.ts'
import type { ImFeedItem } from './service.ts'

export const IM_FEED_DOMAIN_EVENT_TYPE = 'im.message.receive_v1'

export function imFeedDomainEvent(item: ImFeedItem): DomainEvent {
  return {
    eventId: item.eventId,
    workspaceId: item.orgId,
    type: IM_FEED_DOMAIN_EVENT_TYPE,
    aggregateRevision: 1,
    payload: { channelId: item.channelId, source: item.source, kind: item.kind, callId: item.callId },
    createdAt: item.at,
  }
}
