/**
 * Google Drive import provider — OAuth for installed apps + Drive API v3.
 *
 * Auth (pure fetch, no npm deps):
 *  - Device code: POST oauth2.googleapis.com/device/code, then poll /token.
 *    Works for public "installed app" clients (client_secret optional).
 *  - Authorization code + PKCE: `buildGoogleAuthUrl()` +
 *    `completeGoogleAuth()` with a caller-supplied loopback redirect URI.
 *
 * Drive API v3:
 *  - list: `files.list` with `q="'<folder>' in parents and trashed=false"`
 *    and `fields=files(id,name,mimeType,size,modifiedTime)`, full pagination.
 *  - tree: `listGoogleDriveTree()` walks folders recursively.
 *  - stream: `files.get?alt=media` with an HTTP `Range` header.
 *
 * Native Google documents (Docs/Sheets/Slides/…) are filtered out of `list()`
 * (see `googleSkipReason`): they have no binary body, so `files.get?alt=media`
 * answers 403 for them.
 *
 * Env: ROX_GOOGLE_CLIENT_ID (required), ROX_GOOGLE_CLIENT_SECRET (optional —
 * only desktop/installed clients that were issued a secret).
 *
 * Scope: `drive.readonly` is a restricted/sensitive scope, so public production
 * use requires Google app verification (OAuth brand review); an unverified app
 * still works in testing mode for explicitly listed test users.
 *
 * Range semantics: `{ start, end }` map 1:1 onto an inclusive HTTP Range
 * (`bytes=start-end`), matching the Drive API.
 *
 * Timeouts: token/listing calls are bounded by a hard request timeout
 * (`DEFAULT_REQUEST_TIMEOUT_MS`, 30s); downloads use a *stall* timeout
 * (`DEFAULT_STALL_TIMEOUT_MS`, 30s) that only aborts when no byte arrives for a
 * full window, so a slow-but-steady download is never killed mid-transfer.
 * Both surface as a typed `ImportProviderError` (`code: 'network'`).
 */
import { createHash, randomBytes } from 'node:crypto'
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
import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_STALL_TIMEOUT_MS,
  StallTimeoutMonitor,
  guardStreamWithStall,
  isTimeoutError,
  timedFetch,
} from '../timeout'

export const GOOGLE_DEVICE_CODE_URL = 'https://oauth2.googleapis.com/device/code'
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
export const GOOGLE_DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3'
// `drive.file` only exposes files this app created or opened (there is no
// Picker in this flow), so an import would enumerate nothing; `drive.readonly`
// is what lets the provider list the user's own Drive.
export const GOOGLE_SCOPES: readonly string[] = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/drive.readonly',
]

const GOOGLE_FOLDER_MIME = 'application/vnd.google-apps.folder'
const GOOGLE_NATIVE_MIME_PREFIX = 'application/vnd.google-apps.'

/**
 * Typed reason a Drive entry cannot be imported: native Google formats
 * (Docs, Sheets, Slides, Forms, Sites, …) exist only server-side — `files.get`
 * with `alt=media` answers HTTP 403 for them, which would exhaust the runner's
 * retries and fail the whole job.
 */
export const GOOGLE_NATIVE_SKIP_REASON = 'google-native-document'

/**
 * Provider-local, pre-filter marker: `'google-native-document'` when `mimeType`
 * denotes a native Google document (no downloadable byte stream), else `null`.
 * `GoogleDriveProvider.list()` drops such entries so the import plan skips them
 * instead of scheduling a download that can never succeed. Folders share the
 * `application/vnd.google-apps.*` prefix but are traversable, so they are kept.
 */
export function googleSkipReason(mimeType: unknown): typeof GOOGLE_NATIVE_SKIP_REASON | null {
  if (typeof mimeType !== 'string' || !mimeType.startsWith(GOOGLE_NATIVE_MIME_PREFIX)) return null
  return mimeType === GOOGLE_FOLDER_MIME ? null : GOOGLE_NATIVE_SKIP_REASON
}

export function googleClientId(explicit?: string): string {
  return explicit ?? process.env.ROX_GOOGLE_CLIENT_ID ?? ''
}

