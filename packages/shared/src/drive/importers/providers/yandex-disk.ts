/**
 * Yandex Disk import provider — OAuth code flow + Disk REST API, pure fetch.
 *
 * Auth: `buildYandexAuthUrl()` + `completeYandexAuth()` implement the
 * authorization-code flow against oauth.yandex.ru (Yandex does not document a
 * public RFC-8628 device-code flow, so none is faked here).
 *
 * REST (https://cloud-api.yandex.net/v1/disk):
 *  - list: `/resources?path=...&limit=...&offset=...`, paginating over
 *    `_embedded.items` using `limit` + `offset` until `_embedded.total`.
 *  - stream: `/resources/download?path=...` returns a pre-signed `href`;
 *    the range is applied to a GET of that href.
 *
 * Env: ROX_YANDEX_CLIENT_ID, ROX_YANDEX_CLIENT_SECRET.
 *
 * Range semantics: `{ start, end }` map 1:1 onto an inclusive HTTP Range.
 *
 * Timeouts: token/listing/link calls are bounded by a hard request timeout
 * (`DEFAULT_REQUEST_TIMEOUT_MS`, 30s); the pre-signed download GET uses a
 * *stall* timeout (`DEFAULT_STALL_TIMEOUT_MS`, 30s) that aborts only after a
 * full window with no bytes. Timeouts surface as a typed `ImportProviderError`
 * (`code: 'network'`).
 */
import type { ImportProvider, ImportSourceEntry } from '../types'
import {
  ImportProviderError,
  ensureOk,
  getImportAuth,
  jsonAuthHeaders,
  fetchWithAuthRetry,
  type ImportAuthManager,
  type ImportRefreshFn,
  type ImportTokens,
} from './auth'
import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_STALL_TIMEOUT_MS,
  StallTimeoutMonitor,
  guardStreamWithStall,
  isTimeoutError,
  timedFetch,
} from '../timeout'

export const YANDEX_AUTH_URL = 'https://oauth.yandex.ru/authorize'
export const YANDEX_TOKEN_URL = 'https://oauth.yandex.ru/token'
export const YANDEX_DISK_API_BASE = 'https://cloud-api.yandex.net/v1/disk'
export const YANDEX_DEFAULT_SCOPE = 'cloud_api:disk.read'
export const YANDEX_ROOT_PATH = 'disk:/'
/** Yandex shows the authorization code on this fixed page for manual pasting. */
export const YANDEX_VERIFICATION_REDIRECT = 'https://oauth.yandex.ru/verification_code'

export function yandexClientId(explicit?: string): string {
  return explicit ?? process.env.ROX_YANDEX_CLIENT_ID ?? ''
}

export function yandexClientSecret(explicit?: string): string | undefined {
  return explicit ?? process.env.ROX_YANDEX_CLIENT_SECRET ?? undefined
}

export interface YandexAuthUrlOptions {
  redirectUri: string
  clientId?: string
  scope?: string
  state?: string
  /** Force the consent screen. */
  forceConfirm?: boolean
}

export function buildYandexAuthUrl(options: YandexAuthUrlOptions): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: yandexClientId(options.clientId),
    redirect_uri: options.redirectUri,
    scope: options.scope ?? YANDEX_DEFAULT_SCOPE,
  })
  if (options.state) params.set('state', options.state)
  if (options.forceConfirm) params.set('force_confirm', 'yes')
  return `${YANDEX_AUTH_URL}?${params.toString()}`
}

interface TokenHttpResult {
  ok: boolean
  status: number
  body: Record<string, unknown>
}

