import { describe, expect, it } from 'bun:test'
import { createRoxIdClient, microusdToFixed, parseAccount, toSnapshot, type RoxIdTransport } from '../rox-id-client.ts'

type Reply = { status: number; body: unknown }
function transport(replies: Reply[], seen: Array<{ url: string; init: RequestInit }> = []): RoxIdTransport {
  return {
    baseUrl: () => 'https://api.rox.one/id/v1',
    fetch: (async (url: string, init: RequestInit) => {
      seen.push({ url, init })
      const r = replies.shift()
      if (!r) throw new Error('no reply')
      return new Response(JSON.stringify(r.body), { status: r.status })
    }),
  }
}
const account = {
  id: 'acc', email: 'm@x', name: 'Mark', handle: 'mark', handleAddress: 'mark@rox.one', createdAt: '2026-10-14T00:00:00Z',
  balance: { currency: 'USD', availableUsd: 1, availableMicrousd: 1_000_000, grantedUsd: 1, spentUsd: 0, exhausted: false },
  provider: { id: 'rox-cloud', baseUrl: 'https://api.rox.one/v1', defaultModel: 'deepseek-v4.1-flash', defaultModelName: 'DeepSeek V4.1 Flash', apiKeyId: 'k1', apiKeyPrefix: 'ROX_abcd', suspended: false, apiKey: 'ROX_SECRET' },
}

describe('rox-id client', () => {
  it('maps micro-USD exactly', () => {
    expect(microusdToFixed(1_000_000)).toBe('1.000000')
    expect(microusdToFixed(1_234)).toBe('0.001234')
    expect(microusdToFixed(-5)).toBe('0.000000')
  })
  it('never carries the plaintext key on the account projection', () => {
    const parsed = parseAccount(account)
    expect(JSON.stringify(parsed)).not.toContain('ROX_SECRET')
    const snap = toSnapshot(parsed)
    expect(snap.state).toBe('ready')
    expect(snap.balance.availableRox).toBe('1.000000')
    expect(snap.key).toEqual({ id: 'k1', prefix: 'ROX_abcd', generation: 1, status: 'active' })
  })
  it('exhausted balance suspends the key and flags it', () => {
    const snap = toSnapshot(parseAccount({ ...account, balance: { ...account.balance, availableMicrousd: 0, exhausted: true } }))
    expect(snap.key?.status).toBe('suspended')
    expect(snap.errorCode).toBe('ROX_BALANCE_EXHAUSTED')
  })
  it('device start validates the passkey verification host', async () => {
    const ok = createRoxIdClient(transport([{ status: 200, body: { device_code: 'd', user_code: 'ABCD-EFGH', verification_uri: 'https://id.rox.one/device', verification_uri_complete: 'https://id.rox.one/device?user_code=ABCD-EFGH', expires_in: 600, interval: 5 } }]))
    const { started } = await ok.start(new AbortController().signal)
    expect(started.userCode).toBe('ABCD-EFGH')
    const bad = createRoxIdClient(transport([{ status: 200, body: { device_code: 'd', user_code: 'u', verification_uri: 'https://evil.example/device', expires_in: 600 } }]))
    await expect(bad.start(new AbortController().signal)).rejects.toThrow('ROX_AUTH_INVALID_RESPONSE')
  })
  it('polls through 428 pending and returns the session approval', async () => {
    const c = createRoxIdClient(transport([
      { status: 428, body: { error: 'authorization_pending' } },
      { status: 200, body: { session: { token: 'rxs_t', id: 'sid', expiresAt: new Date(Date.now() + 86_400_000).toISOString() }, isNewAccount: true, account } },
    ]))
    const approval = await c.wait('d', { codeVerifier: '', redemptionId: '' }, { timeoutMs: 10_000, interval: 0.01, signal: new AbortController().signal })
    expect(approval.accessToken).toBe('rxs_t')
    expect(approval.refreshToken).toBe('sid')
    expect(approval.user.id).toBe('acc')
  })
  it('stops on access_denied', async () => {
    const c = createRoxIdClient(transport([{ status: 400, body: { error: 'access_denied' } }]))
    await expect(c.wait('d', { codeVerifier: '', redemptionId: '' }, { timeoutMs: 5_000, interval: 0.01, signal: new AbortController().signal })).rejects.toThrow('ROX_CONNECT_DENIED')
  })
  it('refresh always forces re-login; 401 maps to ROX_AUTH_EXPIRED', async () => {
    const c = createRoxIdClient(transport([{ status: 401, body: { error: 'session_revoked' } }]))
    await expect(c.refresh('x', 'y')).rejects.toThrow('ROX_AUTH_EXPIRED')
    await expect(c.account('rxs')).rejects.toThrow('ROX_AUTH_EXPIRED')
  })
  it('credential reveals the per-user key bound to the snapshot key id', async () => {
    const seen: Array<{ url: string; init: RequestInit }> = []
    const c = createRoxIdClient(transport([{ status: 200, body: { apiKeyId: 'k1', apiKey: 'ROX_SECRET', prefix: 'ROX_abcd', baseUrl: 'https://api.rox.one/v1', defaultModel: 'deepseek-v4.1-flash' } }], seen))
    const cred = await c.credential('rxs', toSnapshot(parseAccount(account)))
    expect(cred.apiKey).toBe('ROX_SECRET')
    expect(seen[0]!.url).toBe('https://api.rox.one/id/v1/me/api-key/reveal')
    expect((seen[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer rxs')
  })
  it('sessions, revoke and handle', async () => {
    const seen: Array<{ url: string; init: RequestInit }> = []
    const c = createRoxIdClient(transport([
      { status: 200, body: { sessions: [{ id: 's1', deviceName: 'Mac', platform: 'darwin', kind: 'device', createdAt: 'a', lastSeenAt: 'b', current: true }, { bogus: 1 }] } },
      { status: 200, body: { ok: true } },
      { status: 200, body: { ok: true, revoked: 2 } },
      { status: 409, body: { error: 'handle_taken' } },
      { status: 200, body: { handle: 'x', available: false, valid: false } },
    ], seen))
    expect((await c.sessions('t')).map((s) => s.id)).toEqual(['s1'])
    await c.revokeSession('t', 's/1')
    expect(seen[1]!.url).toBe('https://api.rox.one/id/v1/me/sessions/s%2F1')
    expect(seen[1]!.init.method).toBe('DELETE')
    expect(await c.revokeOtherSessions('t')).toBe(2)
    await expect(c.setHandle('t', 'mark')).rejects.toThrow('ROX_HANDLE_TAKEN')
    expect(await c.handleAvailable('x')).toBe('invalid')
  })
})

describe('identity backend opt-in', () => {
  it('keeps legacy as the default and needs ROX_IDENTITY_BACKEND=rox-id to opt in', async () => {
    const { isRoxIdBackendEnabled } = await import('../rox-account-authority.ts')
    expect(isRoxIdBackendEnabled({})).toBe(false)
    expect(isRoxIdBackendEnabled({ ROX_IDENTITY_BACKEND: 'legacy' })).toBe(false)
    expect(isRoxIdBackendEnabled({ ROX_IDENTITY_BACKEND: 'rox-id' })).toBe(true)
  })
})
