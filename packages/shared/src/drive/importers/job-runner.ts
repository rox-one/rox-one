/**
 * ROX Drive (wave 4) — resumable cloud-import job runner.
 *
 * A job resolves a provider's tree into a flat plan of files (`ImportPlanNode`),
 * then uploads them through a `DriveUploadTarget` with four parallel workers.
 * Each file is retried (max 3 attempts, exponential backoff) and the job's
 * committed state is persisted as JSON under the host's app-data dir
 * (`<stateDir>/<jobId>.json`), so a process restart resumes from the last
 * committed file rather than from scratch.
 *
 * The unit of resume is the committed file: `DriveUploadTarget.put` writes a
 * whole object, so a file is either committed (its bytes are recorded in
 * `committedBytes[i]`) or not — a partially-written file is re-sent whole.
 *
 * This module uses node builtins; import it from server/main code, never from
 * the renderer bundle. The pure contract lives in `./types`.
 *
 * `plan` flattens the provider tree with a path-scoped visited set, so a
 * provider that reports a folder cycle (a folder containing itself, directly or
 * through a ring) rejects with `DRIVE_IMPORT_CYCLE` rather than walking forever.
 */
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  DriveUploadTarget,
  ImportEvent,
  ImportJob,
  ImportJobRunner,
  ImportPlanNode,
  ImportProvider,
  ImportProviderId,
  ImportSourceEntry,
} from './types'

export interface ImportJobRunnerOptions {
  target: DriveUploadTarget
  /** Directory for `<jobId>.json` state files, e.g. `<configDir>/drive/imports`. */
  stateDir: string
  /** Initial adapters; more can be added with `registerProvider`. */
  providers?: readonly ImportProvider[]
  /** Parallel file workers. */
  concurrency?: number
  /** Per-file attempt budget. */
  maxAttempts?: number
  /** First backoff delay; doubles per retry. */
  retryBaseMs?: number
  /** Sleep seam for deterministic tests. */
  sleep?: (ms: number) => Promise<void>
  generateId?: () => string
  /** Destination object key for a planned file (default `<jobId>/<path>`). */
  keyFor?: (jobId: string, node: ImportPlanNode) => string
}

const STATE_VERSION = 1
const DEFAULT_CONCURRENCY = 4
const DEFAULT_MAX_ATTEMPTS = 3
const DEFAULT_RETRY_BASE_MS = 250

/** Job ids are used verbatim as `<id>.json` file names under `stateDir`. */
const SAFE_JOB_ID = /^[A-Za-z0-9_-]+$/

/**
 * A provider reported a folder that contains itself (directly or through a
 * ring). The tree can never be flattened, so `plan` rejects with this instead
 * of walking forever; `code` matches the other `DRIVE_IMPORT_*` failures.
 */
class ImportPlanCycleError extends Error {
  readonly code = 'DRIVE_IMPORT_CYCLE'
  readonly folderId: string

  constructor(folderId: string) {
    super(`Import source has a folder cycle at: ${folderId}`)
    this.name = 'ImportPlanCycleError'
    this.folderId = folderId
  }
}

interface PersistedJob {
  version: typeof STATE_VERSION
  job: ImportJob
  /** Per-plan-index committed byte count; -1 means not committed yet. */
  committedBytes: number[]
}

interface JobState {
  job: ImportJob
  committedBytes: number[]
  running: boolean
  /** Resolves when the current run settles (status/persist complete). */
  runningPromise: Promise<void> | null
  paused: boolean
  cancelled: boolean
  persist: Promise<void>
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function cloneJob(job: ImportJob): ImportJob {
  return {
    ...job,
    plan: job.plan.map(node => ({ ...node })),
    progress: { ...job.progress },
  }
}

/** Wrap a stream so the bytes actually consumed are counted (unknown sizes). */
function countingStream(
  source: ReadableStream<Uint8Array>,
  counter: { bytes: number },
): ReadableStream<Uint8Array> {
  const reader = source.getReader()
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read()
      if (done) {
        controller.close()
        return
      }
      counter.bytes += value.byteLength
      controller.enqueue(value)
    },
    cancel(reason) {
      return reader.cancel(reason)
    },
  })
}

