/**
 * Shared authentication + token persistence for cloud drive import providers.
 *
 * Persistence follows the repo secrets conventions (see
 * `docs/plans/2026-10-07-secrets-model.md` and `secrets/providers/local.ts`):
 * tokens are stored in the encrypted `CredentialManager`
 * (AES-256-GCM, `~/.craft-agent/credentials.enc`) under the generic
 * `service_oauth::global::<name>` slot — "the same generic workspace-scoped
 * slot the Rox cloud session uses, suitable for arbitrary user-stashed
 * secrets". No new credential type is introduced, so shared/ needs no changes
 * to `credentials/types.ts`.
 *
 * The store is injectable (`ImportTokenStore`) so unit tests never touch disk;
 * `InMemoryImportTokenStore` is exported for that purpose.
 *
 * All providers share one refresh contract: a stored `refreshToken`, an
 * `expiresAt` (Unix ms) with a refresh skew, and `fetchWithAuthRetry()` which
 * implements the mandated "401 → refresh → single retry" rule.
 */
import type { ImportProviderId } from '../types'
import { accountToCredentialId, type StoredCredential } from '../../../credentials/types.ts'
import { getCredentialManager } from '../../../credentials/manager.ts'

/** Refresh tokens this many ms before they actually expire. */
export const IMPORT_TOKEN_REFRESH_SKEW_MS = 60_000

/** Credential account used for a provider's tokens. */
export function importTokenAccount(provider: ImportProviderId): string {
  return `service_oauth::global::import-${provider}`
}

/** Typed, non-fabricated failure kinds raised by import providers. */
export type ImportErrorCode =
  | 'unsupported'
  | 'auth-missing'
  | 'auth-failed'
  | 'unauthorized'
  | 'not-found'
  | 'rate-limited'
  | 'network'
  | 'invalid-response'
  | 'http-error'

/** A provider failure with the remote status and whether a retry may help. */
export class ImportProviderError extends Error {
  readonly code: ImportErrorCode
  readonly provider?: ImportProviderId
  readonly status?: number
  readonly retryable: boolean

  constructor(
    message: string,
    options: {
      code: ImportErrorCode
      provider?: ImportProviderId
      status?: number
      retryable?: boolean
      cause?: unknown
    },
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined)
    this.name = 'ImportProviderError'
    this.code = options.code
    this.provider = options.provider
    this.status = options.status
    this.retryable = options.retryable ?? false
  }
}

/** OAuth tokens for one import provider. */
export interface ImportTokens {
  accessToken: string
  refreshToken?: string
  /** Unix epoch ms; absent means "unknown lifetime". */
  expiresAt?: number
  tokenType?: string
  scope?: string
  idToken?: string
}

/** Persistence contract; the default implementation wraps CredentialManager. */
export interface ImportTokenStore {
  load(provider: ImportProviderId): Promise<ImportTokens | null>
  save(provider: ImportProviderId, tokens: ImportTokens): Promise<void>
  clear(provider: ImportProviderId): Promise<void>
}

/** Refresh-token exchange for one provider. Must return a fresh access token. */
export type ImportRefreshFn = (refreshToken: string) => Promise<ImportTokens>

/** Injectable clock/sleep so device-code polling is testable without real time. */
export type SleepFn = (ms: number) => Promise<void>

function toStored(tokens: ImportTokens): StoredCredential {
  return {
    value: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: tokens.expiresAt,
    tokenType: tokens.tokenType,
    idToken: tokens.idToken,
    source: 'native',
  }
}

function fromStored(cred: StoredCredential): ImportTokens {
  return {
    accessToken: cred.value,
    refreshToken: cred.refreshToken,
    expiresAt: cred.expiresAt,
    tokenType: cred.tokenType,
    idToken: cred.idToken,
  }
}

/**
 * Default store: encrypted CredentialManager under the generic service slot.
 * See the module docstring for the convention this follows.
 */
export class CredentialImportTokenStore implements ImportTokenStore {
  private idFor(provider: ImportProviderId) {
    const id = accountToCredentialId(importTokenAccount(provider))
    if (!id) throw new ImportProviderError(`Некорректный слот хранилища для ${provider}`, {
      code: 'invalid-response',
      provider,
    })
    return id
  }

