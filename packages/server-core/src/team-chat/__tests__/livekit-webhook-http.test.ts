import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  createTeamChatStore,
  setBuiltinCallCredentials,
  signLiveKitWebhookAuth,
  teamCallRoomName,
  type TeamChatOrgDirectory,
} from '@rox/shared/team-chat'
import { createLiveKitWebhookHttpIngress } from '../livekit-webhook-http.ts'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  setBuiltinCallCredentials({ livekitUrl: '', livekitApiKey: '', livekitApiSecret: '' })
})

const ORG = 'org-1'
const orgs: TeamChatOrgDirectory = {
  roleOf: (o, u) => (o === ORG && (u === 'alice' || u === 'bob') ? 'member' : null),
  memberIds: o => (o === ORG ? ['alice', 'bob'] : []),
}

describe('createLiveKitWebhookHttpIngress', () => {
  it('ends a call on a verified room_finished POST', async () => {
    setBuiltinCallCredentials({ livekitUrl: 'http://lk', livekitApiKey: 'k', livekitApiSecret: 's' })
    const dir = mkdtempSync(join(tmpdir(), 'lk-http-'))
    dirs.push(dir)
    const store = createTeamChatStore({ path: join(dir, 'team-chat.json'), orgs })
    const general = store.listChannels(ORG, { userId: 'alice' })[0]!
    store.joinCall(general.id, { userId: 'alice' })
    const ended: string[] = []
    const ingress = createLiveKitWebhookHttpIngress({
      getStore: () => store,
      onCallEnded: ({ channelId }) => { ended.push(channelId) },
    })
    const body = JSON.stringify({
      event: 'room_finished',
      id: 'e1',
      room: { name: teamCallRoomName(general.id) },
    })
    const auth = signLiveKitWebhookAuth(body, 'k', 's')
    const res = await ingress.handle(new Request('http://127.0.0.1/livekit/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/webhook+json', authorization: auth },
      body,
    }))
    expect(res?.status).toBe(200)
    const json = await res!.json() as { ended: boolean }
    expect(json.ended).toBe(true)
    expect(ended).toEqual([general.id])
    expect(store.listChannels(ORG, { userId: 'alice' })[0]!.activeCall).toBeUndefined()
  })

  it('rejects a forged Authorization header', async () => {
    setBuiltinCallCredentials({ livekitUrl: 'http://lk', livekitApiKey: 'k', livekitApiSecret: 's' })
    const dir = mkdtempSync(join(tmpdir(), 'lk-http-'))
    dirs.push(dir)
    const store = createTeamChatStore({ path: join(dir, 'team-chat.json'), orgs })
    const ingress = createLiveKitWebhookHttpIngress({ getStore: () => store })
    const body = JSON.stringify({ event: 'room_finished', room: { name: 'rox-ch-x' } })
    const res = await ingress.handle(new Request('http://127.0.0.1/livekit/webhook', {
      method: 'POST',
      headers: { authorization: 'not.a.jwt' },
      body,
    }))
    expect(res?.status).toBe(401)
  })
})
