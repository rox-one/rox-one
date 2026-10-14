import { afterEach, describe, expect, it } from 'bun:test'
import { createHmac } from 'crypto'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createTeamChatStore, mintLiveKitToken, teamCallRoomName, toMessengerCallEvent, type TeamChatOrgDirectory } from '../index.ts'

const dirs: string[] = []
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })
const ORG = 'org-1'
const roles: Record<string, 'owner' | 'member'> = { alice: 'owner', bob: 'member', carol: 'member' }
const orgs: TeamChatOrgDirectory = { roleOf: (o, u) => (o === ORG ? roles[u] ?? null : null), memberIds: o => (o === ORG ? Object.keys(roles) : []) }
function store() {
  const dir = mkdtempSync(join(tmpdir(), 'team-calls-')); dirs.push(dir)
  return createTeamChatStore({ path: join(dir, 'team-chat.json'), orgs })
}
const alice = { userId: 'alice' }, bob = { userId: 'bob' }, carol = { userId: 'carol' }

describe('team calls', () => {
  it('start, join, leave: call state on the channel, transcript posted at the end, searchable', () => {
    const s = store()
    const general = s.listChannels(ORG, alice)[0]!
    const a = s.joinCall(general.id, alice)
    expect(a.started).toBe(true)
    expect(a.call.roomName).toBe(teamCallRoomName(general.id))
    const b = s.joinCall(general.id, bob)
    expect(b.started).toBe(false)
    expect(b.call.id).toBe(a.call.id)
    expect(s.listChannels(ORG, carol)[0]!.activeCall?.participantIds.sort()).toEqual(['alice', 'bob'])
    s.appendCallTranscript(general.id, a.call.id, [
      { speakerId: 'alice', speakerName: 'Марк', text: 'Обсудим релиз звонков', startMs: 1000, endMs: 4000 },
      { speakerId: 'alice', text: '', startMs: 0, endMs: 1 },
    ], alice)
    s.appendCallTranscript(general.id, a.call.id, [{ speakerId: 'alice', speakerName: 'Анна', text: 'Тесты закончим к пятнице', startMs: 9000, endMs: 12000 }], bob)
    // A segment can't be attributed to someone else.
    expect(s.listChannels(ORG, alice)[0]!.activeCall).toMatchObject({ transcript: [], transcriptSegments: 2 })
    // Non-members can't be injected into the participant list.
    s.syncCallParticipants(general.id, ['alice', 'bob', 'mallory'], alice)
    expect(s.listChannels(ORG, alice)[0]!.activeCall!.participantIds.sort()).toEqual(['alice', 'bob'])
    expect(s.leaveCall(general.id, alice).ended).toBe(false)
    expect(s.leaveCall(general.id, bob).ended).toBe(true)
    expect(s.listChannels(ORG, alice)[0]!.activeCall).toBeUndefined()
    const { messages } = s.listMessages({ channelId: general.id }, alice)
    const transcript = messages.find(m => m.kind === 'transcript')!
    expect(transcript.text).toBe('[00:01] Марк: Обсудим релиз звонков\n[00:09] Анна: Тесты закончим к пятнице')
    expect(transcript).not.toHaveProperty('segments')
    expect(messages.filter(m => m.kind === 'system').map(m => m.event)).toEqual(['call.started', 'call.ended'])
    expect(a.call.roomName).toBe(`rox-ch-${general.id}`)
    const ended = s.listCalls(general.id, alice)[0]!
    const events = messages.map(m => toMessengerCallEvent(m, ended)?.type)
    expect(events).toEqual(['call.started', 'call.ended', 'call.transcript'])
    expect(toMessengerCallEvent(messages.find(m => m.event === 'call.ended')!, ended)).toMatchObject({ participants: ['alice', 'bob'] })
    expect(s.postCallSummary(general.id, a.call.id, '- Релиз на этой неделе', alice).message?.kind).toBe('summary')
    expect(s.postCallSummary(general.id, a.call.id, 'again', alice).message).toBeNull()
    expect(s.searchMessages(ORG, 'пятниц', carol).map(m => m.kind)).toEqual(['transcript'])
    expect(s.searchMessages(ORG, 'релиз', carol).map(m => m.kind).sort()).toEqual(['summary', 'transcript'])
  })

  it('call access = channel membership; leaving the channel drops you from the call', () => {
    const s = store()
    const priv = s.createChannel({ orgId: ORG, kind: 'group', name: 'core', memberIds: ['bob'] } as never, alice)
    expect(() => s.joinCall(priv.id, carol)).toThrow()
    s.joinCall(priv.id, bob)
    s.leaveChannel(priv.id, bob)
    expect(s.listCalls(priv.id, alice)[0]!.endedAt).toBeDefined()
  })
})

describe('mintLiveKitToken', () => {
  it('produces an HS256 JWT with the LiveKit room grant', () => {
    const t = mintLiveKitToken({ apiKey: 'k', apiSecret: 's', identity: 'alice', name: 'Марк', room: 'rox-c1', nowSeconds: 1000 })
    const [h, p, sig] = t.split('.')
    expect(createHmac('sha256', 's').update(`${h}.${p}`).digest('base64url')).toBe(sig!)
    const claims = JSON.parse(Buffer.from(p!, 'base64url').toString())
    expect(claims).toMatchObject({ iss: 'k', sub: 'alice', name: 'Марк', exp: 1600, video: { room: 'rox-c1', roomJoin: true, canPublish: true } })
  })
  it('refuses to mint without credentials', () => {
    expect(() => mintLiveKitToken({ apiKey: '', apiSecret: '', identity: 'a', room: 'r' })).toThrow()
  })
})

describe('summarizeCall', () => {
  it('falls back from R1 Max to DeepSeek V4.1 Flash and never sends empty transcripts', async () => {
    const { summarizeCall } = await import('../index.ts')
    const seen: string[] = []
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      const model = JSON.parse(String(init.body)).model as string
      seen.push(model)
      if (model === 'rox/r1-max') return new Response('nope', { status: 404 })
      return Response.json({ choices: [{ message: { content: '- Релиз на этой неделе' } }] })
    }) as unknown as typeof fetch
    const segments = [{ speakerId: 'a', speakerName: 'Марк', text: 'Релиз на этой неделе', startMs: 0, endMs: 1000 }]
    expect(await summarizeCall({ segments, baseUrl: 'https://api.rox.one/v1/', apiKey: 'k', fetchImpl })).toEqual({ model: 'rox/deepseek-v4.1-flash', text: '- Релиз на этой неделе' })
    expect(seen).toEqual(['rox/r1-max', 'rox/deepseek-v4.1-flash'])
    expect(await summarizeCall({ segments: [], baseUrl: 'x', apiKey: 'k', fetchImpl })).toBeNull()
  })

  it('system summary is posted once, only for ended calls', () => {
    const s = store()
    const general = s.listChannels(ORG, alice)[0]!
    const { call } = s.joinCall(general.id, alice)
    expect(s.postCallSummaryAsSystem(general.id, call.id, 'x')).toBe(false)
    s.leaveCall(general.id, alice)
    expect(s.postCallSummaryAsSystem(general.id, call.id, 'итог')).toBe(true)
    expect(s.postCallSummaryAsSystem(general.id, call.id, 'итог')).toBe(false)
  })
})