  async load(provider: ImportProviderId): Promise<ImportTokens | null> {
    const cred = await getCredentialManager().get(this.idFor(provider))
    if (!cred?.value) return null
    return fromStored(cred)
  }

  async save(provider: ImportProviderId, tokens: ImportTokens): Promise<void> {
    await getCredentialManager().set(this.idFor(provider), toStored(tokens))
  }

  async clear(provider: ImportProviderId): Promise<void> {
    await getCredentialManager().delete(this.idFor(provider))
  }
}

/** In-memory store for tests (and ephemeral callers). */
export class InMemoryImportTokenStore implements ImportTokenStore {
  private readonly tokens = new Map<ImportProviderId, ImportTokens>()

  async load(provider: ImportProviderId): Promise<ImportTokens | null> {
    const value = this.tokens.get(provider)
    return value ? { ...value } : null
  }

  async save(provider: ImportProviderId, tokens: ImportTokens): Promise<void> {
    this.tokens.set(provider, { ...tokens })
  }

  async clear(provider: ImportProviderId): Promise<void> {
    this.tokens.delete(provider)
  }
}

export interface ImportAuthOptions {
  store?: ImportTokenStore
  now?: () => number
  skewMs?: number
}

/**
 * Token reads + refresh orchestration, keyed by provider.
 *
 * The store is the single source of truth: `getTokens()` reads through to it on
 * every call so a write or clear performed by any other manager (or process) is
 * observed immediately, with no stale in-memory copy to invalidate.
 */
export class ImportAuthManager {
  private readonly store: ImportTokenStore
  private readonly now: () => number
  private readonly skewMs: number
  private readonly refreshers = new Map<ImportProviderId, ImportRefreshFn>()

  constructor(options: ImportAuthOptions = {}) {
    this.store = options.store ?? new CredentialImportTokenStore()
    this.now = options.now ?? (() => Date.now())
    this.skewMs = options.skewMs ?? IMPORT_TOKEN_REFRESH_SKEW_MS
  }

  /** Register the refresh exchange a provider uses (enables `refreshIfNeeded(p)`). */
  registerRefresher(provider: ImportProviderId, refresh: ImportRefreshFn): void {
    this.refreshers.set(provider, refresh)
  }

  async getTokens(provider: ImportProviderId): Promise<ImportTokens | null> {
    return this.store.load(provider)
  }

  async requireTokens(provider: ImportProviderId): Promise<ImportTokens> {
    const tokens = await this.getTokens(provider)
    if (!tokens) {
      throw new ImportProviderError(`Нет сохранённой авторизации для ${provider}`, {
        code: 'auth-missing',
        provider,
      })
    }
    return tokens
  }

  async setTokens(provider: ImportProviderId, tokens: ImportTokens): Promise<void> {
    await this.store.save(provider, tokens)
  }

  async clearTokens(provider: ImportProviderId): Promise<void> {
    await this.store.clear(provider)
  }

  /** True when the token is expired or within the refresh skew. */
  needsRefresh(tokens: ImportTokens): boolean {
    if (!tokens.refreshToken) return false
    if (tokens.expiresAt === undefined) return false
    return tokens.expiresAt - this.skewMs <= this.now()
  }

  /** Refresh only when needed; otherwise return the current tokens. */
  async refreshIfNeeded(provider: ImportProviderId, refresh?: ImportRefreshFn): Promise<ImportTokens> {
    const current = await this.requireTokens(provider)
    if (!this.needsRefresh(current)) return current
    return this.refresh(provider, refresh, current)
  }

