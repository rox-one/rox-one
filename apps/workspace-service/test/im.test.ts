/**
 * W1-15 (#2042) — the `im` relay bridge: relay tokens (org membership + schnorr
 * proof), channel membership reads (guest scope), idempotent call service
 * events and presence passthrough.
 *
 * The relay is a fake (`createFakeImRelayClient`) and the repository/directory
 * are in-memory, so the suite is database-free.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import {
  imTokenChallenge,
  schnorrPublicKey,
  signChallenge,
  verifyEvent,
  NOSTR_KIND_RELAY_ADMIN_ADD_MEMBER,
  NOSTR_KIND_STREAM_MESSAGE,
  type NostrEvent,
} from '../../../packages/shared/src/messenger-relay/index.ts'
import type { AuthenticatedActor, SharedProjectAuthority } from '../../../packages/shared/src/workspace-domain/identity/contracts.ts'
import { ImService, createImMemberRevoker, imHttpAuthority, type ImFeedItem } from '../src/modules/im/service.ts'
import { InMemoryImDirectory, InMemoryImRepository } from '../src/modules/im/repository.ts'
import { createFakeImRelayClient, type FakeImRelayClient, type ImRelayConfig } from '../src/modules/im/relay-client.ts'
import { actor, fakeResolver, request, serve, type TestServer } from './helpers.ts'

const ORG = '11111111-1111-4111-8111-111111111111'
const CHANNEL = '22222222-2222-4222-8222-222222222222'
const GUEST_CHANNEL = '33333333-3333-4333-8333-333333333333'
const PRIVATE_CHANNEL = '55555555-5555-4555-8555-555555555555'
const OTHER = '44444444-4444-4444-8444-444444444444'

/** Deterministic clock so a proof's `issuedAt` is inside the ±5 min window. */
const NOW = 1_700_000_000_000
const SERVICE_SECRET = '04'.repeat(32)
const DEVICE_SECRET = '03'.repeat(32)
const DEVICE_PUBKEY = schnorrPublicKey(DEVICE_SECRET)

const CONFIG: ImRelayConfig = { relayUrl: 'https://relay.example/api', secretKey: SERVICE_SECRET, tokenTtlSeconds: 300 }

const unusedAuthority = new Proxy({}, { get: () => () => { throw new Error('not used') } }) as SharedProjectAuthority

/** Test-only read of an unknown JSON body: throws unless it is a JSON object. */
function expectObject(body: unknown): Record<string, unknown> {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new Error('expected a JSON object body')
  return body as Record<string, unknown>
}

function errorCode(body: unknown): unknown {
  const error = expectObject(body).error
  return error !== null && typeof error === 'object' && !Array.isArray(error) ? (error as Record<string, unknown>).code : undefined
}

const closers: Array<() => Promise<void> | void> = []
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close()
})

interface Harness {
  server: TestServer
  repository: InMemoryImRepository
  directory: InMemoryImDirectory
  relay: FakeImRelayClient
  feed: ImFeedItem[]
  state: { actor: AuthenticatedActor | null }
}

async function harness(principalId = randomUUID()): Promise<Harness> {
  const repository = new InMemoryImRepository(() => new Date(NOW))
  const directory = new InMemoryImDirectory()
  const relay = createFakeImRelayClient()
  const feed: ImFeedItem[] = []
  directory.setOrgMember(ORG, principalId, { role: 'member', guest: false })
  directory.setOrgMember(ORG, OTHER, { role: 'member', guest: false })
  for (const [channel, guest] of [[CHANNEL, false], [GUEST_CHANNEL, true]] as const) {
    directory.addChannel(channel, ORG)
    directory.setChannelMember(channel, principalId, { role: 'member', guest })
    directory.setChannelMember(channel, OTHER, { role: 'member', guest: false })
  }
  // PRIVATE_CHANNEL: the actor is deliberately *not* a member.
  directory.addChannel(PRIVATE_CHANNEL, ORG)
  directory.setChannelMember(PRIVATE_CHANNEL, OTHER, { role: 'member', guest: false })
  const service = new ImService({
    repository,
    directory,
    relay,
    config: CONFIG,
    feed: item => { feed.push(item) },
    now: () => new Date(NOW),
  })
  const { resolver, state } = fakeResolver(actor([ORG], principalId))
  const server = await serve({ authority: unusedAuthority, actorResolver: resolver, im: imHttpAuthority(service) })
  closers.push(server.close)
  return { server, repository, directory, relay, feed, state }
}