async function postYandexForm(
  url: string,
  params: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<TokenHttpResult> {
  let response: Response
  try {
    response = await timedFetch(fetchImpl, url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(params).toString(),
    }, DEFAULT_REQUEST_TIMEOUT_MS)
  } catch (cause) {
    throw new ImportProviderError(
      isTimeoutError(cause)
        ? `Тайм-аут обращения к Яндекс.Диску (${DEFAULT_REQUEST_TIMEOUT_MS} мс)`
        : 'Сеть недоступна: не удалось обратиться к Яндекс.Диску',
      { code: 'network', provider: 'yandex-disk', retryable: true, cause },
    )
  }
  const text = await response.text()
  let body: Record<string, unknown> = {}
  if (text) {
    try {
      body = JSON.parse(text) as Record<string, unknown>
    } catch {
      body = { raw: text }
    }
  }
  return { ok: response.ok, status: response.status, body }
}

/** Read a stable error code/message out of a Yandex token error body. */
export function yandexTokenError(body: Record<string, unknown>, status: number): ImportProviderError {
  const rawError = body.error
  let code: string | undefined
  let objectMessage: string | undefined
  if (typeof rawError === 'string') {
    code = rawError
  } else if (rawError !== null && typeof rawError === 'object') {
    if ('message' in rawError && typeof rawError.message === 'string') objectMessage = rawError.message
    if ('error' in rawError && typeof rawError.error === 'string') code = rawError.error
  }
  const description = typeof body.error_description === 'string' ? body.error_description : undefined
  const message = description ?? objectMessage ?? code ?? `HTTP ${status}`
  const typed: ImportProviderError['code'] =
    status === 401 || code === 'invalid_grant' || code === 'invalid_client' ? 'auth-failed'
      : status === 429 ? 'rate-limited'
        : 'http-error'
  return new ImportProviderError(`Яндекс OAuth: ${message}`, {
    code: typed,
    provider: 'yandex-disk',
    status,
    retryable: status === 429 || status >= 500,
  })
}

interface YandexTokenFields {
  access_token?: unknown
  refresh_token?: unknown
  expires_in?: unknown
  scope?: unknown
  token_type?: unknown
}

function tokensFromYandex(body: YandexTokenFields, now: () => number): ImportTokens {
  if (typeof body.access_token !== 'string' || body.access_token.length === 0) {
    throw new ImportProviderError('Яндекс вернул ответ без access_token', {
      code: 'invalid-response',
      provider: 'yandex-disk',
    })
  }
  const expiresIn = typeof body.expires_in === 'number' ? body.expires_in : Number(body.expires_in)
  return {
    accessToken: body.access_token,
    refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : undefined,
    expiresAt: Number.isFinite(expiresIn) ? now() + expiresIn * 1000 : undefined,
    scope: typeof body.scope === 'string' ? body.scope : undefined,
    tokenType: typeof body.token_type === 'string' ? body.token_type : undefined,
  }
}

export interface CompleteYandexAuthOptions {
  code: string
  clientId?: string
  clientSecret?: string
  fetchImpl?: typeof fetch
  now?: () => number
}

/** Exchange an authorization code for tokens. */
export async function completeYandexAuth(options: CompleteYandexAuthOptions): Promise<ImportTokens> {
  const params: Record<string, string> = {
    grant_type: 'authorization_code',
    code: options.code,
    client_id: yandexClientId(options.clientId),
  }
  const secret = yandexClientSecret(options.clientSecret)
  if (secret) params.client_secret = secret
  const result = await postYandexForm(YANDEX_TOKEN_URL, params, options.fetchImpl ?? globalThis.fetch)
  if (!result.ok) throw yandexTokenError(result.body, result.status)
  return tokensFromYandex(result.body, options.now ?? Date.now)
}

/** Exchange a refresh token for a new access token. */
export async function exchangeYandexRefreshToken(
  refreshToken: string,
  options: { clientId?: string; clientSecret?: string; fetchImpl?: typeof fetch; now?: () => number } = {},
): Promise<ImportTokens> {
  const params: Record<string, string> = {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: yandexClientId(options.clientId),
  }
  const secret = yandexClientSecret(options.clientSecret)
  if (secret) params.client_secret = secret
  const result = await postYandexForm(YANDEX_TOKEN_URL, params, options.fetchImpl ?? globalThis.fetch)
  if (!result.ok) throw yandexTokenError(result.body, result.status)
  return tokensFromYandex(result.body, options.now ?? Date.now)
}

