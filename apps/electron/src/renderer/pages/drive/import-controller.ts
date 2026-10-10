/**
 * Drive cloud-import flow controller (wave 4).
 *
 * Framework-agnostic state machine the dialog subscribes to: pick a provider →
 * authorize through the host broker → plan + start the host job
 * (`drive:import*`) → poll `drive:importStatus` every `pollMs` and expose
 * pause/resume. The controller owns no timers of its own — `schedule`/
 * `cancelSchedule` are injected so tests step time by hand.
 *
 * It never invents progress: every phase change is driven by an RPC result or
 * an authorization result, and failures carry the provider's own message
 * (`«Google-доступ не настроен»`, `UNSUPPORTED_OPERATION`, …).
 *
 * A generation counter invalidates in-flight work: `start`/`cancel`/`reset`/
 * `dispose` bump it, and every await re-checks it, so a late status/pause
 * promise cannot resurrect the dialog or re-arm polling.
 */
import type { ImportJob, ImportProviderId } from '@rox/shared/drive/importers/types'
import { toErrorMessage } from '../../lib/errors'
import {
  DriveImportFlowError,
  importProviderDescriptor,
  type DriveImportAuthClient,
  type ImportDeviceCode,
} from './import-flow'

/** The `drive:import*` RPC surface the controller drives. */
export interface DriveImportApi {
  driveImportPlan(provider: ImportProviderId, folderId?: string): Promise<ImportJob>
  driveImportStart(jobId: string): Promise<ImportJob>
  driveImportPause(jobId: string): Promise<ImportJob>
  driveImportCancel(jobId: string): Promise<ImportJob>
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
  | 'cancelled'
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
  /**
   * Cancel the running job (via `drive:importCancel`) and render its cancelled
   * state. With no live job this just abandons any authorization.
   */
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
  const message = toErrorMessage(cause)
  return message.trim().length > 0 ? message : 'Импорт не удался'
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
  /** Pending Yandex flow id, kept between `start` and `submitYandexCode`. */
  let yandexFlowId: string | null = null
  /** Bumped by every state transition that must invalidate in-flight work. */
  let generation = 0

  function bumpGeneration(): number {
    generation += 1
    return generation
  }