  /** Force a refresh-token exchange and persist the result. */
  async refresh(
    provider: ImportProviderId,
    refresh?: ImportRefreshFn,
    current?: ImportTokens,
  ): Promise<ImportTokens> {
    const tokens = current ?? (await this.requireTokens(provider))
    if (!tokens.refreshToken) {
      throw new ImportProviderError(`Нет refresh-токена для ${provider}`, {
        code: 'auth-missing',
        provider,
      })
    }
    const refresher = refresh ?? this.refreshers.get(provider)
    if (!refresher) {
      throw new ImportProviderError(`Не задан обработчик обновления токена для ${provider}`, {
        code: 'auth-failed',
        provider,
      })
    }
    let next: ImportTokens
    try {
      next = await refresher(tokens.refreshToken)
    } catch (cause) {
      if (cause instanceof ImportProviderError) throw cause
      throw new ImportProviderError(`Не удалось обновить токен ${provider}`, {
        code: 'auth-failed',
        provider,
        cause,
      })
    }
    if (!next?.accessToken) {
      throw new ImportProviderError(`Пустой ответ обновления токена для ${provider}`, {
        code: 'invalid-response',
        provider,
      })
    }
    // Preserve the prior refresh token when the server does not rotate it.
    const merged: ImportTokens = next.refreshToken ? next : { ...next, refreshToken: tokens.refreshToken }
    await this.setTokens(provider, merged)
    return merged
  }
}

let defaultAuthManager: ImportAuthManager | null = null

/** Process-wide default auth manager (encrypted credential store). */
export function getImportAuth(): ImportAuthManager {
  if (!defaultAuthManager) defaultAuthManager = new ImportAuthManager()
  return defaultAuthManager
}

/**
 * Convenience wrapper over the default manager. Uses the refresher registered
 * for the provider when none is passed.
 */
export function refreshIfNeeded(provider: ImportProviderId, refresh?: ImportRefreshFn): Promise<ImportTokens> {
  return getImportAuth().refreshIfNeeded(provider, refresh)
}

export interface AuthRetryOptions {
  auth: ImportAuthManager
  provider: ImportProviderId
  /** Perform one authenticated attempt with the supplied bearer token. */
  request: (accessToken: string) => Promise<Response>
  refresh?: ImportRefreshFn
}

export interface AuthRetryResult {
  response: Response
  accessToken: string
}

/**
 * Run an authenticated request, refreshing proactively when the token is
 * near expiry and once reactively on a 401. Exactly one retry: a second 401
 * surfaces as a typed `unauthorized` error rather than looping.
 */
export async function fetchWithAuthRetry(options: AuthRetryOptions): Promise<AuthRetryResult> {
  const { auth, provider, request } = options
  const tokens = await auth.refreshIfNeeded(provider, options.refresh)
  let accessToken = tokens.accessToken
  let response = await request(accessToken)
  if (response.status !== 401) return { response, accessToken }

  if (!tokens.refreshToken && !(await auth.getTokens(provider))?.refreshToken) {
    throw new ImportProviderError(`Токен доступа ${provider} отклонён, а refresh-токен отсутствует`, {
      code: 'unauthorized',
      provider,
      status: 401,
    })
  }
  const refreshed = await auth.refresh(provider, options.refresh)
  accessToken = refreshed.accessToken
  response = await request(accessToken)
  if (response.status === 401) {
    throw new ImportProviderError(`Токен доступа ${provider} отклонён после обновления`, {
      code: 'unauthorized',
      provider,
      status: 401,
    })
  }
  return { response, accessToken }
}

/** Build a typed error from a non-2xx response, reading a short body snippet. */
export async function providerHttpError(
  provider: ImportProviderId,
  response: Response,
  context: string,
): Promise<ImportProviderError> {
  let detail = ''
  try {
    detail = (await response.text()).slice(0, 500)
  } catch {
    detail = ''
  }
  const status = response.status
  const code: ImportErrorCode =
    status === 401 ? 'unauthorized'
      : status === 403 ? 'auth-failed'
        : status === 404 ? 'not-found'
          : status === 429 ? 'rate-limited'
            : 'http-error'
  const suffix = detail ? `: ${detail}` : ''
  return new ImportProviderError(`${context} — HTTP ${status}${suffix}`, {
    code,
    provider,
    status,
    retryable: status === 429 || status >= 500,
  })
}

/** Throw a typed error for a non-2xx response. */
export async function ensureOk(
  provider: ImportProviderId,
  response: Response,
  context: string,
): Promise<Response> {
  if (!response.ok) throw await providerHttpError(provider, response, context)
  return response
}

/** Bearer + Accept JSON headers for provider REST calls. */
export function jsonAuthHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
  }
}