export function createYandexRefresher(options: {
  clientId?: string
  clientSecret?: string
  fetchImpl?: typeof fetch
  now?: () => number
} = {}): ImportRefreshFn {
  return (refreshToken) => exchangeYandexRefreshToken(refreshToken, options)
}

interface YandexResource {
  name?: unknown
  path?: unknown
  type?: unknown
  size?: unknown
  modified?: unknown
  mime_type?: unknown
}

interface YandexResourceList {
  _embedded?: { total?: unknown; items?: YandexResource[] }
}

function mapYandexResource(item: YandexResource): ImportSourceEntry | null {
  // `path` is Yandex's canonical resource identifier (used by listing + download).
  if (typeof item.path !== 'string' || typeof item.name !== 'string') return null
  const size = typeof item.size === 'number' ? item.size : undefined
  return {
    id: item.path,
    name: item.name,
    kind: typeof item.type === 'string' && item.type === 'dir' ? 'folder' : 'file',
    sizeBytes: size !== undefined && Number.isFinite(size) ? size : undefined,
    modifiedAt: typeof item.modified === 'string' ? item.modified : undefined,
    mimeType: typeof item.mime_type === 'string' ? item.mime_type : undefined,
  }
}

export interface YandexDiskProviderOptions {
  auth?: ImportAuthManager
  clientId?: string
  clientSecret?: string
  fetchImpl?: typeof fetch
  baseUrl?: string
  /** Page size for listing; Yandex caps at 1000. */
  pageSize?: number
  /** Hard cap for listing/link calls; defaults to `DEFAULT_REQUEST_TIMEOUT_MS`. */
  requestTimeoutMs?: number
  /** Max time with no download progress before aborting; defaults to `DEFAULT_STALL_TIMEOUT_MS`. */
  stallTimeoutMs?: number
}

export class YandexDiskProvider implements ImportProvider {
  readonly id = 'yandex-disk' as const
  private readonly auth: ImportAuthManager
  private readonly fetchImpl: typeof fetch
  private readonly baseUrl: string
  private readonly pageSize: number
  private readonly requestTimeoutMs: number
  private readonly stallTimeoutMs: number

  constructor(options: YandexDiskProviderOptions = {}) {
    this.auth = options.auth ?? getImportAuth()
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch
    this.baseUrl = options.baseUrl ?? YANDEX_DISK_API_BASE
    this.pageSize = Math.min(Math.max(options.pageSize ?? 1000, 1), 1000)
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
    this.stallTimeoutMs = options.stallTimeoutMs ?? DEFAULT_STALL_TIMEOUT_MS
    this.auth.registerRefresher(
      this.id,
      createYandexRefresher({
        clientId: options.clientId,
        clientSecret: options.clientSecret,
        fetchImpl: this.fetchImpl,
      }),
    )
  }

  /** `fetch` bounded by the request timeout, with timeouts surfaced typed. */
  private async request(url: string, init: RequestInit, context: string): Promise<Response> {
    try {
      return await timedFetch(this.fetchImpl, url, init, this.requestTimeoutMs)
    } catch (cause) {
      if (isTimeoutError(cause)) {
        throw new ImportProviderError(`Тайм-аут обращения к Яндекс.Диску: ${context}`, {
          code: 'network',
          provider: this.id,
          retryable: true,
          cause,
        })
      }
      throw cause
    }
  }

