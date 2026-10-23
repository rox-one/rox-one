/**
 * `@rox/shared/messenger-relay` — NIP-01 event primitives, kind constants and
 * the builders the workspace-service relay bridge signs with.
 *
 * The canonical id vector below is fixed by NIP-01; the round-trip and tamper
 * checks pin `signEvent` / `verifyEvent` to it.
 */

import { describe, expect, test } from 'bun:test'
import {
  buildCallServiceEvent,
  buildNip98AuthEvent,
  buildRelayAdminEvent,
  computeEventId,
  imTokenChallenge,
  isEventId,
  isPubkey,
  NOSTR_KIND_NIP98_AUTH,
  NOSTR_KIND_RELAY_ADMIN_ADD_MEMBER,
  NOSTR_KIND_RELAY_ADMIN_REMOVE_MEMBER,
  NOSTR_KIND_STREAM_MESSAGE,
  parseSecretKey,
  serializeEventForId,
  sha256Hex,
  schnorrPublicKey,
  signChallenge,
  signEvent,
  verifyChallenge,
  verifyEvent,
} from '../index.ts'

/** NIP-01 canonical example (the "Hello Nostr" event). */
const NIP01_EVENT = {
  pubkey: '82341f882b6eabcd2ba7f1ef90aad961cf074af15b9ef44a09f9d2a8fbfbe6a2',
  created_at: 1671217417,
  kind: 1,
  tags: [['p', '3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d']],
  content: 'Hello Nostr',
}
/** sha256(utf8(JSON.stringify([0,pubkey,created_at,kind,tags,content]))) for NIP01_EVENT. */
const NIP01_ID = '009d825c976bcdf5f25a56cc56537bd580830de399633a97ae33050461b53726'

/** 32-byte secret keys used across the suite (never a real key). */
const SECRET_A = '01'.repeat(32)
const SECRET_B = '02'.repeat(32)

describe('nip01 canonical serialization', () => {
  test('serializeEventForId matches JSON.stringify([0,pubkey,created_at,kind,tags,content])', () => {
    expect(serializeEventForId(NIP01_EVENT)).toBe(
      JSON.stringify([0, NIP01_EVENT.pubkey, NIP01_EVENT.created_at, NIP01_EVENT.kind, NIP01_EVENT.tags, NIP01_EVENT.content]),
    )
  })

  test('computeEventId is the sha256 hex of the serialization (independent recompute)', () => {
    expect(computeEventId(NIP01_EVENT)).toBe(sha256Hex(serializeEventForId(NIP01_EVENT)))
  })

  test('the NIP-01 id vector is pinned', () => {
    expect(computeEventId(NIP01_EVENT)).toBe(NIP01_ID)
  })

  test('id is a stable 64-hex digest committed to tag order and content', () => {
    const id = computeEventId(NIP01_EVENT)
    expect(id).toMatch(/^[0-9a-f]{64}$/)
    expect(computeEventId({ ...NIP01_EVENT, content: 'Hello Nostr!' })).not.toBe(id)
    expect(computeEventId({ ...NIP01_EVENT, created_at: NIP01_EVENT.created_at + 1 })).not.toBe(id)
    expect(computeEventId({ ...NIP01_EVENT, tags: [] })).not.toBe(id)
    expect(computeEventId({ ...NIP01_EVENT, kind: 2 })).not.toBe(id)
    expect(computeEventId({ ...NIP01_EVENT, pubkey: SECRET_B })).not.toBe(id)
  })
})

describe('signEvent / verifyEvent round-trip', () => {
  test('a signed event verifies and derives its pubkey from the secret key', () => {
    const unsigned = { ...NIP01_EVENT, pubkey: schnorrPublicKey(SECRET_A) }
    const event = signEvent(unsigned, SECRET_A)
    expect(event.pubkey).toBe(schnorrPublicKey(SECRET_A))
    expect(isPubkey(event.pubkey)).toBe(true)
    expect(isEventId(event.id)).toBe(true)
    expect(event.sig).toMatch(/^[0-9a-f]{128}$/)
    expect(event.id).toBe(computeEventId(unsigned))
    expect(verifyEvent(event)).toBe(true)
  })

  test('tampering with any committed field breaks verification', () => {
    const event = signEvent({ ...NIP01_EVENT, pubkey: schnorrPublicKey(SECRET_A) }, SECRET_A)
    expect(verifyEvent({ ...event, content: 'tampered' })).toBe(false)
    expect(verifyEvent({ ...event, created_at: event.created_at + 1 })).toBe(false)
    expect(verifyEvent({ ...event, tags: [] })).toBe(false)
    expect(verifyEvent({ ...event, id: SECRET_B })).toBe(false)
    // A signature made by a different key does not verify against this pubkey.
    const other = signEvent({ ...NIP01_EVENT, pubkey: schnorrPublicKey(SECRET_A), content: 'x' }, SECRET_B)
    expect(verifyEvent({ ...event, sig: other.sig })).toBe(false)
    expect(verifyEvent({ ...event, sig: 'not-hex' })).toBe(false)
  })
})

