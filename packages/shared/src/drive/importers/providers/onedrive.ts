/**
 * OneDrive (Microsoft Graph) import provider — device-code flow, pure fetch.
 *
 * Auth (consumers tenant, personal + work accounts):
 *  - POST /consumers/oauth2/v2.0/devicecode, then poll /token with the
 *    `urn:ietf:params:oauth:grant-type:device_code` grant, honoring the
 *    server `interval` and `slow_down` backoff.
 *
 * Graph:
 *  - list: `/me/drive/root/children` (or `/me/drive/items/{id}/children`)
 *    with `@odata.nextLink` pagination.
 *  - stream: `/me/drive/items/{id}/content` with an HTTP `Range` header.
 *
 * Scopes: Files.Read offline_access User.Read.
 * Env: ROX_MS_CLIENT_ID.
 *
 * Range semantics: `{ start, end }` map 1:1 onto an inclusive HTTP Range.
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
  type SleepFn,
} from './auth'

export const MS_DEVICE_CODE_URL = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode'
export const MS_TOKEN_URL = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token'
export const MS_GRAPH_BASE = 'https://graph.microsoft.com/v1.0'
export const ONEDRIVE_SCOPES = 'Files.Read offline_access User.Read'

export function msClientId(explicit?: string): string {
  return explicit ?? process.env.ROX_MS_CLIENT_ID ?? ''
}

export interface MsDeviceCode {
  deviceCode: string
  userCode: string
  verificationUri: string
  expiresIn: number
  interval: number
  message?: string
}

interface TokenHttpResult {
  ok: boolean
  status: number
  body: Record<string, unknown>
}

async function postMsForm(
  url: string,
  params: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<TokenHttpResult> {
  let response: Response
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(params).toString(),
    })
  } catch (cause) {
    throw new ImportProviderError('Сеть недоступна: не удалось обратиться к Microsoft', {
      code: 'network',
      provider: 'onedrive',
      retryable: true,
      cause,
    })
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

/** Read a stable error code/message out of a Microsoft token error body. */
export function msTokenError(body: Record<string, unknown>, status: number): ImportProviderError {
  const rawError = body.error
  const code = typeof rawError === 'string' ? rawError : undefined
  const description = typeof body.error_description === 'string' ? body.error_description : undefined
  const message = description ?? code ?? `HTTP ${status}`
  const typed: ImportProviderError['code'] =
    status === 401 || code === 'invalid_grant' || code === 'invalid_client' ? 'auth-failed'
      : status === 429 ? 'rate-limited'
        : 'http-error'
  return new ImportProviderError(`Microsoft OAuth: ${message}`, {
    code: typed,
    provider: 'onedrive',
    status,
    retryable: status === 429 || status >= 500,
  })
}

interface MsTokenFields {
  access_token?: unknown
  refresh_token?: unknown
  expires_in?: unknown
  scope?: unknown
  token_type?: unknown
  id_token?: unknown
}

function tokensFromMs(body: MsTokenFields, now: () => number): ImportTokens {
  if (typeof body.access_token !== 'string' || body.access_token.length === 0) {
    throw new ImportProviderError('Microsoft вернул ответ без access_token', {
      code: 'invalid-response',
      provider: 'onedrive',
    })
  }
  const expiresIn = typeof body.expires_in === 'number' ? body.expires_in : Number(body.expires_in)
  return {
    accessToken: body.access_token,
    refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : undefined,
    expiresAt: Number.isFinite(expiresIn) ? now() + expiresIn * 1000 : undefined,
    scope: typeof body.scope === 'string' ? body.scope : undefined,
    tokenType: typeof body.token_type === 'string' ? body.token_type : undefined,
    idToken: typeof body.id_token === 'string' ? body.id_token : undefined,
  }
}

