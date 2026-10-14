/**
 * rox-id (api.rox.one/id/v1) client — contract v1 (/workspace/out/identity-api.md).
 *
 * Implements the host `PocketClient` seam so `RoxAccountAuthority` keeps owning
 * tokens/keys (OS secure storage) while the backend is the passkeys-only
 * id.rox.one identity. Also exposes the account surface the Settings screen
 * needs: devices (sessions) + revoke, handle@rox.one, per-user key rotation.
 *
 * Secrets never leave the host: the session token and the per-user API key are
 * returned only to the authority; renderer-facing shapes carry prefixes only.
 */
import type { RoxDeviceStartResult } from './rox-cloud.ts'
import type { PocketApproval, PocketProof, RoxAccountSnapshot, RoxInferenceCredential } from './rox-pocket-client.ts'

export const ROX_ID_DEFAULT_BASE_URL = 'https://api.rox.one/id/v1'
/** Hosts allowed to appear in device verification URLs (passkey sign-in). */
const VERIFICATION_HOSTS = new Set(['id.rox.one', 'pocketid.rox.one'])
/** Session TTL is 90 days without refresh (contract); used as expiresIn fallback. */
const SESSION_TTL_S = 90 * 24 * 3600

export function getRoxIdBaseUrl(): string {
  return (process.env.ROX_ID_BASE_URL?.trim() || ROX_ID_DEFAULT_BASE_URL).replace(/\/$/, '')
}

export class RoxIdError extends Error {
  constructor(code: string, readonly status: number, readonly serverCode?: string) { super(code); this.name = 'RoxIdError' }
}

type Fetch = (input: string, init: RequestInit) => Promise<Response>
interface RequestOptions { method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; body?: unknown; token?: string; signal?: AbortSignal; acceptStatus?: number[] }

export interface RoxIdTransport { fetch: Fetch; baseUrl(): string }
const defaultTransport: RoxIdTransport = { fetch: (input, init) => fetch(input, init), baseUrl: getRoxIdBaseUrl }