function tokenBody(principalId: string, issuedAt = NOW, orgId: string | undefined = ORG) {
  const challenge = imTokenChallenge({ orgId: orgId ?? '', principalId, pubkey: DEVICE_PUBKEY, issuedAt })
  return {
    pubkey: DEVICE_PUBKEY,
    proof: signChallenge(DEVICE_SECRET, challenge),
    issuedAt,
    ...(orgId === undefined ? {} : { orgId }),
  }
}

describe('POST /v1/im/token', () => {
  test('upserts the identity and adds the relay member', async () => {
    const h = await harness()
    const principalId = h.state.actor!.principalId
    const result = await request(h.server.url, '/v1/im/token', { method: 'POST', body: tokenBody(principalId) })
    expect(result.status).toBe(200)
    const body = expectObject(result.body)
    expect(body.relayUrl).toBe(CONFIG.relayUrl)
    expect(body.pubkey).toBe(DEVICE_PUBKEY)
    expect(body.expiresAt).toBe(new Date(NOW + 300_000).toISOString())
    const authEvent = body.authEvent as NostrEvent
    expect(verifyEvent(authEvent)).toBe(true)
    expect(authEvent.kind).toBe(NOSTR_KIND_RELAY_ADMIN_ADD_MEMBER)
    // identity persisted + relay membership added
    expect((await h.repository.findIdentity(principalId))?.pubkey).toBe(DEVICE_PUBKEY)
    expect(h.relay.members).toContain(DEVICE_PUBKEY)
  })

  test('requires rox org membership (non-member → 403)', async () => {
    const h = await harness()
    const outsider = randomUUID()
    h.state.actor = actor([ORG], outsider)
    const result = await request(h.server.url, '/v1/im/token', { method: 'POST', body: tokenBody(outsider) })
    expect(result.status).toBe(403)
    expect(errorCode(result.body)).toBe('FORBIDDEN')
  })

  test('rejects a bad schnorr proof (401) and malformed fields (400)', async () => {
    const h = await harness()
    const principalId = h.state.actor!.principalId
    const valid = tokenBody(principalId)
    // Valid shape, proof signed by the wrong key.
    const wrong = { ...valid, proof: signChallenge('05'.repeat(32), imTokenChallenge({ orgId: ORG, principalId, pubkey: DEVICE_PUBKEY, issuedAt: NOW })) }
    expect((await request(h.server.url, '/v1/im/token', { method: 'POST', body: wrong })).status).toBe(401)
    expect((await request(h.server.url, '/v1/im/token', { method: 'POST', body: { ...valid, pubkey: 'nope' } })).status).toBe(400)
    // Stale proof outside the ±5 min window.
    const stale = tokenBody(principalId, NOW - 10 * 60 * 1000)
    expect((await request(h.server.url, '/v1/im/token', { method: 'POST', body: stale })).status).toBe(401)
  })

  test('a relay outage is reported as 502 RELAY_UNAVAILABLE', async () => {
    const h = await harness()
    h.relay.failWith = new Error('down')
    const result = await request(h.server.url, '/v1/im/token', { method: 'POST', body: tokenBody(h.state.actor!.principalId) })
    expect(result.status).toBe(502)
    expect(errorCode(result.body)).toBe('RELAY_UNAVAILABLE')
  })
})

