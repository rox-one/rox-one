/**
 * Drive cloud-import flow (wave 4) — renderer model.
 *
 * Provider descriptors plus a thin authorization client that talks to the
 * host-side OAuth broker (`drive:importAuthStart` / `drive:importAuthComplete`).
 * The renderer never runs an OAuth flow itself and never sees a token: the host
 * owns the OAuth clients, mints the tokens and persists them where the import
 * providers read them. The client is injectable so tests drive every branch
 * without network, IPC or a live host.
 *
 * Honest by construction: an unset host OAuth client surfaces as
 * «…-доступ не настроен» instead of a half-started flow, and iCloud renders the
 * shared `ICLOUD_UNSUPPORTED_MESSAGE` rather than a dead button.
 */
import type { ImportProviderId } from '@rox/shared/drive/importers/types'
import { ICLOUD_UNSUPPORTED_MESSAGE } from '@rox/shared/drive/importers/providers/icloud'

/** How a provider obtains authorization. */
export type ImportAuthKind = 'browser' | 'device-code' | 'pasted-code' | 'unsupported'

export interface ImportProviderDescriptor {
  id: ImportProviderId
  labelKey: string
  authKind: ImportAuthKind
  /**
   * Host env var that must carry this provider's OAuth client. Main-process
   * only; the renderer never reads it.
   */
  clientIdEnv: string
  /** Honest message for providers with no public file API (iCloud). */
  unsupportedMessage?: string
}

export const IMPORT_PROVIDERS: readonly ImportProviderDescriptor[] = [
  { id: 'google-drive', labelKey: 'drive.import.provider.google', authKind: 'browser', clientIdEnv: 'GOOGLE_OAUTH_CLIENT_ID' },
  { id: 'onedrive', labelKey: 'drive.import.provider.onedrive', authKind: 'device-code', clientIdEnv: 'ROX_MS_CLIENT_ID' },
  { id: 'yandex-disk', labelKey: 'drive.import.provider.yandex', authKind: 'pasted-code', clientIdEnv: 'ROX_YANDEX_CLIENT_ID' },
  { id: 'icloud', labelKey: 'drive.import.provider.icloud', authKind: 'unsupported', clientIdEnv: '', unsupportedMessage: ICLOUD_UNSUPPORTED_MESSAGE },
]

export function importProviderDescriptor(id: ImportProviderId): ImportProviderDescriptor | undefined {
  return IMPORT_PROVIDERS.find(provider => provider.id === id)
}

/** A device code the user types at the provider's verification page. */
export interface ImportDeviceCode {
  userCode: string
  verificationUri: string
  intervalSeconds: number
  expiresInSeconds: number
}

export type ImportFlowErrorKind = 'not-configured' | 'auth-failed' | 'aborted'

/** Typed failure raised by the renderer authorization client. */
export class DriveImportFlowError extends Error {
  readonly kind: ImportFlowErrorKind
  readonly provider?: ImportProviderId

  constructor(kind: ImportFlowErrorKind, message: string, provider?: ImportProviderId) {
    super(message)
    this.name = 'DriveImportFlowError'
    this.kind = kind
    if (provider) this.provider = provider
  }
}

export interface ImportAuthCallOptions {
  /** Aborting stops a pending loopback wait / device poll and any pending HTTP exchange. */
  signal?: AbortSignal
}

export interface ImportAuthCompleteOptions extends ImportAuthCallOptions {
  /** Authorization code for the pasted-code (Yandex) flow. */
  code?: string
}

/**
 * Outcome of `drive.importAuthStart` from the caller's point of view:
 *  - `authorized`  — stored tokens already exist; skip auth and go to planning.
 *  - `device-code` — show `deviceCode`, then `complete()`.
 *  - `auth-url`    — the consent URL (opened for Google; shown for Yandex).
 */
export type ImportAuthStart =
  | { status: 'authorized' }
  | { status: 'device-code'; flowId: string; deviceCode: ImportDeviceCode }
  | { status: 'auth-url'; flowId: string; authUrl: string }

/** Authorization surface consumed by the flow controller. */
export interface DriveImportAuthClient {
  /** Begin a provider's authorization; resolves the stored-token fast path or a pending flow. */
  start(provider: ImportProviderId, options?: ImportAuthCallOptions): Promise<ImportAuthStart>
  /** Finish a pending flow (code exchange or device poll) and persist the tokens host-side. */
  complete(provider: ImportProviderId, flowId: string, options?: ImportAuthCompleteOptions): Promise<void>
  /** Abandon a pending flow (best effort). */
  abort(provider: ImportProviderId): void
}

/** Raw shapes returned by the host broker RPCs. */
export type HostAuthStartResponse =
  | { ok: true; status: 'authorized' }
  | { ok: true; status: 'pending'; flowId: string; authUrl?: string; deviceCode?: ImportDeviceCode }
  | { ok: false; code: string; error: string }

export type HostAuthCompleteResponse =
  | { ok: true; email?: string }
  | { ok: false; code: string; error: string }

/**
 * The mechanics the renderer contributes to a broker flow: the two RPCs plus
 * the main-process loopback callback server used by the Google PKCE broker.
 * Injected so the client is testable without Electron.
 */