async function call(t: RoxIdTransport, path: string, o: RequestOptions = {}): Promise<{ status: number; data: Record<string, unknown> }> {
  const timeout = AbortSignal.timeout(30_000)
  const response = await t.fetch(`${t.baseUrl()}${path}`, {
    method: o.method ?? (o.body === undefined ? 'GET' : 'POST'),
    headers: {
      accept: 'application/json',
      ...(o.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(o.token ? { authorization: `Bearer ${o.token}` } : {}),
    },
    ...(o.body !== undefined ? { body: JSON.stringify(o.body) } : {}),
    signal: o.signal ? AbortSignal.any([o.signal, timeout]) : timeout,
  })
  if ([429, 502, 503, 504].includes(response.status)) throw new RoxIdError('ROX_AUTH_TEMPORARILY_UNAVAILABLE', response.status)
  const parsed: unknown = await response.json().catch(() => null)
  const data = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null
  if (!data) throw new RoxIdError('ROX_AUTH_INVALID_RESPONSE', response.status)
  const serverCode = typeof data.error === 'string' ? data.error : undefined
  if (response.ok || o.acceptStatus?.includes(response.status)) return { status: response.status, data }
  if (response.status === 401) throw new RoxIdError('ROX_AUTH_EXPIRED', 401, serverCode)
  if (serverCode === 'access_denied') throw new RoxIdError('ROX_CONNECT_DENIED', response.status, serverCode)
  if (serverCode === 'expired_token') throw new RoxIdError('DEVICE_CODE_EXPIRED', response.status, serverCode)
  if (serverCode === 'invalid_handle') throw new RoxIdError('ROX_HANDLE_INVALID', response.status, serverCode)
  if (serverCode === 'handle_taken') throw new RoxIdError('ROX_HANDLE_TAKEN', response.status, serverCode)
  throw new RoxIdError('ROX_AUTH_REQUEST_FAILED', response.status, serverCode)
}

const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0
const optStr = (v: unknown): string | null => typeof v === 'string' ? v : null

function verificationUrl(value: unknown): string {
  if (!str(value)) throw new RoxIdError('ROX_AUTH_INVALID_RESPONSE', 200)
  let url: URL
  try { url = new URL(value) } catch { throw new RoxIdError('ROX_AUTH_INVALID_RESPONSE', 200) }
  const local = ['localhost', '127.0.0.1'].includes(url.hostname)
  if ((url.protocol !== 'https:' && !local) || (!local && !VERIFICATION_HOSTS.has(url.hostname)) || url.username || url.password) {
    throw new RoxIdError('ROX_AUTH_INVALID_RESPONSE', 200)
  }
  return url.href
}

/** Exact micro-USD integer → the authority's fixed 6-decimal balance string. */
export function microusdToFixed(micro: number): string {
  const n = Math.max(0, Math.trunc(micro))
  return `${Math.floor(n / 1_000_000)}.${String(n % 1_000_000).padStart(6, '0')}`
}

export interface RoxIdAccount {
  id: string; email: string; name: string | null; handle: string | null; handleAddress: string | null; createdAt: string
  balance: { availableMicrousd: number; grantedUsd: number; spentUsd: number; exhausted: boolean }
  provider: { id: string; baseUrl: string; defaultModel: string; defaultModelName: string; apiKeyId: string; apiKeyPrefix: string; suspended: boolean } | null
}

export function parseAccount(raw: unknown): RoxIdAccount {
  const a = raw as Record<string, any> | null
  if (!a || !str(a.id) || typeof a.email !== 'string' || !a.balance || !Number.isSafeInteger(a.balance.availableMicrousd)) throw new RoxIdError('ROX_AUTH_INVALID_RESPONSE', 200)
  const p = a.provider as Record<string, any> | null | undefined
  return {
    id: a.id, email: a.email, name: optStr(a.name), handle: optStr(a.handle), handleAddress: optStr(a.handleAddress),
    createdAt: typeof a.createdAt === 'string' ? a.createdAt : '',
    balance: {
      availableMicrousd: a.balance.availableMicrousd,
      grantedUsd: Number(a.balance.grantedUsd) || 0,
      spentUsd: Number(a.balance.spentUsd) || 0,
      exhausted: a.balance.exhausted === true,
    },
    // Strict projection: the plaintext `apiKey` is never carried on this shape.
    provider: p && str(p.apiKeyId) && str(p.baseUrl)
      ? { id: String(p.id ?? 'rox-cloud'), baseUrl: p.baseUrl, defaultModel: String(p.defaultModel ?? ''), defaultModelName: String(p.defaultModelName ?? ''), apiKeyId: p.apiKeyId, apiKeyPrefix: String(p.apiKeyPrefix ?? '').slice(0, 24), suspended: p.suspended === true }
      : null,
  }
}

/** Map a rox-id account onto the authority snapshot. */
export function toSnapshot(account: RoxIdAccount): RoxAccountSnapshot {
  const available = microusdToFixed(account.balance.availableMicrousd)
  return {
    state: account.provider ? 'ready' : 'provisioning',
    user: { id: account.id, email: account.email, emailVerified: true, name: account.name, handle: account.handle, profileUrl: null },
    // rox-id has no organizations yet: the personal account is its own org.
    organization: { id: account.id, name: account.name, slug: account.handle, role: 'owner' },
    balance: { currency: 'ROX', balanceRox: available, heldRox: '0.000000', availableRox: available, bonusStatus: account.balance.grantedUsd > 0 ? 'granted' : 'pending' },
    // Generation 1: rox-id rotates by minting a new key id, which the authority already diffs on.
    key: account.provider ? { id: account.provider.apiKeyId, prefix: account.provider.apiKeyPrefix, generation: 1, status: account.provider.suspended || account.balance.exhausted ? 'suspended' : 'active' } : null,
    updatedAt: new Date().toISOString(),
    ...(account.balance.exhausted ? { errorCode: 'ROX_BALANCE_EXHAUSTED' } : {}),
  }
}

function loginApproval(data: Record<string, any>): PocketApproval {
  const s = data.session as Record<string, any> | undefined
  if (!s || !str(s.token) || !str(s.id)) throw new RoxIdError('ROX_AUTH_INVALID_RESPONSE', 200)
  const account = parseAccount(data.account)
  const expiresAt = typeof s.expiresAt === 'string' ? Date.parse(s.expiresAt) : NaN
  const expiresIn = Number.isFinite(expiresAt) ? Math.max(60, Math.floor((expiresAt - Date.now()) / 1000)) : SESSION_TTL_S
  // No refresh in rox-id: the session id stands in for the refresh handle so
  // the authority's record shape holds; `refresh` always forces re-login.
  return { status: 'approved', accessToken: s.token, refreshToken: s.id, tokenType: 'Bearer', expiresIn, user: { id: account.id, email: account.email, name: account.name ?? '' } }
}

export interface RoxIdSession { id: string; deviceName: string | null; platform: string | null; kind: string; createdAt: string; lastSeenAt: string | null; current: boolean }

export function createRoxIdClient(t: RoxIdTransport = defaultTransport, device: { name?: string; platform?: string } = {}) {
  return {
    async start(signal: AbortSignal): Promise<{ started: RoxDeviceStartResult; proof: PocketProof }> {
      const { data } = await call(t, '/auth/device/start', { body: { deviceName: device.name, platform: device.platform }, signal })
      if (!str(data.device_code) || !str(data.user_code) || !Number.isFinite(data.expires_in) || (data.expires_in as number) <= 0) throw new RoxIdError('ROX_AUTH_INVALID_RESPONSE', 200)
      return {
        started: {
          deviceCode: data.device_code, userCode: data.user_code,
          verificationUri: verificationUrl(data.verification_uri),
          verificationUriComplete: verificationUrl(data.verification_uri_complete ?? data.verification_uri),
          expiresIn: data.expires_in as number,
          interval: Math.max(2, Math.min(30, Number(data.interval) || 5)),
        },
        // rox-id device flow has no PKCE proof; the shape is kept for the seam.
        proof: { codeVerifier: '', redemptionId: '' },
      }
    },
    async wait(deviceCode: string, _proof: PocketProof, options: { timeoutMs: number; interval: number; signal: AbortSignal }): Promise<PocketApproval> {
      const signal = AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs)])
      let interval = options.interval
      try {
        for (;;) {
          signal.throwIfAborted()
          try {
            const { status, data } = await call(t, '/auth/device/poll', { body: { device_code: deviceCode }, signal, acceptStatus: [428] })
            if (status === 200) return loginApproval(data)
            if (data.error === 'slow_down') interval += 5
            else if (data.error !== 'authorization_pending') throw new RoxIdError('ROX_AUTH_INVALID_RESPONSE', status)
          } catch (error) {
            const transient = error instanceof TypeError || (error instanceof RoxIdError && error.message === 'ROX_AUTH_TEMPORARILY_UNAVAILABLE')
            if (!transient) throw error
          }
          await new Promise<void>((resolve, reject) => {
            const abort = () => { clearTimeout(timer); reject(signal.reason) }
            const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, interval * 1000)
            signal.addEventListener('abort', abort, { once: true })
            if (signal.aborted) abort()
          })
        }
      } catch (error) {
        if (options.signal.aborted) throw new Error('ROX_CONNECT_CANCELLED')
        if (signal.aborted) throw new Error('DEVICE_CODE_EXPIRED')
        throw error
      }
    },
    async refresh(_refreshToken: string, _refreshId?: string): Promise<PocketApproval> {
      // Contract: 90-day sessions, no refresh — the user re-logs in via the device flow.
      throw new RoxIdError('ROX_AUTH_EXPIRED', 401)
    },
    async logout(token: string): Promise<void> { await call(t, '/auth/logout', { body: {}, token }) },
    async account(token: string): Promise<RoxAccountSnapshot> {
      const { data } = await call(t, '/me', { token })
      return toSnapshot(parseAccount(data))
    },
    async credential(token: string, snapshot: RoxAccountSnapshot): Promise<RoxInferenceCredential> {
      const { data } = await call(t, '/me/api-key/reveal', { body: {}, token })
      if (!str(data.apiKey) || data.apiKeyId !== snapshot.key?.id || !str(data.baseUrl)) throw new RoxIdError('ROX_AUTH_INVALID_RESPONSE', 200)
      return { accountId: snapshot.user.id, keyId: data.apiKeyId as string, generation: snapshot.key?.generation ?? 1, apiKey: data.apiKey, baseUrl: data.baseUrl }
    },
    /** Rotate the per-user key; the authority re-syncs and swaps the stored credential. */
    async rotateKey(token: string): Promise<{ apiKeyId: string; prefix: string }> {
      const { data } = await call(t, '/me/api-key/rotate', { body: {}, token })
      if (!str(data.apiKeyId)) throw new RoxIdError('ROX_AUTH_INVALID_RESPONSE', 200)
      return { apiKeyId: data.apiKeyId, prefix: String(data.prefix ?? '').slice(0, 24) }
    },
    async me(token: string): Promise<RoxIdAccount> { return parseAccount((await call(t, '/me', { token })).data) },
    async sessions(token: string): Promise<RoxIdSession[]> {
      const { data } = await call(t, '/me/sessions', { token })
      if (!Array.isArray(data.sessions)) throw new RoxIdError('ROX_AUTH_INVALID_RESPONSE', 200)
      return (data.sessions as Record<string, unknown>[]).filter((s) => str(s.id)).map((s) => ({
        id: s.id as string, deviceName: optStr(s.deviceName), platform: optStr(s.platform), kind: String(s.kind ?? 'device'),
        createdAt: String(s.createdAt ?? ''), lastSeenAt: optStr(s.lastSeenAt), current: s.current === true,
      }))
    },
    async revokeSession(token: string, id: string): Promise<void> { await call(t, `/me/sessions/${encodeURIComponent(id)}`, { method: 'DELETE', token }) },
    async revokeOtherSessions(token: string): Promise<number> {
      const { data } = await call(t, '/me/sessions/revoke-others', { body: {}, token })
      return Number(data.revoked) || 0
    },
    async handleAvailable(handle: string): Promise<'available' | 'taken' | 'invalid' | 'unknown'> {
      try {
        const { data } = await call(t, `/handles/${encodeURIComponent(handle)}/available`)
        if (data.valid === false) return 'invalid'
        return data.available === true ? 'available' : data.available === false ? 'taken' : 'unknown'
      } catch { return 'unknown' }
    },
    async setHandle(token: string, handle: string): Promise<RoxIdAccount | null> {
      const { data } = await call(t, '/me/handle', { method: 'PUT', body: { handle }, token })
      return data.id ? parseAccount(data) : null
    },
  }
}

export type RoxIdClient = ReturnType<typeof createRoxIdClient>
/** Local validation mirror of the server rule (reserved words are server-only). */
export const ROX_HANDLE_RE = /^[a-z0-9][a-z0-9._-]{1,28}[a-z0-9]$/