describe('kind constants and builders', () => {
  test('kind numbering matches the contract', () => {
    expect(NOSTR_KIND_STREAM_MESSAGE).toBe(9)
    expect(NOSTR_KIND_RELAY_ADMIN_ADD_MEMBER).toBe(9030)
    expect(NOSTR_KIND_RELAY_ADMIN_REMOVE_MEMBER).toBe(9031)
    expect(NOSTR_KIND_NIP98_AUTH).toBe(27235)
  })

  test('buildCallServiceEvent carries h / rox / rox-call-id tags and JSON content', () => {
    const event = buildCallServiceEvent({
      secretKey: SECRET_A,
      channelId: '3f2b0e5a-0000-4000-8000-000000000000',
      callId: 'call-1',
      content: { type: 'call.started', roomName: 'rox-ch-x' },
      createdAt: 1_700_000_000,
    })
    expect(event.kind).toBe(9)
    expect(event.created_at).toBe(1_700_000_000)
    expect(event.tags).toEqual([
      ['h', '3f2b0e5a-0000-4000-8000-000000000000'],
      ['rox', 'call'],
      ['rox-call-id', 'call-1'],
    ])
    expect(JSON.parse(event.content)).toEqual({ type: 'call.started', roomName: 'rox-ch-x' })
    expect(verifyEvent(event)).toBe(true)
  })

  test('buildRelayAdminEvent uses 9030 for add (with role) and 9031 for remove', () => {
    const pubkey = schnorrPublicKey(SECRET_B)
    const add = buildRelayAdminEvent({ secretKey: SECRET_A, action: 'add', pubkey, role: 'member' })
    expect(add.kind).toBe(9030)
    expect(add.tags).toEqual([['p', pubkey], ['role', 'member']])
    const remove = buildRelayAdminEvent({ secretKey: SECRET_A, action: 'remove', pubkey })
    expect(remove.kind).toBe(9031)
    expect(remove.tags).toEqual([['p', pubkey]])
    expect(verifyEvent(add)).toBe(true)
    expect(verifyEvent(remove)).toBe(true)
  })

  test('buildNip98AuthEvent commits to method and payload hash', () => {
    const body = JSON.stringify({ hello: 'world' })
    const event = buildNip98AuthEvent({
      secretKey: SECRET_A,
      url: 'https://chat.rox.one/api/events',
      method: 'post',
      payload: body,
    })
    expect(event.kind).toBe(27235)
    expect(event.tags).toEqual([
      ['u', 'https://chat.rox.one/api/events'],
      ['method', 'POST'],
      ['payload', sha256Hex(body)],
    ])
    expect(verifyEvent(event)).toBe(true)
  })
})

describe('token challenge proof', () => {
  test('the canonical challenge is newline-joined and deterministic', () => {
    expect(imTokenChallenge({ orgId: 'org-1', principalId: 'user-1', pubkey: 'ab'.repeat(32), issuedAt: 42 }))
      .toBe(`rox-im-token:v1\norg-1\nuser-1\n${'ab'.repeat(32)}\n42`)
  })

  test('a valid proof verifies; a tampered challenge or wrong pubkey does not', () => {
    const pubkey = schnorrPublicKey(SECRET_A)
    const challenge = imTokenChallenge({ orgId: 'org-1', principalId: 'user-1', pubkey, issuedAt: 1_700_000_000 })
    const proof = signChallenge(SECRET_A, challenge)
    expect(verifyChallenge(pubkey, challenge, proof)).toBe(true)
    expect(verifyChallenge(pubkey, challenge + 'x', proof)).toBe(false)
    expect(verifyChallenge(schnorrPublicKey(SECRET_B), challenge, proof)).toBe(false)
  })
})

describe('parseSecretKey', () => {
  test('accepts 64-char hex and rejects junk', () => {
    expect(parseSecretKey(SECRET_A)).toEqual(Uint8Array.from(Buffer.from(SECRET_A, 'hex')))
    expect(() => parseSecretKey('nope')).toThrow()
  })
})