export function createImportJobRunner(options: ImportJobRunnerOptions): ImportJobRunner {
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY
  // A zero/NaN/negative budget would make the per-file loop never run and
  // silently import nothing, so clamp to at least one attempt.
  const requestedAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  const maxAttempts = Number.isFinite(requestedAttempts)
    ? Math.max(1, Math.floor(requestedAttempts))
    : DEFAULT_MAX_ATTEMPTS
  const retryBaseMs = options.retryBaseMs ?? DEFAULT_RETRY_BASE_MS
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)))
  const generateId = options.generateId ?? randomUUID
  const keyFor = options.keyFor ?? ((jobId: string, node: ImportPlanNode) => `${jobId}/${node.path}`)

  const providers = new Map<ImportProviderId, ImportProvider>()
  for (const provider of options.providers ?? []) providers.set(provider.id, provider)

  const states = new Map<string, JobState>()
  const listeners = new Set<(event: ImportEvent) => void>()

  function emit(event: ImportEvent): void {
    for (const listener of listeners) {
      try {
        listener(event)
      } catch {
        // A bad subscriber must never break a transfer.
      }
    }
  }

  function persist(state: JobState): Promise<void> {
    const body = JSON.stringify({
      version: STATE_VERSION,
      job: state.job,
      committedBytes: state.committedBytes,
    } satisfies PersistedJob)
    const file = join(options.stateDir, `${state.job.id}.json`)
    const tmp = join(options.stateDir, `.${state.job.id}.tmp`)
    state.persist = state.persist.then(async () => {
      await mkdir(options.stateDir, { recursive: true })
      await writeFile(tmp, body, { encoding: 'utf8', mode: 0o600 })
      await rename(tmp, file)
    })
    return state.persist
  }

  function restore(raw: string): JobState | null {
    let parsed: Partial<PersistedJob>
    try {
      parsed = JSON.parse(raw) as Partial<PersistedJob>
    } catch {
      return null
    }
    if (!parsed || parsed.version !== STATE_VERSION || !parsed.job || !Array.isArray(parsed.job.plan)) {
      return null
    }
    const job = cloneJob(parsed.job)
    // A job that was mid-flight when the process died is resumable, never "running".
    if (job.status === 'running' || job.status === 'planning') job.status = 'paused'
    const committedBytes = job.plan.map((_, index) => {
      const value = parsed.committedBytes?.[index]
      return typeof value === 'number' && value >= 0 ? value : -1
    })
    return { job, committedBytes, running: false, runningPromise: null, paused: job.status === 'paused', cancelled: false, persist: Promise.resolve() }
  }

  async function load(jobId: string): Promise<JobState | null> {
    // The id becomes a file name; anything with a separator or `..` could read
    // or write outside `stateDir`. Unsafe ids are simply "not found".
    if (!SAFE_JOB_ID.test(jobId)) return null
    const existing = states.get(jobId)
    if (existing) return existing
    const file = join(options.stateDir, `${jobId}.json`)
    if (!existsSync(file)) return null
    const state = restore(readFileSync(file, 'utf8'))
    if (state) states.set(jobId, state)
    return state
  }

  function recompute(state: JobState): void {
    let filesDone = 0
    let bytesDone = 0
    let bytesTotal = 0
    for (let index = 0; index < state.job.plan.length; index += 1) {
      const node = state.job.plan[index]
      if (node?.sizeBytes !== undefined) bytesTotal += node.sizeBytes
      const committed = state.committedBytes[index] ?? -1
      if (committed >= 0) {
        filesDone += 1
        bytesDone += committed
      }
    }
    state.job.progress = {
      ...state.job.progress,
      filesTotal: state.job.plan.length,
      filesDone,
      bytesDone,
      bytesTotal,
    }
  }

  function requireState(state: JobState | null, jobId: string): JobState {
    if (!state) throw Object.assign(new Error(`Import job not found: ${jobId}`), { code: 'DRIVE_IMPORT_NOT_FOUND' })
    return state
  }

  async function buildPlan(provider: ImportProvider, folderId?: string): Promise<ImportPlanNode[]> {
    const nodes: ImportPlanNode[] = []
    // Folder ids on the current DFS path: a match means the provider's tree has
    // a cycle. Scoped to the path (not global) so a folder legitimately reachable
    // through two branches still plans once per branch.
    const ancestors = new Set<string>()
    const walk = async (sourceFolderId: string | undefined, prefix: string): Promise<void> => {
      if (sourceFolderId !== undefined) {
        if (ancestors.has(sourceFolderId)) throw new ImportPlanCycleError(sourceFolderId)
        ancestors.add(sourceFolderId)
      }
      try {
        const entries: ImportSourceEntry[] = await provider.list(sourceFolderId)
        for (const entry of entries) {
          const path = `${prefix}${entry.name}`
          if (entry.kind === 'folder') {
            await walk(entry.id, `${path}/`)
          } else {
            nodes.push({ sourceId: entry.id, path, sizeBytes: entry.sizeBytes, contentType: entry.mimeType })
          }
        }
      } finally {
        if (sourceFolderId !== undefined) ancestors.delete(sourceFolderId)
      }
    }
    await walk(folderId, '')
    return nodes
  }

  async function plan(providerId: ImportProviderId, folderId?: string): Promise<ImportJob> {
    const provider = providers.get(providerId)
    if (!provider) {
      throw Object.assign(new Error(`Unknown import provider: ${providerId}`), { code: 'DRIVE_IMPORT_PROVIDER_UNKNOWN' })
    }
    const id = generateId()
    const job: ImportJob = {
      id,
      provider: providerId,
      status: 'planning',
      plan: [],
      progress: { filesDone: 0, filesTotal: 0, bytesDone: 0, bytesTotal: 0 },
    }
    const state: JobState = {
      job,
      committedBytes: [],
      running: false,
      runningPromise: null,
      paused: false,
      cancelled: false,
      persist: Promise.resolve(),
    }
    states.set(id, state)
    let plan: ImportPlanNode[]
    try {
      plan = await buildPlan(provider, folderId)
    } catch (error) {
      // A cyclic tree is not a failed transfer but an unusable request: there is
      // no plan to persist, so drop the half-built job and reject instead.
      if (error instanceof ImportPlanCycleError) {
        states.delete(id)
        throw error
      }
      job.status = 'error'
      job.error = messageOf(error)
      await persist(state)
      emit({ type: 'error', jobId: id, error: job.error })
      emit({ type: 'status', job: cloneJob(job) })
      return cloneJob(job)
    }
    job.plan = plan
    job.status = 'idle'
    state.committedBytes = plan.map(() => -1)
    recompute(state)
    await persist(state)
    emit({ type: 'plan', job: cloneJob(job) })
    emit({ type: 'status', job: cloneJob(job) })
    return cloneJob(job)
  }

  async function runJob(state: JobState): Promise<ImportJob> {
    if (state.running) return cloneJob(state.job)
    if (state.job.plan.length === 0) {
      // `plan` persists a listing failure as an empty plan with status 'error'.
      // Starting such a job must surface that error to the caller, not report a
      // successful "imported 0 of 0 files".
      if (state.job.status === 'error') return cloneJob(state.job)
      state.job.status = 'done'
      state.job.error = undefined
      await persist(state)
      emit({ type: 'status', job: cloneJob(state.job) })
      emit({ type: 'done', job: cloneJob(state.job) })
      return cloneJob(state.job)
    }
    const provider = providers.get(state.job.provider)
    if (!provider) {
      state.job.status = 'error'
      state.job.error = `Unknown import provider: ${state.job.provider}`
      await persist(state)
      emit({ type: 'error', jobId: state.job.id, error: state.job.error })
      emit({ type: 'status', job: cloneJob(state.job) })
      return cloneJob(state.job)
    }

    state.running = true
    state.paused = false
    state.cancelled = false
    state.job.status = 'running'
    state.job.error = undefined
    let settleResolve!: () => void
    state.runningPromise = new Promise<void>(resolve => {
      settleResolve = resolve
    })

    try {
      const jobId = state.job.id
      let cursor = 0
      let firstError: unknown = null

      const commit = async (index: number, bytes: number): Promise<void> => {
        state.committedBytes[index] = bytes
        recompute(state)
        state.job.progress.currentPath = state.job.plan[index]?.path
        await persist(state)
        emit({ type: 'file', jobId, path: state.job.plan[index]?.path ?? '', sizeBytes: state.job.plan[index]?.sizeBytes, bytesDone: bytes })
        emit({ type: 'progress', jobId, progress: { ...state.job.progress } })
      }

      const runFile = async (index: number): Promise<void> => {
        const node = state.job.plan[index]
        if (!node) return
        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
          if (state.cancelled) return
          // Fresh counter per attempt: bytes drained by a failed attempt must
          // not inflate the committed total of the retry that succeeds.
          const counter = { bytes: 0 }
          try {
            state.job.progress.currentPath = node.path
            emit({ type: 'progress', jobId, progress: { ...state.job.progress } })
            const source = await provider.stream(node.sourceId)
            const body = node.sizeBytes === undefined ? countingStream(source, counter) : source
            await options.target.put(keyFor(jobId, node), body, { sizeBytes: node.sizeBytes, contentType: node.contentType })
            await commit(index, node.sizeBytes ?? counter.bytes)
            return
          } catch (error) {
            if (attempt >= maxAttempts || state.cancelled) {
              throw Object.assign(new Error(`Import failed for ${node.path}: ${messageOf(error)}`), {
                code: 'DRIVE_IMPORT_FILE_FAILED',
                path: node.path,
                cause: error,
              })
            }
            emit({ type: 'retry', jobId, path: node.path, attempt, error: messageOf(error) })
            await sleep(retryBaseMs * 2 ** (attempt - 1))
          }
        }
      }

      const worker = async (): Promise<void> => {
        while (true) {
          if (state.cancelled || state.paused || firstError) return
          const index = cursor
          cursor += 1
          if (index >= state.job.plan.length) return
          if ((state.committedBytes[index] ?? -1) >= 0) continue
          try {
            await runFile(index)
          } catch (error) {
            if (!firstError) firstError = error
            return
          }
        }
      }

      // Create the workers before the first disk write: a `pause` that arrives
      // while the run is still starting must not swallow the file already in
      // flight — it only stops files that have not been scheduled yet.
      const workers = Promise.all(Array.from({ length: Math.max(1, concurrency) }, () => worker()))
      await persist(state)
      emit({ type: 'status', job: cloneJob(state.job) })
      await workers

      if (firstError) {
        state.job.status = 'error'
        state.job.error = messageOf(firstError)
        emit({ type: 'error', jobId, error: state.job.error })
      } else if (state.cancelled) {
        state.job.status = 'idle'
        state.job.error = 'Import cancelled'
      } else if (state.paused) {
        state.job.status = 'paused'
      } else {
        state.job.status = 'done'
        state.job.error = undefined
      }
      await persist(state)
      emit({ type: 'status', job: cloneJob(state.job) })
      if (state.job.status === 'done') emit({ type: 'done', job: cloneJob(state.job) })
    } finally {
      state.running = false
      state.runningPromise = null
      settleResolve()
    }
    return cloneJob(state.job)
  }

  async function start(jobId: string): Promise<ImportJob> {
    const state = requireState(await load(jobId), jobId)
    if (state.running) return cloneJob(state.job)
    if (state.job.status === 'done') return cloneJob(state.job)
    state.cancelled = false
    state.paused = false
    return runJob(state)
  }

  async function pause(jobId: string): Promise<ImportJob> {
    const state = requireState(await load(jobId), jobId)
    if (state.running) {
      state.paused = true
      // In-flight files commit; no new files are scheduled after this point.
      await state.runningPromise
    } else if (state.job.status === 'running' || state.job.status === 'planning') {
      state.job.status = 'paused'
      await persist(state)
      emit({ type: 'status', job: cloneJob(state.job) })
    }
    return cloneJob(state.job)
  }

  async function cancel(jobId: string): Promise<ImportJob> {
    const state = requireState(await load(jobId), jobId)
    if (!state.running && (state.job.status === 'done' || state.job.status === 'error' || state.job.status === 'cancelled')) {
      throw Object.assign(new Error(`Import job is already ${state.job.status}: ${jobId}`), {
        code: 'DRIVE_IMPORT_NOT_CANCELLABLE',
      })
    }
    state.cancelled = true
    await state.runningPromise
    state.running = false
    state.job.status = 'cancelled'
    state.job.error = 'Import cancelled'
    await persist(state)
    emit({ type: 'status', job: cloneJob(state.job) })
    return cloneJob(state.job)
  }

  async function status(jobId?: string): Promise<ImportJob | ImportJob[] | null> {
    if (jobId !== undefined) {
      const state = await load(jobId)
      return state ? cloneJob(state.job) : null
    }
    if (existsSync(options.stateDir)) {
      for (const name of readdirSync(options.stateDir)) {
        if (name.endsWith('.json')) {
          const id = name.slice(0, -'.json'.length)
          if (!states.has(id)) await load(id)
        }
      }
    }
    return [...states.values()].map(state => cloneJob(state.job))
  }

  return {
    plan,
    start,
    resume: start,
    pause,
    cancel,
    status,
    registerProvider(provider: ImportProvider) {
      providers.set(provider.id, provider)
    },
    subscribe(listener: (event: ImportEvent) => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}