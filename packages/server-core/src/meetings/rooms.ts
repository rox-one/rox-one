/**
 * RMA-I033 / #389 — rooms/ingress fail-closed until an SFU/media provider is chosen.
 * A stub button is not a room. No fake dialer.
 */

export type RoomProviderDecision = {
  readonly provider: string | null
  readonly license: string | null
  readonly decided: boolean
}

export const ROOM_PROVIDER_DECISION: RoomProviderDecision = {
  provider: null,
  license: null,
  decided: false,
}

export type RoomJoinRequest = {
  readonly roomId: string
  readonly actorId: string
  readonly guest?: boolean
  readonly recordingConsent?: boolean
  readonly callbackReplay?: boolean
}

export function joinRoom(
  request: RoomJoinRequest,
  authorizedGuests: readonly string[],
): { ok: false; reason: string } {
  if (!ROOM_PROVIDER_DECISION.decided) {
    return { ok: false, reason: 'sfu-undecided' }
  }
  if (request.guest && !authorizedGuests.includes(request.actorId)) {
    return { ok: false, reason: 'unauthorized-guest' }
  }
  if (request.callbackReplay) return { ok: false, reason: 'replayed-callback' }
  if (!request.recordingConsent) return { ok: false, reason: 'consent-required' }
  return { ok: false, reason: 'sfu-undecided' }
}

export function roomCapabilityEnabled(): false {
  return false
}
