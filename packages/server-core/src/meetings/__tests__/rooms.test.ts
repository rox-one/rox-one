import { describe, expect, it } from 'bun:test'
import { joinRoom, ROOM_PROVIDER_DECISION, roomCapabilityEnabled } from '../rooms.ts'

describe('rooms (#389) fail-closed', () => {
  it('does not treat an undecided SFU as a live room', () => {
    expect(ROOM_PROVIDER_DECISION.decided).toBe(false)
    expect(roomCapabilityEnabled()).toBe(false)
    expect(joinRoom({ roomId: 'r1', actorId: 'guest-1', guest: true }, []).reason).toBe('sfu-undecided')
  })

  it('would deny unauthorized guests and replayed callbacks once a provider exists', () => {
    const unauthorized = joinRoom(
      { roomId: 'r1', actorId: 'intruder', guest: true, recordingConsent: true },
      ['friend'],
    )
    expect(unauthorized.ok).toBe(false)
    const replay = joinRoom(
      { roomId: 'r1', actorId: 'host', callbackReplay: true, recordingConsent: true },
      [],
    )
    expect(replay.reason).toBe('sfu-undecided')
  })
})
