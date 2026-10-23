import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  applyLiveKitWebhookEvent,
  channelIdFromCallRoomName,
  createTeamChatStore,
  signLiveKitWebhookAuth,
  teamCallRoomName,
  verifyLiveKitWebhook,
  LiveKitWebhookError,
  type TeamChatOrgDirectory,
} from '../index.ts'

const dirs: string[] = []
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

const ORG = 'org-1'
const roles: Record<string, 'owner' | 'member'> = { alice: 'owner', bob: 'member' }
const orgs: TeamChatOrgDirectory = {
  roleOf: (o, u) => (o === ORG ? roles[u] ?? null : null),
  memberIds: o => (o === ORG ? Object.keys(roles) : []),
}
const alice = { userId: 'alice' }, bob = { userId: 'bob' }

function store() {
  const dir = mkdtempSync(join(tmpdir(), 'lk-wh-'))
  dirs.push(dir)
  return createTeamChatStore({ path: join(dir, 'team-chat.json'), orgs })
}

describe('verifyLiveKitWebhook', () => {
  const key = 'APItestkey'
  const secret = 'secret-for-tests-only'
  it('accepts a correctly signed body and rejects tampering', () => {
    const body = JSON.stringify({ event: 'room_finished', id: 'evt-1', room: { name: 'rox-ch-abc' } })
    const auth = signLiveKitWebhookAuth(body, key, secret, { nowSeconds: 1_700_000_000 })
    const ev = verifyLiveKitWebhook(body, auth, key, secret, { nowSeconds: 1_700_000_000 })
    expect(ev.event).toBe('room_finished')
    expect(ev.room?.name).toBe('rox-ch-abc')
    expect(() => verifyLiveKitWebhook(body + ' ', auth, key, secret, { nowSeconds: 1_700_000_000 })).toThrow(LiveKitWebhookError)
    expect(() => verifyLiveKitWebhook(body, auth, 'other', secret, { nowSeconds: 1_700_000_000 })).toThrow(LiveKitWebhookError)
    expect(() => verifyLiveKitWebhook(body, undefined, key, secret)).toThrow(LiveKitWebhookError)
    expect(() => verifyLiveKitWebhook(body, auth, '', '')).toThrow(LiveKitWebhookError)
  })
  it('parses channel ids from contract room names', () => {
    expect(channelIdFromCallRoomName('rox-ch-general')).toBe('general')
    expect(channelIdFromCallRoomName('rox-th-x')).toBeNull()
  })
})

describe('LiveKit webhook ends a call when leave RPC is lost', () => {
  it('room_finished ends the active call and posts call.ended (+ transcript)', () => {
    const s = store()
    const general = s.listChannels(ORG, alice)[0]!
    const { call } = s.joinCall(general.id, alice)
    s.joinCall(general.id, bob)
    s.appendCallTranscript(general.id, call.id, [{ text: 'привет', startMs: 0, endMs: 500 }], alice)
    // Alice's leave RPC is lost; Bob disconnects without leave too — LiveKit closes the room.
    const result = applyLiveKitWebhookEvent(s, {
      event: 'room_finished',
      id: 'wh-1',
      room: { name: teamCallRoomName(general.id), numParticipants: 0 },
    })
    expect(result.ended).toBe(true)
    expect(result.channelId).toBe(general.id)
    expect(s.listChannels(ORG, alice)[0]!.activeCall).toBeUndefined()
    const messages = s.listMessages({ channelId: general.id }, alice).messages
    expect(messages.filter(m => m.kind === 'system').map(m => m.event)).toEqual(['call.started', 'call.ended'])
    expect(messages.some(m => m.kind === 'transcript')).toBe(true)
    // Idempotent redelivery
    expect(applyLiveKitWebhookEvent(s, {
      event: 'room_finished',
      id: 'wh-1-retry',
      room: { name: teamCallRoomName(general.id) },
    }).ended).toBe(false)
  })

  it('participant_left empties the roster and ends the call', () => {
    const s = store()
    const general = s.listChannels(ORG, alice)[0]!
    s.joinCall(general.id, alice)
    s.joinCall(general.id, bob)
    expect(applyLiveKitWebhookEvent(s, {
      event: 'participant_left',
      room: { name: teamCallRoomName(general.id) },
      participant: { identity: 'alice' },
    })).toMatchObject({ ended: false, applied: true })
    expect(s.listChannels(ORG, bob)[0]!.activeCall!.participantIds).toEqual(['bob'])
    expect(applyLiveKitWebhookEvent(s, {
      event: 'participant_left',
      room: { name: teamCallRoomName(general.id) },
      participant: { identity: 'bob' },
    }).ended).toBe(true)
    expect(s.listChannels(ORG, alice)[0]!.activeCall).toBeUndefined()
  })

  it('ignores unrelated rooms and events without ending anything', () => {
    const s = store()
    const general = s.listChannels(ORG, alice)[0]!
    s.joinCall(general.id, alice)
    expect(applyLiveKitWebhookEvent(s, {
      event: 'track_published',
      room: { name: teamCallRoomName(general.id) },
    }).applied).toBe(false)
    expect(applyLiveKitWebhookEvent(s, {
      event: 'room_finished',
      room: { name: 'rox-ch-other-room' },
    }).ended).toBe(false)
    expect(s.listChannels(ORG, alice)[0]!.activeCall).toBeTruthy()
  })
})
