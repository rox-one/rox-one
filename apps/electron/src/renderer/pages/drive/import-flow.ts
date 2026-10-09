/**
 * Drive cloud-import flow (wave 4) — renderer model.
 *
 * Provider descriptors plus an authorization client built on the shared
 * provider helpers (`@rox/shared/drive/importers/providers/*`). The client is
 * injectable so tests drive every branch without network or a live host; the
 * default implementation reads its OAuth client ids from the host env and
 * talks to Google / Microsoft / Yandex over plain `fetch`.
 *
 * Honest by construction: an unset client id surfaces as «…-доступ не настроен»
 * instead of a half-started flow, and iCloud renders the shared
 * `ICLOUD_UNSUPPORTED_MESSAGE` rather than a dead button.
 */
import type { ImportJob, ImportProviderId } from '@rox/shared/drive/importers/types'
import { ICLOUD_UNSUPPORTED_MESSAGE } from '@rox/shared/drive/importers/providers/icloud'
import {
  startGoogleDeviceCode,
  pollGoogleDeviceToken,
} from '@rox/shared/drive/importers/providers/google-drive'
import {
  startMsDeviceCode,
  pollMsDeviceToken,
} from '@rox/shared/drive/importers/providers/onedrive'
import {
  buildYandexAuthUrl,
  completeYandexAuth,
} from '@rox/shared/drive/importers/providers/yandex-disk'

/** Yandex shows the authorization code on this fixed page for manual pasting. */
export const YANDEX_VERIFICATION_REDIRECT = 'https://oauth.yandex.ru/verification_code'

export type ImportAuthKind = 'device-code' | 'yandex-code' | 'unsupported'

export interface ImportProviderDescriptor {
  id: ImportProviderId
  labelKey: string
  authKind: ImportAuthKind
  /** Env var the host must set for this provider's OAuth client. Empty when unsupported. */
  clientIdEnv: string
  /** Honest message for providers with no public file API (iCloud). */
  unsupportedMessage?: string
}

export const IMPORT_PROVIDERS: readonly ImportProviderDescriptor[] = [
  { id: 'google-drive', labelKey: 'drive.import.provider.google', authKind: 'device-code', clientIdEnv: 'ROX_GOOGLE_CLIENT_ID' },
  { id: 'onedrive', labelKey: 'drive.import.provider.onedrive', authKind: 'device-code', clientIdEnv: 'ROX_MS_CLIENT_ID' },
  { id: 'yandex-disk', labelKey: 'drive.import.provider.yandex', authKind: 'yandex-code', clientIdEnv: 'ROX_YANDEX_CLIENT_ID' },
  { id: 'icloud', labelKey: 'drive.import.provider.icloud', authKind: 'unsupported', clientIdEnv: '', unsupportedMessage: ICLOUD_UNSUPPORTED_MESSAGE },
]

export function importProviderDescriptor(id: ImportProviderId): ImportProviderDescriptor | undefined {
  return IMPORT_PROVIDERS.find(provider => provider.id === id)
}

/** Human provider name used in the «…-доступ не настроен» message. */
export function importProviderName(id: ImportProviderId): string {
  switch (id) {
    case 'google-drive': return 'Google'
    case 'onedrive': return 'OneDrive'
    case 'yandex-disk': return 'Яндекс'
    case 'icloud': return 'iCloud'
  }
}

/** A device code the user types at the provider's verification page. */
export interface ImportDeviceCode {
  userCode: string
  verificationUri: string
  intervalSeconds: number
  expiresInSeconds: number
}

/**
 * The public device-code view plus the opaque `deviceCode` the token endpoint
 * needs. The raw value is never rendered — the dialog reads only the view
 * fields — but polling requires it.
 */
export interface ImportDeviceCodeCarrier extends ImportDeviceCode {
  deviceCode: string
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
  /** Aborting stops device-code polling and the pending HTTP exchange. */
  signal?: AbortSignal
}

/** Authorization surface consumed by the flow controller. */
export interface DriveImportAuthClient {
  /** Resolve the OAuth client id for a provider, or `null` when the env is unset. */
  isConfigured(provider: ImportProviderId): boolean
  /** Begin the provider's device-code flow. */
  startDeviceCode(provider: ImportProviderId, options?: ImportAuthCallOptions): Promise<ImportDeviceCodeCarrier>
  /** Resolve once authorized; reject on denial, expiry or abort. */
  pollDeviceCode(provider: ImportProviderId, code: ImportDeviceCodeCarrier, options?: ImportAuthCallOptions): Promise<void>
  /** Consent-screen URL for the Yandex authorization-code flow. */
  yandexAuthUrl(provider: ImportProviderId, options?: ImportAuthCallOptions): Promise<string>
  /** Exchange a pasted Yandex authorization code for tokens. */
  completeYandexCode(provider: ImportProviderId, code: string, options?: ImportAuthCallOptions): Promise<void>
}

/** Env/config overrides for the default client; unset values fall back to the host env. */
export interface DriveImportAuthEnv {
  googleClientId?: string
  googleClientSecret?: string
  msClientId?: string
  yandexClientId?: string
  yandexClientSecret?: string
  fetchImpl?: typeof fetch
}