  /** List direct children of a folder path (disk root when omitted). */
  async list(folderId?: string): Promise<ImportSourceEntry[]> {
    const path = folderId && folderId.length > 0 ? folderId : YANDEX_ROOT_PATH
    const entries: ImportSourceEntry[] = []
    let offset = 0
    for (;;) {
      const params = new URLSearchParams({
        path,
        limit: String(this.pageSize),
        offset: String(offset),
        // The Disk API takes comma-separated *dotted* paths, not a function-call
        // syntax: `_embedded.items(name,…)` selects only `total` and yields no
        // items, which makes every folder look empty.
        fields: '_embedded.total,_embedded.items.name,_embedded.items.path,_embedded.items.type,_embedded.items.size,_embedded.items.modified,_embedded.items.mime_type',
      })
      const { response } = await fetchWithAuthRetry({
        auth: this.auth,
        provider: this.id,
        request: (token) => this.request(`${this.baseUrl}/resources?${params.toString()}`, {
          headers: jsonAuthHeaders(token),
        }, `список файлов («${path}»)`),
      })
      await ensureOk(this.id, response, `Не удалось получить список файлов («${path}»)`)
      const body = (await response.json()) as YandexResourceList
      const items = body._embedded?.items ?? []
      for (const item of items) {
        const entry = mapYandexResource(item)
        if (entry) entries.push(entry)
      }
      const rawTotal = body._embedded?.total
      const total = typeof rawTotal === 'number' ? rawTotal : undefined
      offset += items.length
      if (items.length === 0) break
      if (total !== undefined ? offset >= total : items.length < this.pageSize) break
    }
    return entries
  }

  /** Download a file (optionally one inclusive byte range) as a byte stream. */
  async stream(sourceId: string, range?: { start: number; end: number }): Promise<ReadableStream<Uint8Array>> {
    const params = new URLSearchParams({ path: sourceId })
    const { response: linkResponse } = await fetchWithAuthRetry({
      auth: this.auth,
      provider: this.id,
      request: (token) => this.request(`${this.baseUrl}/resources/download?${params.toString()}`, {
        headers: jsonAuthHeaders(token),
      }, `ссылка на скачивание ${sourceId}`),
    })
    await ensureOk(this.id, linkResponse, `Не удалось получить ссылку на скачивание ${sourceId}`)
    const link = (await linkResponse.json()) as { href?: unknown; method?: unknown }
    if (typeof link.href !== 'string' || link.href.length === 0) {
      throw new ImportProviderError(`Яндекс.Диск не вернул ссылку на скачивание ${sourceId}`, {
        code: 'invalid-response',
        provider: this.id,
      })
    }
    // The pre-signed href is self-authorizing; only the Range header is needed.
    const headers: Record<string, string> = {}
    if (range) headers.Range = `bytes=${range.start}-${range.end}`
    // Stall-aware: the pre-signed GET is only aborted when bytes stop flowing.
    const monitor = new StallTimeoutMonitor(this.stallTimeoutMs)
    monitor.arm()
    let downloadResponse: Response
    try {
      downloadResponse = await this.fetchImpl(link.href, { headers, redirect: 'follow', signal: monitor.signal })
      await ensureOk(this.id, downloadResponse, `Не удалось скачать файл ${sourceId}`)
    } catch (cause) {
      monitor.clear()
      // A non-2xx response from `ensureOk` is already a typed provider error;
      // only genuine transport failures are re-wrapped here.
      if (cause instanceof ImportProviderError) throw cause
      if (isTimeoutError(cause) || monitor.timedOut) {
        throw new ImportProviderError(`Тайм-аут скачивания файла ${sourceId}`, {
          code: 'network',
          provider: this.id,
          retryable: true,
          cause,
        })
      }
      throw new ImportProviderError(`Не удалось скачать файл ${sourceId}`, {
        code: 'network',
        provider: this.id,
        retryable: true,
        cause,
      })
    }
    if (!downloadResponse.body) {
      monitor.clear()
      throw new ImportProviderError(`Яндекс.Диск не вернул тело файла ${sourceId}`, {
        code: 'invalid-response',
        provider: this.id,
      })
    }
    return guardStreamWithStall(downloadResponse.body, monitor)
  }
}

export function createYandexDiskProvider(options: YandexDiskProviderOptions = {}): YandexDiskProvider {
  return new YandexDiskProvider(options)
}