export interface DriveImportBrokerTransport {
  start(provider: ImportProviderId, options?: { callbackUrl?: string }): Promise<HostAuthStartResponse>
  complete(flowId: string, code?: string): Promise<HostAuthCompleteResponse>
  beginLoopback(): Promise<{ handle: string; callbackUrl: string }>
  openUrl(url: string): Promise<void>
  awaitLoopback(handle: string): Promise<Record<string, string>>
  cancelLoopback(handle: string): Promise<void>
}

/** Default transport: `window.electronAPI` (channel-map RPCs + loopback IPC). */
export function createElectronDriveImportTransport(api: Window['electronAPI']): DriveImportBrokerTransport {
  return {
    start: (provider, options) => api.driveImportAuthStart(provider, options),
    complete: (flowId, code) => api.driveImportAuthComplete(flowId, code),
    beginLoopback: () => api.driveImportOAuthBegin(),
    openUrl: async (url) => { await api.driveImportOAuthOpen(url) },
    awaitLoopback: async (handle) => (await api.driveImportOAuthAwait(handle)).query,
    cancelLoopback: async (handle) => { await api.driveImportOAuthCancel(handle) },
  }
}

function abortedError(): DriveImportFlowError {
  return new DriveImportFlowError('aborted', 'Авторизация отменена')
}

/** Reject as soon as `signal` aborts, without cancelling the underlying work. */
function withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(abortedError())
  const { promise: wrapped, resolve, reject } = Promise.withResolvers<T>()
  const onAbort = () => reject(abortedError())
  signal.addEventListener('abort', onAbort, { once: true })
  promise.then(
    value => { signal.removeEventListener('abort', onAbort); resolve(value) },
    error => { signal.removeEventListener('abort', onAbort); reject(error) },
  )
  return wrapped
}

function toStartError(provider: ImportProviderId, response: { code: string; error: string }): DriveImportFlowError {
  const kind: ImportFlowErrorKind =
    response.code === 'no-oauth-client' || response.code === 'unsupported' ? 'not-configured' : 'auth-failed'
  return new DriveImportFlowError(kind, response.error, provider)
}

interface PendingFlow {
  flowId: string
  /** Loopback handle for the Google PKCE flow; absent for device/code flows. */
  handle?: string
}

/**
 * Broker-backed authorization client. Google binds the main-process loopback
 * callback server, opens the consent URL and awaits the redirect; OneDrive
 * surfaces a device code; Yandex returns a consent URL for the pasted code.
 */
export function createDriveImportAuthClient(transport: DriveImportBrokerTransport): DriveImportAuthClient {
  const pending = new Map<ImportProviderId, PendingFlow>()

  async function startGoogle(provider: ImportProviderId, options?: ImportAuthCallOptions): Promise<ImportAuthStart> {
    const session = await withAbort(transport.beginLoopback(), options?.signal)
    let response: HostAuthStartResponse
    try {
      response = await withAbort(transport.start(provider, { callbackUrl: session.callbackUrl }), options?.signal)
    } catch (cause) {
      await transport.cancelLoopback(session.handle).catch(() => {})
      throw cause
    }
    if (!response.ok) {
      await transport.cancelLoopback(session.handle).catch(() => {})
      throw toStartError(provider, response)
    }
    if (response.status === 'authorized') {
      await transport.cancelLoopback(session.handle).catch(() => {})
      return { status: 'authorized' }
    }
    pending.set(provider, { flowId: response.flowId, handle: session.handle })
    const authUrl = response.authUrl ?? ''
    if (authUrl) await withAbort(transport.openUrl(authUrl), options?.signal)
    return { status: 'auth-url', flowId: response.flowId, authUrl }
  }

  async function startGeneric(provider: ImportProviderId, options?: ImportAuthCallOptions): Promise<ImportAuthStart> {
    const response = await withAbort(transport.start(provider), options?.signal)
    if (!response.ok) throw toStartError(provider, response)
    if (response.status === 'authorized') return { status: 'authorized' }
    pending.set(provider, { flowId: response.flowId })
    if (response.deviceCode) return { status: 'device-code', flowId: response.flowId, deviceCode: response.deviceCode }
    return { status: 'auth-url', flowId: response.flowId, authUrl: response.authUrl ?? '' }
  }

  return {
    async start(provider, options) {
      if (provider === 'google-drive') return startGoogle(provider, options)
      return startGeneric(provider, options)
    },

    async complete(provider, flowId, options) {
      const entry = pending.get(provider)
      let code = options?.code
      if (entry?.handle) {
        // Google: the loopback server receives the provider redirect.
        let query: Record<string, string>
        try {
          query = await withAbort(transport.awaitLoopback(entry.handle), options?.signal)
        } finally {
          pending.delete(provider)
        }
        if (query.error) {
          throw new DriveImportFlowError('auth-failed', query.error_description || query.error, provider)
        }
        code = query.code
        if (!code) throw new DriveImportFlowError('auth-failed', 'No authorization code received', provider)
      }
      try {
        const response = await withAbort(transport.complete(flowId, code), options?.signal)
        if (!response.ok) throw new DriveImportFlowError('auth-failed', response.error, provider)
      } finally {
        pending.delete(provider)
      }
    },

    abort(provider) {
      const entry = pending.get(provider)
      pending.delete(provider)
      if (entry?.handle) void transport.cancelLoopback(entry.handle).catch(() => {})
    },
  }
}