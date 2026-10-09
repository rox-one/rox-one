/**
 * Typed client for the Telegram link service.
 *
 * The service pairs a Telegram chat with a Rox account: it hands out a deep
 * link, surfaces a short code once the bot has seen the chat, and confirms the
 * pairing. Transport only — the caller owns the base URL and the bearer token
 * (injected from app config), and no secret (token or code) ever appears in an
 * error message or a log line here.
 *
 * Wire contract:
 *   POST {base}/api/link/start   { accountId }        → { linkId, deepLink, expiresAt }
 *   GET  {base}/api/link/status?linkId=…              → { status, code?, phoneMasked? }
 *   POST {base}/api/link/confirm { linkId, code }     → { status: 'confirmed' }
 * Auth: `Authorization: Bearer <token>`.
 */

export type TelegramLinkPhase = 'waiting' | 'code_issued' | 'confirmed' | 'expired'

const PHASES: readonly TelegramLinkPhase[] = ['waiting', 'code_issued', 'confirmed', 'expired']

export interface TelegramLinkStart {
  /** Opaque pairing id used by status/confirm. */
  linkId: string
  /** Telegram deep link (tg:// or https://t.me/…) to open with the OS handler. */
  deepLink: string
  /** Epoch milliseconds after which the pairing expires. */
  expiresAt: number
}

export interface TelegramLinkStatus {
  status: TelegramLinkPhase
  /** Short code the bot issued; present once `status === 'code_issued'`. */
  code?: string
  /** Masked phone number the bot received, when shared. */
  phoneMasked?: string
}

export interface TelegramLinkConfirmation {
  status: 'confirmed'
}

export type TelegramLinkErrorCode =
  | 'network'
  | 'unauthorized'
  | 'not_found'
  | 'expired'
  | 'invalid_code'
  | 'rate_limited'
  | 'server'
  | 'http_error'
  | 'invalid_response'

/** Error carrying a stable, log-safe code. Never embeds the token or a code. */
export class TelegramLinkError extends Error {
  readonly code: TelegramLinkErrorCode
  readonly status?: number

  constructor(code: TelegramLinkErrorCode, status?: number, message?: string) {
    super(message ?? code)
    this.name = 'TelegramLinkError'
    this.code = code
    this.status = status
  }
}

export interface TelegramLinkClientOptions {
  /** Service base URL, e.g. `https://link.rox.one` (trailing slashes ignored). */
  baseUrl: string
  /** Bearer token for the service (TG_LINK_SERVICE_TOKEN). */
  token: string
  /** `fetch` seam for tests / non-standard runtimes. */
  fetchImpl?: typeof fetch
  /** Per-request deadline. Defaults to 30s. */
  timeoutMs?: number
}

export interface TelegramLinkClient {
  start(accountId: string, signal?: AbortSignal): Promise<TelegramLinkStart>
  status(linkId: string, signal?: AbortSignal): Promise<TelegramLinkStatus>
  confirm(linkId: string, code: string, signal?: AbortSignal): Promise<TelegramLinkConfirmation>
}

const DEFAULT_TIMEOUT_MS = 30_000
const MAX_CODE_LENGTH = 32

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/** Accepts epoch milliseconds, epoch seconds or an ISO-8601 string. */
function toEpochMs(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Heuristic: seconds are ~1e9, milliseconds ~1e12.
    return value < 1e12 ? Math.round(value * 1000) : Math.round(value)
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return parsed
    const numeric = Number(value)
    if (Number.isFinite(numeric)) return toEpochMs(numeric)
  }
  return null
}

function httpErrorFor(status: number): TelegramLinkErrorCode {
  if (status === 401 || status === 403) return 'unauthorized'
  if (status === 404) return 'not_found'
  if (status === 409) return 'invalid_code'
  if (status === 410) return 'expired'
  if (status === 429) return 'rate_limited'
  if (status >= 500) return 'server'
  return 'http_error'
}

function parseStart(data: unknown): TelegramLinkStart {
  const record = asRecord(data)
  const linkId = record?.linkId
  const deepLink = record?.deepLink
  const expiresAt = toEpochMs(record?.expiresAt)
  if (
    typeof linkId !== 'string' || linkId.length === 0
    || typeof deepLink !== 'string' || deepLink.length === 0
    || expiresAt === null
  ) {
    throw new TelegramLinkError('invalid_response')
  }
  return { linkId, deepLink, expiresAt }
}

function parseStatus(data: unknown): TelegramLinkStatus {
  const record = asRecord(data)
  const status = record?.status
  if (typeof status !== 'string' || !PHASES.includes(status as TelegramLinkPhase)) {
    throw new TelegramLinkError('invalid_response')
  }
  const code = typeof record?.code === 'string' && record.code.length > 0 && record.code.length <= MAX_CODE_LENGTH
    ? record.code
    : undefined
  const phoneMasked = typeof record?.phoneMasked === 'string' && record.phoneMasked.length > 0
    ? record.phoneMasked
    : undefined
  return { status: status as TelegramLinkPhase, ...(code ? { code } : {}), ...(phoneMasked ? { phoneMasked } : {}) }
}

function parseConfirmation(data: unknown): TelegramLinkConfirmation {
  const record = asRecord(data)
  if (record?.status === 'expired') throw new TelegramLinkError('expired')
  if (record?.status !== 'confirmed') throw new TelegramLinkError('invalid_response')
  return { status: 'confirmed' }
}

export function createTelegramLinkClient(options: TelegramLinkClientOptions): TelegramLinkClient {
  const baseUrl = options.baseUrl.replace(/\/+$/, '')
  const token = options.token
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  if (!baseUrl) throw new TelegramLinkError('invalid_response', undefined, 'missing base url')
  if (!token) throw new TelegramLinkError('unauthorized', undefined, 'missing token')

  async function request(
    path: string,
    init: { method: 'GET' | 'POST'; body?: unknown },
    signal?: AbortSignal,
  ): Promise<unknown> {
    const timeoutSignal = AbortSignal.timeout(timeoutMs)
    const combined = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
    let response: Response
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method: init.method,
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${token}`,
          ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
        signal: combined,
      })
    } catch (error) {
      if (error instanceof TelegramLinkError) throw error
      throw new TelegramLinkError('network')
    }
    if (!response.ok) throw new TelegramLinkError(httpErrorFor(response.status), response.status)
    const parsed = await response.json().catch(() => null)
    return parsed
  }

  return {
    async start(accountId, signal) {
      if (typeof accountId !== 'string' || accountId.length === 0) {
        throw new TelegramLinkError('invalid_response', undefined, 'missing account id')
      }
      return parseStart(await request('/api/link/start', { method: 'POST', body: { accountId } }, signal))
    },
    async status(linkId, signal) {
      if (typeof linkId !== 'string' || linkId.length === 0) {
        throw new TelegramLinkError('invalid_response', undefined, 'missing link id')
      }
      return parseStatus(await request(`/api/link/status?linkId=${encodeURIComponent(linkId)}`, { method: 'GET' }, signal))
    },
    async confirm(linkId, code, signal) {
      if (typeof linkId !== 'string' || linkId.length === 0 || typeof code !== 'string' || code.length === 0) {
        throw new TelegramLinkError('invalid_response', undefined, 'missing link id or code')
      }
      return parseConfirmation(await request('/api/link/confirm', { method: 'POST', body: { linkId, code } }, signal))
    },
  }
}