export function googleClientSecret(explicit?: string): string | undefined {
  return explicit ?? process.env.ROX_GOOGLE_CLIENT_SECRET ?? undefined
}

/** PKCE pair for the authorization-code flow. */
export interface GooglePkce {
  codeVerifier: string
  codeChallenge: string
}

export function generateGooglePkce(): GooglePkce {
  const codeVerifier = randomBytes(32).toString('base64url')
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url')
  return { codeVerifier, codeChallenge }
}

/** Random CSRF `state`. */
export function generateGoogleState(): string {
  return randomBytes(16).toString('hex')
}

export interface GoogleAuthUrlOptions {
  /** Loopback redirect URI, e.g. `http://127.0.0.1:PORT/oauth/callback`. */
  redirectUri: string
  clientId?: string
  scopes?: readonly string[]
  state?: string
  codeChallenge?: string
  /** `offline` (default) to obtain a refresh token. */
  accessType?: 'offline' | 'online'
  prompt?: 'none' | 'consent' | 'select_account'
}

/** Build the consent-screen URL for the authorization-code + PKCE flow. */
export function buildGoogleAuthUrl(options: GoogleAuthUrlOptions): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: googleClientId(options.clientId),
    redirect_uri: options.redirectUri,
    scope: (options.scopes ?? GOOGLE_SCOPES).join(' '),
    access_type: options.accessType ?? 'offline',
    include_granted_scopes: 'true',
  })
  if (options.state) params.set('state', options.state)
  if (options.codeChallenge) {
    params.set('code_challenge', options.codeChallenge)
    params.set('code_challenge_method', 'S256')
  }
  if (options.prompt) params.set('prompt', options.prompt)
  return `${GOOGLE_AUTH_URL}?${params.toString()}`
}

export interface TokenHttpResult {
  ok: boolean
  status: number
  body: Record<string, unknown>
}

