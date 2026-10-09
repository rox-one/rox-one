/**
 * Drive cloud-import flow controller (wave 4).
 *
 * Framework-agnostic state machine the dialog subscribes to: pick a provider →
 * authorize (device code for Google/OneDrive, pasted code for Yandex) → plan +
 * start the host job (`drive:import*`) → poll `drive:importStatus` every
 * `pollMs` and expose pause/resume. The controller owns no timers of its own —
 * `schedule`/`cancelSchedule` are injected so tests step time by hand.
 *
 * It never invents progress: every phase change is driven by an RPC result or
 * an authorization result, and failures carry the provider's own message
 * (`«Google-доступ не настроен»`, `UNSUPPORTED_OPERATION`, …).
 */
import type { ImportJob, ImportProviderId } from '@rox/shared/drive/importers/types'
import {
  DriveImportFlowError,
  importProviderDescriptor,
  importProviderName,
  type DriveImportAuthClient,
  type ImportDeviceCode,
} from './import-flow'

/** The `drive:import*` RPC surface the controller drives. */
export interface DriveImportApi {
  driveImportPlan(provider: ImportProviderId, folderId?: string): Promise<ImportJob>
  driveImportStart(jobId: string): Promise<ImportJob>
  driveImportPause(jobId: string): Promise<ImportJob>
  driveImportResume(jobId: string): Promise<ImportJob>
  driveImportStatus(jobId: string): Promise<ImportJob | ImportJob[] | null>
}

export type DriveImportPhase =
  | 'choose'
  | 'authorizing'
  | 'yandex-code'
  | 'planning'
  | 'job'
  | 'done'
  | 'error'
  | 'unsupported'

export interface DriveImportState {
  phase: DriveImportPhase
  provider: ImportProviderId | null
  /** Public device-code view while waiting for authorization, else null. */
  deviceCode: ImportDeviceCode | null
  /** Epoch ms when the device code expires, else null. */
  expiresAt: number | null
  /** Yandex consent-screen URL while the code is being pasted, else null. */
  yandexUrl: string | null
  job: ImportJob | null
  error: string | null
  /** Whether retrying the current provider could plausibly help. */
  retryable: boolean
}

export interface DriveImportControllerDeps {
  auth: DriveImportAuthClient
  api: DriveImportApi
  now?: () => number
  pollMs?: number
  /** Schedules one poll tick; returns an opaque handle for `cancelSchedule`. */
  schedule?: (callback: () => void, ms: number) => unknown
  cancelSchedule?: (handle: unknown) => void
}

export interface DriveImportController {
  getState(): DriveImportState
  subscribe(listener: (state: DriveImportState) => void): () => void
  start(provider: ImportProviderId): void
  submitYandexCode(code: string): void
  pause(): void
  resume(): void
  /** Stop the running job (via `drive:importPause`) and return to the picker. */
  cancel(): void
  /** Abandon any authorization and return to the picker. */
  reset(): void
  dispose(): void
}

const DEFAULT_POLL_MS = 1500

const INITIAL_STATE: DriveImportState = {
  phase: 'choose',
  provider: null,
  deviceCode: null,
  expiresAt: null,
  yandexUrl: null,
  job: null,
  error: null,
  retryable: true,
}

function messageOf(cause: unknown): string {
  if (cause instanceof Error && cause.message) return cause.message
  if (typeof cause === 'string' && cause.length > 0) return cause
  return 'Импорт не удался'
}