/** Start the Microsoft device-code flow. */
export async function startMsDeviceCode(options: {
  clientId?: string
  scopes?: string
  fetchImpl?: typeof fetch
} = {}): Promise<MsDeviceCode> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const result = await postMsForm(
    MS_DEVICE_CODE_URL,
    {
      client_id: msClientId(options.clientId),
      scope: options.scopes ?? ONEDRIVE_SCOPES,
    },
    fetchImpl,
  )
  if (!result.ok) throw msTokenError(result.body, result.status)
  const { device_code, user_code, verification_uri, expires_in, interval, message } = result.body
  if (typeof device_code !== 'string' || typeof user_code !== 'string' || typeof verification_uri !== 'string') {
    throw new ImportProviderError('Microsoft вернул некорректный device-code ответ', {
      code: 'invalid-response',
      provider: 'onedrive',
    })
  }
  return {
    deviceCode: device_code,
    userCode: user_code,
    verificationUri: verification_uri,
    expiresIn: typeof expires_in === 'number' ? expires_in : Number(expires_in) || 900,
    interval: typeof interval === 'number' && interval > 0 ? interval : 5,
    message: typeof message === 'string' ? message : undefined,
  }
}

export interface PollMsDeviceOptions {
  deviceCode: string
  clientId?: string
  scopes?: string
  interval?: number
  expiresIn?: number
  fetchImpl?: typeof fetch
  sleep?: SleepFn
  now?: () => number
}

const defaultSleep: SleepFn = (ms) => {
  const { promise, resolve } = Promise.withResolvers<void>()
  setTimeout(resolve, ms)
  return promise
}

/** Poll the token endpoint until approval, denial, or expiry. */
export async function pollMsDeviceToken(options: PollMsDeviceOptions): Promise<ImportTokens> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const sleep = options.sleep ?? defaultSleep
  const now = options.now ?? Date.now
  const deadline = now() + (options.expiresIn ?? 900) * 1000
  let intervalMs = Math.max(1, options.interval ?? 5) * 1000

  for (;;) {
    if (now() >= deadline) {
      throw new ImportProviderError('Срок действия кода устройства Microsoft истёк', {
        code: 'auth-failed',
        provider: 'onedrive',
      })
    }
    const result = await postMsForm(
      MS_TOKEN_URL,
      {
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: options.deviceCode,
        client_id: msClientId(options.clientId),
        scope: options.scopes ?? ONEDRIVE_SCOPES,
      },
      fetchImpl,
    )
    if (result.ok) return tokensFromMs(result.body, now)
    const errorCode = typeof result.body.error === 'string' ? result.body.error : ''
    if (errorCode === 'authorization_pending' || errorCode === 'bad_verification_code' || errorCode === 'code_not_found') {
      await sleep(intervalMs)
      continue
    }
    if (errorCode === 'slow_down') {
      intervalMs += 5000
      await sleep(intervalMs)
      continue
    }
    if (errorCode === 'authorization_declined' || errorCode === 'access_denied') {
      throw new ImportProviderError('Пользователь отклонил доступ к OneDrive', {
        code: 'auth-failed',
        provider: 'onedrive',
      })
    }
    if (errorCode === 'expired_token') {
      throw new ImportProviderError('Срок действия кода устройства Microsoft истёк', {
        code: 'auth-failed',
        provider: 'onedrive',
      })
    }
    throw msTokenError(result.body, result.status)
  }
}

/** Exchange a refresh token for a new access token. */
export async function exchangeMsRefreshToken(
  refreshToken: string,
  options: { clientId?: string; scopes?: string; fetchImpl?: typeof fetch; now?: () => number } = {},
): Promise<ImportTokens> {
  const result = await postMsForm(
    MS_TOKEN_URL,
    {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: msClientId(options.clientId),
      scope: options.scopes ?? ONEDRIVE_SCOPES,
    },
    options.fetchImpl ?? globalThis.fetch,
  )
  if (!result.ok) throw msTokenError(result.body, result.status)
  return tokensFromMs(result.body, options.now ?? Date.now)
}

export function createMsRefresher(options: {
  clientId?: string
  scopes?: string
  fetchImpl?: typeof fetch
  now?: () => number
} = {}): ImportRefreshFn {
  return (refreshToken) => exchangeMsRefreshToken(refreshToken, options)
}