describe('GET /v1/im/channels/:channelId/members/:userId', () => {
  test('returns the role for a member', async () => {
    const h = await harness()
    const result = await request(h.server.url, `/v1/im/channels/${CHANNEL}/members/${OTHER}`, { method: 'GET' })
    expect(result.status).toBe(200)
    expect(result.body).toEqual({ role: 'member' })
  })

  test('404 for a user who is not a channel member', async () => {
    const h = await harness()
    const result = await request(h.server.url, `/v1/im/channels/${CHANNEL}/members/${randomUUID()}`, { method: 'GET' })
    expect(result.status).toBe(404)
    expect(errorCode(result.body)).toBe('NOT_FOUND')
  })

  test('403 when the caller is not a member of the channel (guest scope)', async () => {
    const guest = randomUUID()
    const h = await harness(guest)
    // The guest is a member of GUEST_CHANNEL only.
    expect((await request(h.server.url, `/v1/im/channels/${GUEST_CHANNEL}/members/${OTHER}`, { method: 'GET' })).status).toBe(200)
    const forbidden = await request(h.server.url, `/v1/im/channels/${PRIVATE_CHANNEL}/members/${OTHER}`, { method: 'GET' })
    expect(forbidden.status).toBe(403)
    expect(errorCode(forbidden.body)).toBe('FORBIDDEN')
  })

  test('unknown channel is 404', async () => {
    const h = await harness()
    expect((await request(h.server.url, `/v1/im/channels/${randomUUID()}/members/${OTHER}`, { method: 'GET' })).status).toBe(404)
  })
})

describe('POST /v1/im/channels/:channelId/service-events', () => {
  test('publishes a signed kind-9 event, emits a feed item, and is idempotent', async () => {
    const h = await harness()
    const body = { type: 'call.started', callId: 'call-1', roomName: 'rox-ch-' + CHANNEL, ts: NOW }
    const first = await request(h.server.url, `/v1/im/channels/${CHANNEL}/service-events`, { method: 'POST', body })
    expect(first.status).toBe(201)
    const eventId = expectObject(first.body).eventId
    expect(eventId).toMatch(/^[0-9a-f]{64}$/)
    // Exactly one call event published, and it verifies + carries the channel/call tags.
    const callEvents = h.relay.published.filter(event => event.kind === NOSTR_KIND_STREAM_MESSAGE)
    expect(callEvents).toHaveLength(1)
    expect(verifyEvent(callEvents[0]!)).toBe(true)
    expect(callEvents[0]!.tags).toEqual([['h', CHANNEL], ['rox', 'call'], ['rox-call-id', 'call-1']])
    expect(h.feed).toHaveLength(1)
    expect(h.feed[0]).toMatchObject({ source: 'messenger', orgId: ORG, channelId: CHANNEL, kind: 'call.started', callId: 'call-1' })
    // Repeat → 200 with the same eventId, no second publish, no second feed item.
    const repeat = await request(h.server.url, `/v1/im/channels/${CHANNEL}/service-events`, { method: 'POST', body })
    expect(repeat.status).toBe(200)
    expect(expectObject(repeat.body).eventId).toBe(eventId)
    expect(h.relay.published.filter(event => event.kind === NOSTR_KIND_STREAM_MESSAGE)).toHaveLength(1)
    expect(h.feed).toHaveLength(1)
  })

  test('rejects an unknown type and a non-member actor', async () => {
    const h = await harness()
    const bad = await request(h.server.url, `/v1/im/channels/${CHANNEL}/service-events`, { method: 'POST', body: { type: 'call.nope', callId: 'x' } })
    expect(bad.status).toBe(400)
    expect(errorCode(bad.body)).toBe('INVALID')

    const guest = randomUUID()
    const g = await harness(guest)
    const forbidden = await request(g.server.url, `/v1/im/channels/${PRIVATE_CHANNEL}/service-events`, { method: 'POST', body: { type: 'call.started', callId: 'x' } })
    expect(forbidden.status).toBe(403)
  })

  test('unknown channel is 404 and a relay outage is 502', async () => {
    const h = await harness()
    expect((await request(h.server.url, `/v1/im/channels/${randomUUID()}/service-events`, { method: 'POST', body: { type: 'call.started', callId: 'x' } })).status).toBe(404)
    h.relay.failWith = new Error('down')
    const outage = await request(h.server.url, `/v1/im/channels/${CHANNEL}/service-events`, { method: 'POST', body: { type: 'call.started', callId: 'call-2' } })
    expect(outage.status).toBe(502)
    expect(errorCode(outage.body)).toBe('RELAY_UNAVAILABLE')
  })

  test('a call.ended event carries duration and participants', async () => {
    const h = await harness()
    const result = await request(h.server.url, `/v1/im/channels/${CHANNEL}/service-events`, {
      method: 'POST',
      body: { type: 'call.ended', callId: 'call-3', durationSec: 42, participants: [OTHER] },
    })
    expect(result.status).toBe(201)
    const event = h.relay.published.find(e => e.kind === NOSTR_KIND_STREAM_MESSAGE)!
    expect(JSON.parse(event.content)).toMatchObject({ type: 'call.ended', durationSec: 42, participants: [OTHER] })
  })
})