export function createDriveImportController(deps: DriveImportControllerDeps): DriveImportController {
  const now = deps.now ?? Date.now
  const pollMs = deps.pollMs ?? DEFAULT_POLL_MS
  const schedule = deps.schedule ?? ((callback, ms) => setTimeout(callback, ms))
  const cancelSchedule = deps.cancelSchedule ?? ((handle: unknown) => {
    if (typeof handle === 'number') clearTimeout(handle)
  })

  let state: DriveImportState = { ...INITIAL_STATE }
  const listeners = new Set<(state: DriveImportState) => void>()
  let authAbort: AbortController | null = null
  let pollHandle: unknown = null
  let disposed = false

  function emit(next: Partial<DriveImportState>): void {
    if (disposed) return
    state = { ...state, ...next }
    for (const listener of listeners) listener(state)
  }

  function stopPolling(): void {
    if (pollHandle !== null) {
      cancelSchedule(pollHandle)
      pollHandle = null
    }
  }

  function abortAuthorization(): void {
    authAbort?.abort()
    authAbort = null
  }

  function schedulePoll(jobId: string): void {
    stopPolling()
    const tick = async () => {
      pollHandle = null
      if (disposed) return
      try {
        const value = await deps.api.driveImportStatus(jobId)
        const job = Array.isArray(value) ? value.find(entry => entry.id === jobId) ?? value[0] ?? null : value
        if (!job) {
          pollHandle = schedule(() => void tick(), pollMs)
          return
        }
        if (job.status === 'done') {
          emit({ phase: 'done', job, error: job.error ?? null, retryable: false })
          return
        }
        if (job.status === 'error') {
          emit({ phase: 'error', job, error: job.error ?? 'Импорт завершился с ошибкой', retryable: true })
          return
        }
        emit({ phase: 'job', job, error: null })
        pollHandle = schedule(() => void tick(), pollMs)
      } catch (cause) {
        emit({ phase: 'error', error: messageOf(cause), retryable: true })
      }
    }
    pollHandle = schedule(() => void tick(), pollMs)
  }

  async function planAndStart(provider: ImportProviderId): Promise<void> {
    emit({ phase: 'planning', provider, error: null, retryable: true })
    try {
      const planned = await deps.api.driveImportPlan(provider)
      const started = await deps.api.driveImportStart(planned.id)
      emit({ phase: 'job', job: started, error: started.error ?? null })
      schedulePoll(planned.id)
    } catch (cause) {
      emit({ phase: 'error', provider, error: messageOf(cause), retryable: true })
    }
  }

  async function runDeviceCode(provider: ImportProviderId): Promise<void> {
    const controller = new AbortController()
    authAbort = controller
    emit({ phase: 'authorizing', provider, deviceCode: null, expiresAt: null, error: null, retryable: true })
    try {
      const code = await deps.auth.startDeviceCode(provider, { signal: controller.signal })
      if (controller.signal.aborted || disposed) return
      emit({
        deviceCode: {
          userCode: code.userCode,
          verificationUri: code.verificationUri,
          intervalSeconds: code.intervalSeconds,
          expiresInSeconds: code.expiresInSeconds,
        },
        expiresAt: now() + code.expiresInSeconds * 1000,
      })
      await deps.auth.pollDeviceCode(provider, code, { signal: controller.signal })
      if (controller.signal.aborted || disposed) return
      authAbort = null
      await planAndStart(provider)
    } catch (cause) {
      if (cause instanceof DriveImportFlowError && cause.kind === 'aborted') return
      emit({ phase: 'error', provider, error: messageOf(cause), retryable: true })
    }
  }

  async function runYandexConsent(provider: ImportProviderId): Promise<void> {
    const controller = new AbortController()
    authAbort = controller
    emit({ phase: 'yandex-code', provider, yandexUrl: null, error: null, retryable: true })
    try {
      const url = await deps.auth.yandexAuthUrl(provider, { signal: controller.signal })
      if (controller.signal.aborted || disposed) return
      emit({ yandexUrl: url })
    } catch (cause) {
      if (cause instanceof DriveImportFlowError && cause.kind === 'aborted') return
      emit({ phase: 'error', provider, error: messageOf(cause), retryable: true })
    }
  }

  return {
    getState: () => state,

    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    start(provider) {
      if (disposed) return
      abortAuthorization()
      stopPolling()
      const descriptor = importProviderDescriptor(provider)
      if (!descriptor) return
      emit({ ...INITIAL_STATE, provider })
      if (descriptor.authKind === 'unsupported') {
        emit({ phase: 'unsupported', provider, error: descriptor.unsupportedMessage ?? null, retryable: false })
        return
      }
      if (!deps.auth.isConfigured(provider)) {
        emit({
          phase: 'error',
          provider,
          error: `${importProviderName(provider)}-доступ не настроен`,
          retryable: false,
        })
        return
      }
      if (descriptor.authKind === 'device-code') {
        void runDeviceCode(provider)
        return
      }
      void runYandexConsent(provider)
    },

    submitYandexCode(code) {
      const provider = state.provider
      const trimmed = code.trim()
      if (disposed || !provider || state.phase !== 'yandex-code' || trimmed.length === 0) return
      const controller = new AbortController()
      authAbort = controller
      emit({ phase: 'authorizing', error: null, retryable: true })
      void (async () => {
        try {
          await deps.auth.completeYandexCode(provider, trimmed, { signal: controller.signal })
          if (controller.signal.aborted || disposed) return
          authAbort = null
          await planAndStart(provider)
        } catch (cause) {
          if (cause instanceof DriveImportFlowError && cause.kind === 'aborted') return
          emit({ phase: 'error', provider, error: messageOf(cause), retryable: true })
        }
      })()
    },

    pause() {
      const job = state.job
      if (disposed || !job) return
      void deps.api.driveImportPause(job.id)
        .then(next => emit({ job: next }))
        .catch(cause => emit({ error: messageOf(cause) }))
    },

    resume() {
      const job = state.job
      if (disposed || !job) return
      void deps.api.driveImportResume(job.id)
        .then(next => emit({ phase: 'job', job: next, error: null }))
        .catch(cause => emit({ error: messageOf(cause) }))
    },

    cancel() {
      const job = state.job
      abortAuthorization()
      stopPolling()
      if (job && job.status !== 'done' && job.status !== 'error') {
        void deps.api.driveImportPause(job.id).catch(() => {})
      }
      emit({ ...INITIAL_STATE })
    },

    reset() {
      abortAuthorization()
      stopPolling()
      emit({ ...INITIAL_STATE })
    },

    dispose() {
      disposed = true
      abortAuthorization()
      stopPolling()
      listeners.clear()
    },
  }
}