/** Reads one `process.env` entry, tolerating hosts that expose no `process`. */
export function readHostEnv(name: string): string | undefined {
  const globalProcess: unknown = Reflect.get(globalThis, 'process')
  if (typeof globalProcess !== 'object' || globalProcess === null || !('env' in globalProcess)) return undefined
  const env = globalProcess.env
  if (typeof env !== 'object' || env === null || !(name in env)) return undefined
  const value = Reflect.get(env, name)
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** `setTimeout` that rejects as soon as `signal` aborts, so polling stops cleanly. */
function abortableSleep(signal?: AbortSignal): (ms: number) => Promise<void> {
  return (ms) => {
    const { promise, resolve, reject } = Promise.withResolvers<void>()
    if (signal?.aborted) {
      reject(new DriveImportFlowError('aborted', 'Авторизация отменена'))
      return promise
    }
    const onAbort = () => {
      clearTimeout(timer)
      reject(new DriveImportFlowError('aborted', 'Авторизация отменена'))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
    return promise
  }
}

function toFlowError(cause: unknown, provider: ImportProviderId): DriveImportFlowError {
  if (cause instanceof DriveImportFlowError) return cause
  const message = cause instanceof Error && cause.message ? cause.message : 'Авторизация не удалась'
  return new DriveImportFlowError('auth-failed', message, provider)
}

/**
 * Default authorization client. Client ids/secrets are read from an explicit
 * override first and the host env second, and are always passed to the shared
 * helpers explicitly so the helpers never touch a missing `process.env`
 * in the renderer.
 */
export function createDriveImportAuthClient(env: DriveImportAuthEnv = {}): DriveImportAuthClient {
  const googleId = env.googleClientId ?? readHostEnv('ROX_GOOGLE_CLIENT_ID')
  const googleSecret = env.googleClientSecret ?? readHostEnv('ROX_GOOGLE_CLIENT_SECRET') ?? ''
  const msId = env.msClientId ?? readHostEnv('ROX_MS_CLIENT_ID')
  const yandexId = env.yandexClientId ?? readHostEnv('ROX_YANDEX_CLIENT_ID')
  const yandexSecret = env.yandexClientSecret ?? readHostEnv('ROX_YANDEX_CLIENT_SECRET') ?? ''
  const fetchImpl = env.fetchImpl

  function requireClientId(provider: ImportProviderId): string {
    const value = provider === 'google-drive' ? googleId : provider === 'onedrive' ? msId : yandexId
    if (!value) {
      throw new DriveImportFlowError('not-configured', `${importProviderName(provider)}-доступ не настроен`, provider)
    }
    return value
  }

  return {
    isConfigured(provider) {
      if (provider === 'google-drive') return Boolean(googleId)
      if (provider === 'onedrive') return Boolean(msId)
      if (provider === 'yandex-disk') return Boolean(yandexId)
      return false
    },

    async startDeviceCode(provider, options) {
      try {
        if (provider === 'google-drive') {
          const started = await startGoogleDeviceCode({ clientId: requireClientId(provider), ...(fetchImpl ? { fetchImpl } : {}) })
          return {
            deviceCode: started.deviceCode,
            userCode: started.userCode,
            verificationUri: started.verificationUrl,
            intervalSeconds: started.interval,
            expiresInSeconds: started.expiresIn,
          }
        }
        if (provider === 'onedrive') {
          const started = await startMsDeviceCode({ clientId: requireClientId(provider), ...(fetchImpl ? { fetchImpl } : {}) })
          return {
            deviceCode: started.deviceCode,
            userCode: started.userCode,
            verificationUri: started.verificationUri,
            intervalSeconds: started.interval,
            expiresInSeconds: started.expiresIn,
          }
        }
        throw new DriveImportFlowError('auth-failed', 'Для этого провайдера не поддерживается код устройства', provider)
      } catch (cause) {
        options?.signal?.throwIfAborted?.()
        throw toFlowError(cause, provider)
      }
    },

    async pollDeviceCode(provider, code, options) {
      const sleep = abortableSleep(options?.signal)
      try {
        if (provider === 'google-drive') {
          await pollGoogleDeviceToken({
            deviceCode: code.deviceCode,
            clientId: requireClientId(provider),
            clientSecret: googleSecret,
            interval: code.intervalSeconds,
            expiresIn: code.expiresInSeconds,
            sleep,
            ...(fetchImpl ? { fetchImpl } : {}),
          })
          return
        }
        if (provider === 'onedrive') {
          await pollMsDeviceToken({
            deviceCode: code.deviceCode,
            clientId: requireClientId(provider),
            interval: code.intervalSeconds,
            expiresIn: code.expiresInSeconds,
            sleep,
            ...(fetchImpl ? { fetchImpl } : {}),
          })
          return
        }
        throw new DriveImportFlowError('auth-failed', 'Для этого провайдера не поддерживается код устройства', provider)
      } catch (cause) {
        if (cause instanceof DriveImportFlowError && cause.kind === 'aborted') throw cause
        throw toFlowError(cause, provider)
      }
    },

    async yandexAuthUrl(provider, options) {
      try {
        return buildYandexAuthUrl({ redirectUri: YANDEX_VERIFICATION_REDIRECT, clientId: requireClientId(provider) })
      } catch (cause) {
        options?.signal?.throwIfAborted?.()
        throw toFlowError(cause, provider)
      }
    },

    async completeYandexCode(provider, code, options) {
      try {
        await completeYandexAuth({
          code,
          clientId: requireClientId(provider),
          clientSecret: yandexSecret,
          ...(fetchImpl ? { fetchImpl } : {}),
        })
      } catch (cause) {
        if (cause instanceof DriveImportFlowError && cause.kind === 'aborted') throw cause
        throw toFlowError(cause, provider)
      }
    },
  }
}