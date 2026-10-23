/**
 * Apply a verified LiveKit webhook event to the team-chat call store.
 *
 * `room_finished` and an emptying `participant_left` are the authoritative
 * paths that end a call when the client's leave RPC was lost. Other events
 * are accepted (200) but ignored so LiveKit retries stay cheap.
 */
import type { TeamChannelCall } from './types.ts'
import type { TeamChatStore } from './storage.ts'
import type { LiveKitWebhookEvent } from './livekit-webhook.ts'

export interface ApplyLiveKitWebhookResult {
  /** Whether this delivery ended an active call. */
  ended: boolean
  /** Store touched (roster drop or end). */
  applied: boolean
  orgId: string
  channelId: string
  call: TeamChannelCall | null
  event: string
}

export function applyLiveKitWebhookEvent(store: TeamChatStore, event: LiveKitWebhookEvent): ApplyLiveKitWebhookResult {
  const name = event.event
  const roomName = typeof event.room?.name === 'string' ? event.room.name.trim() : ''
  if (!roomName) {
    return { ended: false, applied: false, orgId: '', channelId: '', call: null, event: name }
  }

  if (name === 'room_finished') {
    const r = store.endCallByRoomName(roomName)
    return { ended: r.ended, applied: r.ended, orgId: r.orgId, channelId: r.channelId, call: r.call, event: name }
  }

  if (name === 'participant_left' || name === 'participant_connection_aborted') {
    const identity = typeof event.participant?.identity === 'string' ? event.participant.identity.trim() : ''
    if (!identity) {
      return { ended: false, applied: false, orgId: '', channelId: '', call: null, event: name }
    }
    const r = store.applyLiveKitParticipantLeft(roomName, identity)
    return { ended: r.ended, applied: r.ended || !!r.call, orgId: r.orgId, channelId: r.channelId, call: r.call, event: name }
  }

  return { ended: false, applied: false, orgId: '', channelId: '', call: null, event: name }
}
