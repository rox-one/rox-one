/** Pocket device v2 client. Proofs and tokens belong to the host, never the UI. */
import { generatePKCE } from './pkce.ts'
import { randomUUID } from 'node:crypto'
import { getRoxAuthBaseUrl, getRoxClientId, type RoxDeviceStartResult, type RoxDevicePollApproved } from './rox-cloud.ts'

export interface RoxAccountSnapshot {
  state: 'authenticated' | 'provisioning' | 'ready' | 'failed'
  user: { id: string; email: string; emailVerified: boolean; name: string | null; handle: string | null; profileUrl: string | null }
  organization: { id: string; name: string | null; slug: string | null; role: string }
  balance: { currency: 'ROX'; balanceRox: string; heldRox: string; availableRox: string; bonusStatus: string }
  key: { id: string; prefix: string; generation: number; status: string } | null
  updatedAt: string
  errorCode?: string
}
export interface RoxInferenceCredential { accountId: string; keyId: string; generation: number; apiKey: string; baseUrl: string }
export type PocketApproval = RoxDevicePollApproved & { refreshToken: string }
export interface PocketProof { codeVerifier: string; redemptionId: string }

async function request(path: string, input?: unknown, token?: string, signal?: AbortSignal): Promise<Record<string, any>> {
  const response = await fetch(`${getRoxAuthBaseUrl()}${path}`, {
    method: input === undefined ? 'GET' : 'POST',
    headers: { accept: 'application/json', ...(input !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(input !== undefined ? { body: JSON.stringify(input) } : {}),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
  })
  if ([429, 502, 503, 504].includes(response.status)) throw new Error('ROX_AUTH_TEMPORARILY_UNAVAILABLE')
  const parsed = await response.json().catch(() => null)
  const data = parsed as Record<string, any> | null
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('ROX_AUTH_INVALID_RESPONSE')
  if (data.error === 'access_denied' || data.status === 'denied') throw new Error('ROX_CONNECT_DENIED')
  if (data.error === 'expired_token' || data.status === 'expired') throw new Error('DEVICE_CODE_EXPIRED')
  if (!response.ok) throw new Error(response.status === 401 ? 'ROX_AUTH_EXPIRED' : response.status === 410 ? 'DEVICE_CODE_EXPIRED' : 'ROX_AUTH_REQUEST_FAILED')
  return data
}
function approval(data: Record<string, any>): PocketApproval {
  if (data.status !== 'approved' || !data.access_token || typeof data.access_token !== 'string' || typeof data.refresh_token !== 'string' || !data.refresh_token || data.token_type !== 'Bearer' || !Number.isFinite(data.expires_in) || data.expires_in <= 0 || typeof data.user?.id !== 'string' || !data.user.id || typeof data.user.email !== 'string') throw new Error('ROX_AUTH_INVALID_RESPONSE')
  return { status: 'approved', accessToken: data.access_token, refreshToken: data.refresh_token, tokenType: data.token_type, expiresIn: data.expires_in, user: { id: data.user.id, email: data.user.email, name: typeof data.user.name === 'string' ? data.user.name : '', image: data.user.image } }
}
export async function startPocketDeviceFlow(signal: AbortSignal): Promise<{ started: RoxDeviceStartResult; proof: PocketProof }> {
  const pkce = generatePKCE()
  const data = await request('/api/auth/device/v2/start', { clientId: getRoxClientId(), code_challenge: pkce.codeChallenge, code_challenge_method: 'S256' }, undefined, signal)
  if (typeof data.device_code !== 'string' || !data.device_code || typeof data.user_code !== 'string' || !data.user_code || !Number.isFinite(data.expires_in) || data.expires_in <= 0) throw new Error('ROX_AUTH_INVALID_RESPONSE')
  const verify = (value: unknown) => {
    if (typeof value !== 'string') throw new Error('ROX_AUTH_INVALID_RESPONSE')
    let url: URL
    try { url = new URL(value) } catch { throw new Error('ROX_AUTH_INVALID_RESPONSE') }
    const base = new URL(getRoxAuthBaseUrl())
    if (url.origin !== base.origin || url.pathname !== '/login/device' || url.searchParams.get('v') !== '2' || url.searchParams.getAll('v').length !== 1 || url.hash || [...url.searchParams.keys()].some(key => !['v', 'user_code'].includes(key)) || url.username || url.password || url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('ROX_AUTH_INVALID_RESPONSE')
    return url.href
  }
  return { started: { deviceCode: data.device_code, userCode: data.user_code, verificationUri: verify(data.verification_uri), verificationUriComplete: verify(data.verification_uri_complete ?? data.verification_uri), expiresIn: data.expires_in, interval: Math.max(2, Math.min(30, Number(data.interval) || 5)) }, proof: { codeVerifier: pkce.codeVerifier, redemptionId: randomUUID() } }
}
export async function waitForPocketApproval(deviceCode: string, proof: PocketProof, options: { timeoutMs: number; interval: number; signal: AbortSignal }): Promise<PocketApproval> {
  const signal = AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs)])
  let interval = options.interval
  try {
    for (;;) {
      signal.throwIfAborted()
      try {
        const data = await request('/api/auth/device/v2/poll', { device_code: deviceCode, code_verifier: proof.codeVerifier, redemption_id: proof.redemptionId }, undefined, signal)
        signal.throwIfAborted()
        if (data.status === 'approved') return approval(data)
        if (data.status === 'denied' || data.error === 'access_denied') throw new Error('ROX_CONNECT_DENIED')
        if (data.status === 'expired' || data.error === 'expired_token') throw new Error('DEVICE_CODE_EXPIRED')
        if (!['pending', 'slow_down'].includes(data.status) && !['authorization_pending', 'slow_down'].includes(data.error)) throw new Error('ROX_AUTH_INVALID_RESPONSE')
        interval = data.status === 'slow_down' || data.error === 'slow_down' ? 10 : interval
      } catch (error) {
        if (!(error instanceof TypeError) && !(error instanceof Error && ['TimeoutError', 'ROX_AUTH_TEMPORARILY_UNAVAILABLE'].includes(error.name === 'TimeoutError' ? error.name : error.message))) throw error
      }
      await new Promise<void>((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(signal.reason) }
        const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, interval * 1000)
        signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort()
      })
    }
  } catch (error) { if (options.signal.aborted) throw new Error('ROX_CONNECT_CANCELLED'); if (signal.aborted) throw new Error('DEVICE_CODE_EXPIRED'); throw error }
}
export async function refreshPocketSession(refreshToken: string, refreshId: string): Promise<PocketApproval> {
  return approval(await request('/api/auth/device/v2/refresh', { refresh_token: refreshToken, refresh_id: refreshId }))
}
export async function logoutPocketSession(accessToken: string): Promise<void> { await request('/api/auth/device/v2/logout', {}, accessToken) }
export async function fetchPocketAccount(token: string, bootstrap = false): Promise<RoxAccountSnapshot> {
  const data = await request(bootstrap ? '/api/me/bootstrap' : '/api/me/account', bootstrap ? {} : undefined, token)
  if (!['authenticated', 'provisioning', 'ready', 'failed'].includes(data.state) || typeof data.user?.id !== 'string' || !data.user.id || !data.organization?.id || data.balance?.currency !== 'ROX' || !['balanceRox', 'heldRox', 'availableRox'].every(key => typeof data.balance[key] === 'string' && /^\d+\.\d{6}$/.test(data.balance[key]))) throw new Error('ROX_AUTH_INVALID_RESPONSE')
  // Strict projection is also the renderer secret boundary: never pass extra
  // server response properties through an unchecked cast.
  const nullable = (value: unknown) => typeof value === 'string' ? value : null
  if (typeof data.user.email !== 'string' || typeof data.user.emailVerified !== 'boolean' || typeof data.organization.id !== 'string' || typeof data.organization.role !== 'string' || typeof data.updatedAt !== 'string'
    || data.key && (typeof data.key.id !== 'string' || typeof data.key.prefix !== 'string' || data.key.prefix.length > 24 || !Number.isSafeInteger(data.key.generation) || data.key.generation < 1 || typeof data.key.status !== 'string')) throw new Error('ROX_AUTH_INVALID_RESPONSE')
  return { state: data.state, user: { id: data.user.id, email: data.user.email, emailVerified: data.user.emailVerified, name: nullable(data.user.name), handle: nullable(data.user.handle), profileUrl: nullable(data.user.profileUrl) },
    organization: { id: data.organization.id, name: nullable(data.organization.name), slug: nullable(data.organization.slug), role: data.organization.role },
    balance: { currency: 'ROX', balanceRox: data.balance.balanceRox, heldRox: data.balance.heldRox, availableRox: data.balance.availableRox, bonusStatus: typeof data.balance.bonusStatus === 'string' ? data.balance.bonusStatus : 'pending' },
    key: data.key ? { id: data.key.id, prefix: data.key.prefix, generation: data.key.generation, status: data.key.status } : null, updatedAt: data.updatedAt,
    ...(typeof data.errorCode === 'string' && /^ROX_[A-Z_]{1,80}$/.test(data.errorCode) ? { errorCode: data.errorCode } : {}) }
}
export async function fetchPocketCredential(token: string, snapshot: RoxAccountSnapshot): Promise<RoxInferenceCredential> {
  const data = await request('/api/me/inference-credential', {}, token)
  if (data.accountId !== snapshot.user.id || data.keyId !== snapshot.key?.id || data.generation !== snapshot.key?.generation || typeof data.apiKey !== 'string' || !data.apiKey || data.baseUrl !== 'https://api.rox.one/v1') throw new Error('ROX_AUTH_INVALID_RESPONSE')
  return { accountId: data.accountId, keyId: data.keyId, generation: data.generation, apiKey: data.apiKey, baseUrl: data.baseUrl }
}
