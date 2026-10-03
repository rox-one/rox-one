/**
 * Rox cloud identity (rox.one) — device authorization for desktop Connect.
 *
 * Product policy: Rox desktop requires Connect before agent UI.
 * Engine remains usable without cloud when ROX_CLOUD_REQUIRED=0.
 */

export interface RoxDeviceStartResult {
  deviceCode: string
  userCode: string
  verificationUri: string
  verificationUriComplete: string
  expiresIn: number
  interval: number
}

export interface RoxDevicePollPending {
  status: 'pending'
  interval: number
}

export interface RoxDevicePollApproved {
  status: 'approved'
  accessToken: string
  tokenType: string
  expiresIn: number
  user: {
    id: string
    email: string
    name: string
    image?: string | null
  }
}

export type RoxDevicePollResult = RoxDevicePollPending | RoxDevicePollApproved

export interface RoxCloudSession {
  accessToken: string
  expiresAt: number
  user: RoxDevicePollApproved['user']
  authBaseUrl: string
}

export function getRoxAuthBaseUrl(): string {
  const raw = process.env.ROX_AUTH_BASE_URL || 'https://rox.one'
  return raw.replace(/\/$/, '')
}

/**
 * Device-flow client identifier sent to {ROX_AUTH_BASE_URL}/api/auth/device/start.
 * The accepting side lives in the private rox-one-website repo, so the value is
 * contractual: default stays 'craft-agents-desktop' until the website accepts a
 * Rox-branded id; override with ROX_CLIENT_ID when it does.
 */
export function getRoxClientId(): string {
  const override = process.env.ROX_CLIENT_ID?.trim()
  return override || 'craft-agents-desktop'
}

/** Rox product builds require cloud Connect by default. */
export function isRoxCloudRequired(): boolean {
  const v = process.env.ROX_CLOUD_REQUIRED
  if (v === '0' || v === 'false' || v === 'no') return false
  if (v === '1' || v === 'true' || v === 'yes') return true
  // Default: required (single Rox product binary living in this repo for now)
  return true
}

type RoxDeviceRequestOptions = { signal?: AbortSignal }

function requestSignal(signal?: AbortSignal): AbortSignal {
  return signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000)
}

function intervalSeconds(value: unknown, fallback = 5): number {
  const seconds = Number(value)
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(Math.max(seconds, 2), 30) : fallback
}

function verificationUrl(value: unknown, base: string): string {
  if (typeof value !== 'string') throw new Error('ROX_AUTH_INVALID_RESPONSE')
  try {
    const parsed = new URL(value)
    const configured = new URL(base)
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
    const secure = parsed.protocol === 'https:' || (parsed.protocol === 'http:' && (local || parsed.origin === configured.origin))
    if (!secure || parsed.username || parsed.password) throw new Error('invalid URL')
    return parsed.href
  } catch { throw new Error('ROX_AUTH_INVALID_RESPONSE') }
}

async function responseObject(response: Response): Promise<Record<string, unknown>> {
  let data: unknown
  try { data = await response.json() } catch { throw new Error('ROX_AUTH_INVALID_RESPONSE') }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('ROX_AUTH_INVALID_RESPONSE')
  return data as Record<string, unknown>
}

