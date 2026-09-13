/**
 * First-run UI adapter for ROX-AUD-151 / #340.
 *
 * Offline Note → session → Outcome → Task artifacts are written locally first.
 * Import or persist failures are recorded and never block Get Started.
 *
 * Preinstalled first-result is not mic capture, auto-send, or unbounded spend.
 * Ports may persist a local note; they must not start capture, auto-send a
 * chat, mint a billed task, or claim the meetings vertical gate.
 */

import {
  advanceFirstResult,
  emptyFirstResult,
  parseFirstResultCheckpoint,
  recordFirstResultError,
  resumeFirstResult,
  seedOfflineFirstResult,
  skipFirstResult,
  type FirstResultCheckpoint,
  type FirstResultStore,
} from '@craft-agent/core/rox2'

export const FIRST_RESULT_STORAGE_KEY = 'rox.onboarding.first-result.v1'
export const FIRST_RESULT_ARTIFACTS_KEY = 'rox.onboarding.first-result.artifacts.v1'

export type StorageLike = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export type FirstResultNoteArtifact = {
  id: string
  title: string
  body: string
}

export type FirstResultTaskArtifact = {
  id: string
  title: string
}

export type FirstResultArtifacts = {
  note: FirstResultNoteArtifact
  sessionId: string
  outcome: { id: string; title: string }
  task: FirstResultTaskArtifact
}

export type FirstResultCopy = {
  noteTitle: string
  noteBody: string
  outcomeTitle: string
  taskTitle: string
}

export type FirstResultPorts = {
  now?: () => number
  persistNote?: (note: FirstResultNoteArtifact) => Promise<void>
  persistTask?: (task: FirstResultTaskArtifact) => Promise<void>
  importNotes?: () => Promise<void>
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function createStorageAdapter(storage: StorageLike): FirstResultStore {
  return {
    get() {
      try {
        const raw = storage.getItem(FIRST_RESULT_STORAGE_KEY)
        return raw ? parseFirstResultCheckpoint(JSON.parse(raw)) : null
      } catch {
        return null
      }
    },
    set(value) {
      storage.setItem(FIRST_RESULT_STORAGE_KEY, JSON.stringify(value))
    },
  }
}

export function loadFirstResultArtifacts(storage: StorageLike): FirstResultArtifacts | null {
  try {
    const raw = storage.getItem(FIRST_RESULT_ARTIFACTS_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as FirstResultArtifacts
    if (!parsed?.note?.id || !parsed?.task?.id) return null
    return parsed
  } catch {
    return null
  }
}

function writeArtifacts(storage: StorageLike, artifacts: FirstResultArtifacts): void {
  storage.setItem(FIRST_RESULT_ARTIFACTS_KEY, JSON.stringify(artifacts))
}

export function skipSetupLandingStep(): 'complete' {
  return 'complete'
}

export function rememberLocalProfile(store: FirstResultStore, name: string): FirstResultCheckpoint {
  const current = resumeFirstResult(store)
  const next: FirstResultCheckpoint = {
    ...current,
    localProfileName: name,
    accountAuthenticated: current.accountAuthenticated === true,
  }
  store.set(next)
  return next
}

export function skipFirstResultOnStore(store: FirstResultStore): FirstResultCheckpoint {
  const next = skipFirstResult(resumeFirstResult(store))
  store.set(next)
  return next
}

async function runOptional(
  fn: (() => Promise<void>) | undefined,
): Promise<string | undefined> {
  if (!fn) return undefined
  try {
    await fn()
    return undefined
  } catch (err) {
    return errorMessage(err)
  }
}

export async function createOfflineFirstResult(
  store: FirstResultStore,
  storage: StorageLike,
  options: {
    copy: FirstResultCopy
    localProfileName?: string
    accountAuthenticated?: boolean
    ports?: FirstResultPorts
  },
): Promise<FirstResultCheckpoint> {
  const current = resumeFirstResult(store)
  const seeded = seedOfflineFirstResult(options.ports?.now?.() ?? Date.now())
  const artifacts: FirstResultArtifacts = {
    note: {
      id: seeded.noteId,
      title: options.copy.noteTitle,
      body: options.copy.noteBody,
    },
    sessionId: seeded.sessionId,
    outcome: { id: seeded.outcomeId, title: options.copy.outcomeTitle },
    task: { id: seeded.taskId, title: options.copy.taskTitle },
  }
  writeArtifacts(storage, artifacts)

  const persistError =
    (await runOptional(() => options.ports?.persistNote?.(artifacts.note) ?? Promise.resolve())) ??
    (await runOptional(() => options.ports?.persistTask?.(artifacts.task) ?? Promise.resolve())) ??
    (await runOptional(options.ports?.importNotes))

  let next = advanceFirstResult(
    {
      ...current,
      localProfileName: options.localProfileName ?? current.localProfileName,
      accountAuthenticated: options.accountAuthenticated === true,
    },
    seeded,
  )
  if (persistError) next = recordFirstResultError(next, persistError)
  store.set(next)
  return next
}

export async function retryFirstResultServices(
  store: FirstResultStore,
  storage: StorageLike,
  ports: FirstResultPorts = {},
): Promise<FirstResultCheckpoint> {
  const current = resumeFirstResult(store)
  const artifacts = loadFirstResultArtifacts(storage)
  if (!artifacts) return current

  const persistError =
    (await runOptional(() => ports.persistNote?.(artifacts.note) ?? Promise.resolve())) ??
    (await runOptional(() => ports.persistTask?.(artifacts.task) ?? Promise.resolve())) ??
    (await runOptional(ports.importNotes))

  const next = persistError
    ? recordFirstResultError(current, persistError)
    : { ...current, error: undefined }
  store.set(next)
  return next
}

export function readCheckpointFromStorage(storage: StorageLike | undefined): FirstResultCheckpoint {
  if (!storage) return emptyFirstResult()
  return resumeFirstResult(createStorageAdapter(storage))
}
