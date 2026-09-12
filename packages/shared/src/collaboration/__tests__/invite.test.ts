import { describe, expect, it } from 'bun:test'
import {
  BRO_INVITE_HOST,
  BroInviteStore,
  buildInviteUrl,
  parseInviteUrl,
  slugifyUsername,
} from '../index.ts'
import type { RoxAccount } from '../invite.ts'

const owner: RoxAccount = {
  accountId: 'acc_owner',
  username: 'Ada Lovelace',
  displayName: 'Ada',
}

const joiner: RoxAccount = {
  accountId: 'acc_joiner',
  username: 'bro-two',
  displayName: 'Bro Two',
}

function sequentialBytes(seed = 1) {
  let n = seed
  return (len: number) => {
    const out = new Uint8Array(len)
    for (let i = 0; i < len; i++) {
      out[i] = (n + i) & 0xff
    }
    n += 1
    return out
  }
}

describe('invite URL', () => {
  it('builds bro.rox.one/@username/{sessionId}/{joinKey}', () => {
    const url = buildInviteUrl('Ada Lovelace', 'sess-1', 'ab'.repeat(16))
    expect(url).toBe(`https://${BRO_INVITE_HOST}/@ada-lovelace/sess-1/${'ab'.repeat(16)}`)
    expect(parseInviteUrl(url)).toEqual({
      username: 'ada-lovelace',
      sessionId: 'sess-1',
      joinKey: 'ab'.repeat(16),
    })
  })

  it('rejects http, wrong host, and malformed keys', () => {
    expect(parseInviteUrl('http://bro.rox.one/@ada/sess-1/' + 'ab'.repeat(16))).toBeNull()
    expect(parseInviteUrl('https://evil.example/@ada/sess-1/' + 'ab'.repeat(16))).toBeNull()
    expect(parseInviteUrl(`https://${BRO_INVITE_HOST}/ada/sess-1/${'ab'.repeat(16)}`)).toBeNull()
    expect(parseInviteUrl(`https://${BRO_INVITE_HOST}/@ada/sess-1/short`)).toBeNull()
  })

  it('slugifies email local-parts', () => {
    expect(slugifyUsername('ada@rox.one')).toBe('ada')
  })
})

describe('Позвать Бро invite store', () => {
  it('lets an authenticated user join once before expiry', () => {
    let now = 1_000
    const store = new BroInviteStore(() => now, sequentialBytes())
    const card = store.createInvite({ sessionId: 'sess-1', owner })
    expect(card.kind).toBe('collaboration')
    expect(card.url).toContain(`https://${BRO_INVITE_HOST}/@ada-lovelace/sess-1/`)
    expect(card.contactShareText).toContain(card.url)
    expect(card.qrPayload).toBe(card.url)

    const joined = store.join(card.url, joiner)
    expect(joined).toEqual({
      ok: true,
      sessionId: 'sess-1',
      role: 'editor',
      accountId: 'acc_joiner',
    })
    const presence = store.listPresence('sess-1')
    expect(presence.map((m) => m.accountId)).toEqual(['acc_owner', 'acc_joiner'])
    expect(presence[1]?.role).toBe('editor')
  })

  it('denies reused, revoked, and expired keys', () => {
    let now = 1_000
    const store = new BroInviteStore(() => now, sequentialBytes())
    const card = store.createInvite({ sessionId: 'sess-1', owner, ttlMs: 10_000 })

    expect(store.join(card.url, joiner).ok).toBe(true)
    expect(store.join(card.url, { ...joiner, accountId: 'acc_other' })).toEqual({
      ok: false,
      error: 'reused',
    })

    const second = store.createInvite({ sessionId: 'sess-1', owner, ttlMs: 10_000 })
    const joinKey = parseInviteUrl(second.url)!.joinKey
    expect(store.revoke(joinKey, owner.accountId)).toBe(true)
    expect(store.join(second.url, joiner)).toEqual({ ok: false, error: 'revoked' })

    const third = store.createInvite({ sessionId: 'sess-1', owner, ttlMs: 10_000 })
    now += 10_001
    expect(store.join(third.url, joiner)).toEqual({ ok: false, error: 'expired' })
  })

  it('requires a Rox account before granting session access', () => {
    const store = new BroInviteStore(() => 1, sequentialBytes())
    const card = store.createInvite({ sessionId: 'sess-1', owner })
    expect(store.join(card.url, null)).toEqual({ ok: false, error: 'membership_required' })
  })

  it('does not let a non-owner revoke, and a revoked key stays dead', () => {
    const store = new BroInviteStore(() => 1, sequentialBytes())
    const card = store.createInvite({ sessionId: 'sess-1', owner })
    const joinKey = parseInviteUrl(card.url)!.joinKey
    expect(store.revoke(joinKey, joiner.accountId)).toBe(false)
    expect(store.revoke('missing', owner.accountId)).toBe(false)
    expect(store.revoke(joinKey, owner.accountId)).toBe(true)
    expect(store.join(card.url, joiner)).toEqual({ ok: false, error: 'revoked' })
  })
})