describe('GET /v1/im/presence', () => {
  test('passes through presence only for shared-org peers', async () => {
    const h = await harness()
    const stranger = randomUUID()
    h.relay.presenceResult = [
      { userId: OTHER, status: 'online', lastSeenAt: '2026-10-14T00:00:00.000Z' },
      { userId: stranger, status: 'online', lastSeenAt: '2026-10-14T00:00:00.000Z' },
    ]
    const result = await request(h.server.url, `/v1/im/presence?userIds=${OTHER},${stranger}`, { method: 'GET' })
    expect(result.status).toBe(200)
    // Stranger is filtered before the relay call; fake relay returns its full list for allowed ids only.
    expect(result.body).toEqual([{ userId: OTHER, status: 'online', lastSeenAt: '2026-10-14T00:00:00.000Z' }])
  })

  test('missing userIds is 400', async () => {
    const h = await harness()
    expect((await request(h.server.url, '/v1/im/presence', { method: 'GET' })).status).toBe(400)
  })
})

describe('lifecycle', () => {
  test('routes answer 404 when the module is not configured', async () => {
    const { resolver } = fakeResolver(actor([ORG]))
    const server = await serve({ authority: unusedAuthority, actorResolver: resolver })
    closers.push(server.close)
    expect((await request(server.url, '/v1/im/presence?userIds=' + OTHER, { method: 'GET' })).status).toBe(404)
  })

  test('expired identities are revoked on the next token issuance', async () => {
    const repository = new InMemoryImRepository(() => new Date(NOW))
    const directory = new InMemoryImDirectory()
    const relay = createFakeImRelayClient()
    const principalId = randomUUID()
    directory.setOrgMember(ORG, principalId, { role: 'member', guest: false })
    await repository.upsertIdentity(principalId, DEVICE_PUBKEY, new Date(NOW - 1_000).toISOString())
    relay.members.push(DEVICE_PUBKEY)
    const service = new ImService({
      repository, directory, relay, config: CONFIG, now: () => new Date(NOW),
    })
    expect(await service.revokeExpiredMembers()).toBe(1)
    expect(await repository.findIdentity(principalId)).toBeNull()
    expect(relay.members).not.toContain(DEVICE_PUBKEY)
  })

  test('the removal hook deletes the identity and revokes relay membership', async () => {
    const h = await harness()
    const principalId = h.state.actor!.principalId
    await request(h.server.url, '/v1/im/token', { method: 'POST', body: tokenBody(principalId) })
    const revoker = createImMemberRevoker({ repository: h.repository, relay: h.relay })
    expect(await revoker.revoke(principalId)).toEqual({ revoked: true, pubkey: DEVICE_PUBKEY })
    expect(await h.repository.findIdentity(principalId)).toBeNull()
    expect(h.relay.members).not.toContain(DEVICE_PUBKEY)
    expect(await revoker.revoke(principalId)).toEqual({ revoked: false, pubkey: null })
  })
})