interface GraphListItem {
  id?: unknown
  name?: unknown
  size?: unknown
  lastModifiedDateTime?: unknown
  folder?: unknown
  file?: unknown
}

interface GraphListResponse {
  value?: GraphListItem[]
  '@odata.nextLink'?: unknown
}

function mapGraphItem(item: GraphListItem): ImportSourceEntry | null {
  if (typeof item.id !== 'string' || typeof item.name !== 'string') return null
  const kind = item.folder !== undefined && item.folder !== null ? 'folder' : 'file'
  const size = typeof item.size === 'number' ? item.size : undefined
  return {
    id: item.id,
    name: item.name,
    kind,
    sizeBytes: size !== undefined && Number.isFinite(size) ? size : undefined,
    modifiedAt: typeof item.lastModifiedDateTime === 'string' ? item.lastModifiedDateTime : undefined,
  }
}

export interface OneDriveProviderOptions {
  auth?: ImportAuthManager
  clientId?: string
  scopes?: string
  fetchImpl?: typeof fetch
  graphBaseUrl?: string
}

export class OneDriveProvider implements ImportProvider {
  readonly id = 'onedrive' as const
  private readonly auth: ImportAuthManager
  private readonly fetchImpl: typeof fetch
  private readonly graphBaseUrl: string

  constructor(options: OneDriveProviderOptions = {}) {
    this.auth = options.auth ?? getImportAuth()
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch
    this.graphBaseUrl = options.graphBaseUrl ?? MS_GRAPH_BASE
    this.auth.registerRefresher(
      this.id,
      createMsRefresher({ clientId: options.clientId, scopes: options.scopes, fetchImpl: this.fetchImpl }),
    )
  }

  private childrenUrl(folderId?: string): string {
    if (!folderId || folderId.length === 0 || folderId === 'root') {
      return `${this.graphBaseUrl}/me/drive/root/children?$top=200`
    }
    return `${this.graphBaseUrl}/me/drive/items/${encodeURIComponent(folderId)}/children?$top=200`
  }

  /** List direct children of a folder (drive root when omitted); fully paginated. */
  async list(folderId?: string): Promise<ImportSourceEntry[]> {
    const entries: ImportSourceEntry[] = []
    let url: string | undefined = this.childrenUrl(folderId)
    while (url) {
      const target = url
      const { response } = await fetchWithAuthRetry({
        auth: this.auth,
        provider: this.id,
        request: (token) => this.fetchImpl(target, { headers: jsonAuthHeaders(token) }),
      })
      await ensureOk(this.id, response, 'Не удалось получить список файлов OneDrive')
      const body = (await response.json()) as GraphListResponse
      for (const item of body.value ?? []) {
        const entry = mapGraphItem(item)
        if (entry) entries.push(entry)
      }
      const next = body['@odata.nextLink']
      url = typeof next === 'string' && next.length > 0 ? next : undefined
    }
    return entries
  }

  /** Download a file (optionally one inclusive byte range) as a byte stream. */
  async stream(sourceId: string, range?: { start: number; end: number }): Promise<ReadableStream<Uint8Array>> {
    const url = `${this.graphBaseUrl}/me/drive/items/${encodeURIComponent(sourceId)}/content`
    const { response } = await fetchWithAuthRetry({
      auth: this.auth,
      provider: this.id,
      request: (token) => {
        const headers = jsonAuthHeaders(token)
        if (range) headers.Range = `bytes=${range.start}-${range.end}`
        // Graph answers with a 302 to a pre-authenticated URL; fetch follows it,
        // and the Range header is carried across the redirect.
        return this.fetchImpl(url, { headers, redirect: 'follow' })
      },
    })
    await ensureOk(this.id, response, `Не удалось скачать файл ${sourceId}`)
    if (!response.body) {
      throw new ImportProviderError(`OneDrive не вернул тело файла ${sourceId}`, {
        code: 'invalid-response',
        provider: this.id,
      })
    }
    return response.body
  }
}

export function createOneDriveProvider(options: OneDriveProviderOptions = {}): OneDriveProvider {
  return new OneDriveProvider(options)
}