async function postGoogleForm(
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
        ? `Тайм-аут обращения к Google (${DEFAULT_REQUEST_TIMEOUT_MS} мс)`
        : 'Сеть недоступна: не удалось обратиться к Google',
      { code: 'network', provider: 'google-drive', retryable: true, cause },
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

/** Read a stable error code/message out of a Google token error body. */
export function googleTokenError(body: Record<string, unknown>, status: number): ImportProviderError {
  const rawError = body.error
  let code: string | undefined
  if (typeof rawError === 'string') {
    code = rawError
  } else if (rawError !== null && typeof rawError === 'object' && 'code' in rawError && typeof rawError.code === 'string') {
    code = rawError.code
  }
  const description = typeof body.error_description === 'string' ? body.error_description : undefined
  const message = description ?? code ?? `HTTP ${status}`
  const typed: ImportProviderError['code'] =
    status === 401 || code === 'invalid_grant' || code === 'invalid_client' ? 'auth-failed'
      : status === 429 ? 'rate-limited'
        : 'http-error'
  return new ImportProviderError(`Google OAuth: ${message}`, {
    code: typed,
    provider: 'google-drive',
    status,
    retryable: status === 429 || status >= 500,
  })
}

interface GoogleTokenFields {
  access_token?: unknown
  refresh_token?: unknown
  expires_in?: unknown
  scope?: unknown
  token_type?: unknown
  id_token?: unknown
}

function tokensFromGoogle(body: GoogleTokenFields, now: () => number): ImportTokens {
  if (typeof body.access_token !== 'string' || body.access_token.length === 0) {
    throw new ImportProviderError('Google вернул ответ без access_token', {
      code: 'invalid-response',
      provider: 'google-drive',
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

export interface CompleteGoogleAuthOptions {
  code: string
  codeVerifier: string
  redirectUri: string
  clientId?: string
  clientSecret?: string
  fetchImpl?: typeof fetch
  now?: () => number
}

/** Exchange an authorization code (+ PKCE verifier) for tokens. */
export async function completeGoogleAuth(options: CompleteGoogleAuthOptions): Promise<ImportTokens> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const params: Record<string, string> = {
    grant_type: 'authorization_code',
    code: options.code,
    code_verifier: options.codeVerifier,
    redirect_uri: options.redirectUri,
    client_id: googleClientId(options.clientId),
  }
  const secret = googleClientSecret(options.clientSecret)
  if (secret) params.client_secret = secret
  const result = await postGoogleForm(GOOGLE_TOKEN_URL, params, fetchImpl)
  if (!result.ok) throw googleTokenError(result.body, result.status)
  return tokensFromGoogle(result.body, options.now ?? Date.now)
}

/** Refresh exchange reused by `createGoogleRefresher`. */
export async function exchangeGoogleRefreshToken(
  refreshToken: string,
  options: {
    clientId?: string
    clientSecret?: string
    fetchImpl?: typeof fetch
    now?: () => number
  } = {},
): Promise<ImportTokens> {
  const params: Record<string, string> = {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: googleClientId(options.clientId),
  }
  const secret = googleClientSecret(options.clientSecret)
  if (secret) params.client_secret = secret
  const result = await postGoogleForm(GOOGLE_TOKEN_URL, params, options.fetchImpl ?? globalThis.fetch)
  if (!result.ok) throw googleTokenError(result.body, result.status)
  return tokensFromGoogle(result.body, options.now ?? Date.now)
}

/** Refresh function a provider registers with the auth manager. */
export function createGoogleRefresher(options: {
  clientId?: string
  clientSecret?: string
  fetchImpl?: typeof fetch
  now?: () => number
} = {}): ImportRefreshFn {
  return (refreshToken) => exchangeGoogleRefreshToken(refreshToken, options)
}

export interface GoogleDeviceCode {
  deviceCode: string
  userCode: string
  verificationUrl: string
  expiresIn: number
  /** Server-suggested poll interval, seconds. */
  interval: number
}

/** Start the device-code flow for an installed/public client. */
export async function startGoogleDeviceCode(options: {
  clientId?: string
  scopes?: readonly string[]
  fetchImpl?: typeof fetch
} = {}): Promise<GoogleDeviceCode> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const result = await postGoogleForm(
    GOOGLE_DEVICE_CODE_URL,
    {
      client_id: googleClientId(options.clientId),
      scope: (options.scopes ?? GOOGLE_SCOPES).join(' '),
    },
    fetchImpl,
  )
  if (!result.ok) throw googleTokenError(result.body, result.status)
  const { device_code, user_code, verification_url, expires_in, interval } = result.body
  if (typeof device_code !== 'string' || typeof user_code !== 'string' || typeof verification_url !== 'string') {
    throw new ImportProviderError('Google вернул некорректный device-code ответ', {
      code: 'invalid-response',
      provider: 'google-drive',
    })
  }
  return {
    deviceCode: device_code,
    userCode: user_code,
    verificationUrl: verification_url,
    expiresIn: typeof expires_in === 'number' ? expires_in : Number(expires_in) || 1800,
    interval: typeof interval === 'number' && interval > 0 ? interval : 5,
  }
}

export interface PollGoogleDeviceOptions {
  deviceCode: string
  clientId?: string
  clientSecret?: string
  /** Override the poll interval (seconds). */
  interval?: number
  expiresIn?: number
  fetchImpl?: typeof fetch
  /** Injectable for tests; defaults to `setTimeout`. */
  sleep?: SleepFn
  now?: () => number
}

const defaultSleep: SleepFn = (ms) => {
  const { promise, resolve } = Promise.withResolvers<void>()
  setTimeout(resolve, ms)
  return promise
}

/** Poll the token endpoint until the user approves, denies, or the code expires. */
export async function pollGoogleDeviceToken(options: PollGoogleDeviceOptions): Promise<ImportTokens> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const sleep = options.sleep ?? defaultSleep
  const now = options.now ?? Date.now
  const deadline = now() + (options.expiresIn ?? 1800) * 1000
  let intervalMs = Math.max(1, options.interval ?? 5) * 1000

  for (;;) {
    if (now() >= deadline) {
      throw new ImportProviderError('Срок действия кода устройства Google истёк', {
        code: 'auth-failed',
        provider: 'google-drive',
      })
    }
    const params: Record<string, string> = {
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: options.deviceCode,
      client_id: googleClientId(options.clientId),
    }
    const secret = googleClientSecret(options.clientSecret)
    if (secret) params.client_secret = secret
    const result = await postGoogleForm(GOOGLE_TOKEN_URL, params, fetchImpl)
    if (result.ok) return tokensFromGoogle(result.body, now)
    const errorCode = typeof result.body.error === 'string' ? result.body.error : ''
    if (errorCode === 'authorization_pending') {
      await sleep(intervalMs)
      continue
    }
    if (errorCode === 'slow_down') {
      intervalMs += 5000
      await sleep(intervalMs)
      continue
    }
    if (errorCode === 'access_denied') {
      throw new ImportProviderError('Пользователь отклонил доступ к Google Drive', {
        code: 'auth-failed',
        provider: 'google-drive',
      })
    }
    if (errorCode === 'expired_token') {
      throw new ImportProviderError('Срок действия кода устройства Google истёк', {
        code: 'auth-failed',
        provider: 'google-drive',
      })
    }
    throw googleTokenError(result.body, result.status)
  }
}

interface GoogleFile {
  id?: unknown
  name?: unknown
  mimeType?: unknown
  size?: unknown
  modifiedTime?: unknown
}

interface GoogleFileList {
  files?: GoogleFile[]
  nextPageToken?: unknown
}

function mapGoogleFile(file: GoogleFile): ImportSourceEntry | null {
  if (typeof file.id !== 'string' || typeof file.name !== 'string') return null
  const size = typeof file.size === 'string' || typeof file.size === 'number' ? Number(file.size) : undefined
  return {
    id: file.id,
    name: file.name,
    kind: typeof file.mimeType === 'string' && file.mimeType === GOOGLE_FOLDER_MIME ? 'folder' : 'file',
    sizeBytes: size !== undefined && Number.isFinite(size) ? size : undefined,
    modifiedAt: typeof file.modifiedTime === 'string' ? file.modifiedTime : undefined,
    mimeType: typeof file.mimeType === 'string' ? file.mimeType : undefined,
  }
}

export interface GoogleDriveProviderOptions {
  auth?: ImportAuthManager
  clientId?: string
  clientSecret?: string
  fetchImpl?: typeof fetch
  baseUrl?: string
  /** Hard cap for listing calls; defaults to `DEFAULT_REQUEST_TIMEOUT_MS`. */
  requestTimeoutMs?: number
  /** Max time with no download progress before aborting; defaults to `DEFAULT_STALL_TIMEOUT_MS`. */
  stallTimeoutMs?: number
}

export class GoogleDriveProvider implements ImportProvider {
  readonly id = 'google-drive' as const
  private readonly auth: ImportAuthManager
  private readonly fetchImpl: typeof fetch
  private readonly baseUrl: string
  private readonly requestTimeoutMs: number
  private readonly stallTimeoutMs: number

  constructor(options: GoogleDriveProviderOptions = {}) {
    this.auth = options.auth ?? getImportAuth()
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch
    this.baseUrl = options.baseUrl ?? GOOGLE_DRIVE_API_BASE
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
    this.stallTimeoutMs = options.stallTimeoutMs ?? DEFAULT_STALL_TIMEOUT_MS
    this.auth.registerRefresher(
      this.id,
      createGoogleRefresher({
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
        throw new ImportProviderError(`Тайм-аут обращения к Google Drive: ${context}`, {
          code: 'network',
          provider: this.id,
          retryable: true,
          cause,
        })
      }
      throw cause
    }
  }

  /** List direct children of a folder (`root` when omitted); fully paginated. */
  async list(folderId?: string): Promise<ImportSourceEntry[]> {
    const parent = folderId && folderId.length > 0 ? folderId : 'root'
    const entries: ImportSourceEntry[] = []
    let pageToken: string | undefined
    do {
      const params = new URLSearchParams({
        q: `'${parent.replace(/'/g, "\\'")}' in parents and trashed=false`,
        fields: 'nextPageToken,files(id,name,mimeType,size,modifiedTime)',
        pageSize: '1000',
        supportsAllDrives: 'true',
        includeItemsFromAllDrives: 'true',
      })
      if (pageToken) params.set('pageToken', pageToken)
      const { response } = await fetchWithAuthRetry({
        auth: this.auth,
        provider: this.id,
        request: (token) => this.request(`${this.baseUrl}/files?${params.toString()}`, {
          headers: jsonAuthHeaders(token),
        }, `список файлов («${parent}»)`),
      })
      await ensureOk(this.id, response, `Не удалось получить список файлов («${parent}»)`)
      const body = (await response.json()) as GoogleFileList
      for (const file of body.files ?? []) {
        // Native Google documents have no `alt=media` bytes; dropping them here
        // keeps the plan free of files that would 403 at download time.
        if (googleSkipReason(file.mimeType)) continue
        const entry = mapGoogleFile(file)
        if (entry) entries.push(entry)
      }
      pageToken = typeof body.nextPageToken === 'string' && body.nextPageToken.length > 0 ? body.nextPageToken : undefined
    } while (pageToken)
    return entries
  }

  /** Download a file (optionally one inclusive byte range) as a byte stream. */
  async stream(sourceId: string, range?: { start: number; end: number }): Promise<ReadableStream<Uint8Array>> {
    const params = new URLSearchParams({ alt: 'media', supportsAllDrives: 'true' })
    // The connection is killed only after `stallTimeoutMs` without a byte of
    // progress — never on total duration, so a large slow download survives.
    const monitor = new StallTimeoutMonitor(this.stallTimeoutMs)
    monitor.arm()
    let response: Response
    try {
      ({ response } = await fetchWithAuthRetry({
        auth: this.auth,
        provider: this.id,
        request: (token) => {
          const headers = jsonAuthHeaders(token)
          if (range) headers.Range = `bytes=${range.start}-${range.end}`
          return this.fetchImpl(`${this.baseUrl}/files/${encodeURIComponent(sourceId)}?${params.toString()}`, {
            headers,
            signal: monitor.signal,
          }).catch((cause: unknown) => {
            if (isTimeoutError(cause) || monitor.timedOut) {
              throw new ImportProviderError(`Тайм-аут скачивания файла ${sourceId}`, {
                code: 'network',
                provider: this.id,
                retryable: true,
                cause,
              })
            }
            throw cause
          })
        },
      }))
      await ensureOk(this.id, response, `Не удалось скачать файл ${sourceId}`)
    } catch (error) {
      monitor.clear()
      throw error
    }
    if (!response.body) {
      monitor.clear()
      throw new ImportProviderError(`Google Drive не вернул тело файла ${sourceId}`, {
        code: 'invalid-response',
        provider: this.id,
      })
    }
    return guardStreamWithStall(response.body, monitor)
  }
}

export function createGoogleDriveProvider(options: GoogleDriveProviderOptions = {}): GoogleDriveProvider {
  return new GoogleDriveProvider(options)
}

export interface GoogleDriveTreeNode extends ImportSourceEntry {
  children?: GoogleDriveTreeNode[]
}

/**
 * Recursively walk Google Drive folders into a tree. Sequential on purpose —
 * import runs are order-sensitive and Drive enforces per-user quotas.
 */
export async function listGoogleDriveTree(
  provider: GoogleDriveProvider,
  folderId?: string,
  options: { maxDepth?: number } = {},
): Promise<GoogleDriveTreeNode[]> {
  const maxDepth = options.maxDepth ?? 64
  const walk = async (id: string | undefined, depth: number): Promise<GoogleDriveTreeNode[]> => {
    const entries = await provider.list(id)
    const nodes: GoogleDriveTreeNode[] = []
    for (const entry of entries) {
      if (entry.kind === 'folder' && depth < maxDepth) {
        nodes.push({ ...entry, children: await walk(entry.id, depth + 1) })
      } else {
        nodes.push({ ...entry })
      }
    }
    return nodes
  }
  return walk(folderId && folderId.length > 0 ? folderId : undefined, 0)
}