  function stale(gen: number): boolean {
    return disposed || gen !== generation
  }

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
    if (state.provider) deps.auth.abort(state.provider)
  }

  function schedulePoll(jobId: string, gen: number): void {
    stopPolling()
    const tick = async () => {
      pollHandle = null
      if (stale(gen)) return
      try {
        const value = await deps.api.driveImportStatus(jobId)
        if (stale(gen)) return
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
        if (stale(gen)) return
        emit({ phase: 'error', error: messageOf(cause), retryable: true })
      }
    }
    pollHandle = schedule(() => void tick(), pollMs)
  }

  async function planAndStart(provider: ImportProviderId, gen: number): Promise<void> {
    emit({ phase: 'planning', provider, error: null, retryable: true })
    try {
      const planned = await deps.api.driveImportPlan(provider)
      if (stale(gen)) return
      const started = await deps.api.driveImportStart(planned.id)
      if (stale(gen)) return
      emit({ phase: 'job', job: started, error: started.error ?? null })
      schedulePoll(planned.id, gen)
    } catch (cause) {
      if (stale(gen)) return
      emit({ phase: 'error', provider, error: messageOf(cause), retryable: true })
    }
  }

  async function runAuthorization(provider: ImportProviderId, gen: number): Promise<void> {
    const controller = new AbortController()
    authAbort = controller
    emit({ phase: 'authorizing', provider, deviceCode: null, expiresAt: null, error: null, retryable: true })
    try {
      const begun = await deps.auth.start(provider, { signal: controller.signal })
      if (stale(gen)) return
      if (begun.status === 'authorized') {
        authAbort = null
        await planAndStart(provider, gen)
        return
      }
      if (begun.status === 'device-code') {
        emit({
          deviceCode: begun.deviceCode,
          expiresAt: now() + begun.deviceCode.expiresInSeconds * 1000,
        })
      }
      await deps.auth.complete(provider, begun.flowId, { signal: controller.signal })
      if (stale(gen)) return
      authAbort = null
      await planAndStart(provider, gen)
    } catch (cause) {
      if (cause instanceof DriveImportFlowError && cause.kind === 'aborted') return
      if (stale(gen)) return
      emit({
        phase: 'error',
        provider,
        error: messageOf(cause),
        retryable: !(cause instanceof DriveImportFlowError && cause.kind === 'not-configured'),
      })
    }
  }

  async function runYandexConsent(provider: ImportProviderId, gen: number): Promise<void> {
    const controller = new AbortController()
    authAbort = controller
    emit({ phase: 'yandex-code', provider, yandexUrl: null, error: null, retryable: true })
    try {
      const begun = await deps.auth.start(provider, { signal: controller.signal })
      if (stale(gen)) return
      if (begun.status === 'authorized') {
        authAbort = null
        await planAndStart(provider, gen)
        return
      }
      if (begun.status === 'auth-url') {
        yandexFlowId = begun.flowId
        emit({ yandexUrl: begun.authUrl })
      }
      authAbort = null
    } catch (cause) {
      if (cause instanceof DriveImportFlowError && cause.kind === 'aborted') return
      if (stale(gen)) return
      emit({
        phase: 'error',
        provider,
        error: messageOf(cause),
        retryable: !(cause instanceof DriveImportFlowError && cause.kind === 'not-configured'),
      })
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
      const gen = bumpGeneration()
      abortAuthorization()
      stopPolling()
      yandexFlowId = null
      const descriptor = importProviderDescriptor(provider)
      if (!descriptor) return
      emit({ ...INITIAL_STATE, provider })
      if (descriptor.authKind === 'unsupported') {
        emit({ phase: 'unsupported', provider, error: descriptor.unsupportedMessage ?? null, retryable: false })
        return
      }
      if (descriptor.authKind === 'pasted-code') {
        void runYandexConsent(provider, gen)
        return
      }
      void runAuthorization(provider, gen)
    },

    submitYandexCode(code) {
      const provider = state.provider
      const trimmed = code.trim()
      const flowId = yandexFlowId
      if (disposed || !provider || !flowId || state.phase !== 'yandex-code' || trimmed.length === 0) return
      const gen = generation
      const controller = new AbortController()
      authAbort = controller
      emit({ phase: 'authorizing', yandexUrl: null, error: null, retryable: true })
      void (async () => {
        try {
          await deps.auth.complete(provider, flowId, { code: trimmed, signal: controller.signal })
          if (stale(gen)) return
          authAbort = null
          await planAndStart(provider, gen)
        } catch (cause) {
          if (cause instanceof DriveImportFlowError && cause.kind === 'aborted') return
          if (stale(gen)) return
          emit({
            phase: 'error',
            provider,
            error: messageOf(cause),
            retryable: !(cause instanceof DriveImportFlowError && cause.kind === 'not-configured'),
          })
        }
      })()
    },

    pause() {
      const job = state.job
      if (disposed || !job) return
      const gen = generation
      void deps.api.driveImportPause(job.id)
        .then(next => { if (!stale(gen)) emit({ job: next }) })
        .catch(cause => { if (!stale(gen)) emit({ error: messageOf(cause) }) })
    },

    resume() {
      const job = state.job
      if (disposed || !job) return
      const gen = generation
      void deps.api.driveImportResume(job.id)
        .then(next => { if (!stale(gen)) emit({ phase: 'job', job: next, error: null }) })
        .catch(cause => { if (!stale(gen)) emit({ error: messageOf(cause) }) })
    },

    cancel() {
      if (disposed) return
      const job = state.job
      const gen = bumpGeneration()
      abortAuthorization()
      stopPolling()
      yandexFlowId = null
      if (!job || job.status === 'done' || job.status === 'error' || job.status === 'cancelled') {
        emit({ ...INITIAL_STATE })
        return
      }
      void deps.api.driveImportCancel(job.id)
        .then(next => { if (!stale(gen)) emit({ phase: 'cancelled', job: next, error: null }) })
        .catch(cause => { if (!stale(gen)) emit({ phase: 'error', job, error: messageOf(cause), retryable: true }) })
    },

    reset() {
      bumpGeneration()
      abortAuthorization()
      stopPolling()
      yandexFlowId = null
      emit({ ...INITIAL_STATE })
    },

    dispose() {
      bumpGeneration()
      disposed = true
      abortAuthorization()
      stopPolling()
      listeners.clear()
    },
  }
}