export async function startRoxDeviceFlow(
  clientId = getRoxClientId(),
  opts: RoxDeviceRequestOptions = {},
): Promise<RoxDeviceStartResult> {
  const base = getRoxAuthBaseUrl()
  const res = await fetch(`${base}/api/auth/device/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ clientId }),
    signal: requestSignal(opts.signal),
  })
  opts.signal?.throwIfAborted()
  if (!res.ok) throw new Error(`Rox device start failed (${res.status})`)
  const data = await responseObject(res)
  if (typeof data.device_code !== 'string' || !data.device_code.trim()
    || typeof data.user_code !== 'string' || !data.user_code.trim()
    || !Number.isFinite(data.expires_in) || Number(data.expires_in) <= 0) {
    throw new Error('ROX_AUTH_INVALID_RESPONSE')
  }
  const verificationUri = verificationUrl(data.verification_uri, base)
  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri,
    verificationUriComplete: data.verification_uri_complete
      ? verificationUrl(data.verification_uri_complete, base) : verificationUri,
    expiresIn: Number(data.expires_in),
    interval: intervalSeconds(data.interval),
  }
}

export async function pollRoxDeviceFlow(
  deviceCode: string,
  opts: RoxDeviceRequestOptions = {},
): Promise<RoxDevicePollResult> {
  const base = getRoxAuthBaseUrl()
  const res = await fetch(`${base}/api/auth/device/poll`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ device_code: deviceCode }),
    signal: requestSignal(opts.signal),
  })
  opts.signal?.throwIfAborted()
  if (res.status === 410) throw new Error('DEVICE_CODE_EXPIRED')
  // Rate limit / gateway responses may have an empty or HTML body. A temporary
  // outage must keep an otherwise valid approval code alive.
  if (res.status === 429 || [502, 503, 504].includes(res.status)) {
    return { status: 'pending', interval: intervalSeconds(res.headers.get('retry-after')) }
  }
  const data = await responseObject(res)
  if (data.error === 'authorization_pending' || data.error === 'slow_down') {
    return { status: 'pending', interval: data.error === 'slow_down' ? 10 : intervalSeconds(data.interval) }
  }
  if (data.error === 'expired_token') throw new Error('DEVICE_CODE_EXPIRED')
  if (data.error === 'access_denied') throw new Error('ROX_CONNECT_DENIED')
  if (!res.ok) throw new Error(`Rox device poll failed (${res.status})`)
  if (data.status === 'pending') return { status: 'pending', interval: intervalSeconds(data.interval) }
  if (data.status === 'approved' && typeof data.access_token === 'string') {
    const user = data.user as Record<string, unknown> | undefined
    if (!data.access_token.trim() || !user || typeof user.id !== 'string' || !user.id.trim()
      || typeof user.email !== 'string' || !Number.isFinite(Number(data.expires_in)) || Number(data.expires_in) <= 0) {
      throw new Error('ROX_AUTH_INVALID_RESPONSE')
    }
    return {
      status: 'approved',
      accessToken: data.access_token,
      tokenType: typeof data.token_type === 'string' ? data.token_type : 'Bearer',
      expiresIn: Number(data.expires_in),
      user: {
        id: user.id, email: user.email,
        // New accounts can be approved before their optional display name exists.
        name: typeof user.name === 'string' ? user.name : '',
        ...(typeof user.image === 'string' || user.image === null ? { image: user.image } : {}),
      },
    }
  }
  throw new Error('ROX_AUTH_INVALID_RESPONSE')
}

export async function fetchRoxBalance(accessToken: string): Promise<{
  balanceRox: string
  user: { id: string; email: string; name: string }
}> {
  const base = getRoxAuthBaseUrl()
  const res = await fetch(`${base}/api/me/balance`, {
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: 'application/json',
    },
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) throw new Error(`Rox balance failed (${res.status})`)
  return (await res.json()) as {
    balanceRox: string
    user: { id: string; email: string; name: string }
  }
}

/** Poll until approved or timeout. Cancellation interrupts both HTTP and waits. */
export async function waitForRoxDeviceApproval(
  deviceCode: string,
  opts: { timeoutMs?: number; signal?: AbortSignal; interval?: number } = {},
): Promise<RoxDevicePollApproved> {
  const timeoutMs = opts.timeoutMs ?? 15 * 60 * 1000
  const deadline = Date.now() + Math.max(timeoutMs, 1)
  const signal = AbortSignal.any([
    ...(opts.signal ? [opts.signal] : []),
    AbortSignal.timeout(Math.max(Math.ceil(timeoutMs), 1)),
  ])
  let intervalSec = intervalSeconds(opts.interval)
  try {
    for (;;) {
      signal.throwIfAborted()
      if (Date.now() >= deadline) throw new Error('DEVICE_CODE_EXPIRED')
      let result: RoxDevicePollResult
      try { result = await pollRoxDeviceFlow(deviceCode, { signal }) }
      catch (error) {
        signal.throwIfAborted()
        // A short network disconnect is recoverable until the device deadline.
        if (!(error instanceof TypeError) && !(error instanceof Error && error.name === 'TimeoutError')) throw error
        result = { status: 'pending', interval: intervalSec }
      }
      signal.throwIfAborted()
      if (result.status === 'approved') return result
      intervalSec = intervalSeconds(result.interval)
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => { clearTimeout(timer); reject(signal.reason) }
        const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve() }, Math.min(intervalSec * 1000, Math.max(deadline - Date.now(), 1)))
        signal.addEventListener('abort', onAbort, { once: true })
        if (signal.aborted) onAbort()
      })
    }
  } catch (error) {
    if (opts.signal?.aborted) throw new Error('ROX_CONNECT_CANCELLED')
    if (signal.aborted || Date.now() >= deadline) throw new Error('DEVICE_CODE_EXPIRED')
    throw error
  }
}
