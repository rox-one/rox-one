/**
 * ROX Drive — resumable, multi-stream client upload queue (headless).
 *
 * Splits every queued file into fixed-size parts (`planParts`, 16 MiB by
 * default) and pushes parts through a caller-supplied `UploadTransport` on up
 * to `MAX_PARALLEL_STREAMS` (8) concurrent streams, saturating the link without
 * ever exceeding the cap. Files, parts and ETags are persisted through an
 * injected `QueueStore` after every accepted part, so a crash or restart
 * re-opens the session and re-sends only the parts the transport is missing.
 *
 * This module is deliberately node-only: no Electron, no globals. Bytes come
 * from a `FileSource` (`createNodeFileSource` reads a real file; tests fake
 * it); durability comes from `QueueStore` (`createFileQueueStore` writes JSON).
 */
import { randomUUID } from 'node:crypto'
import { open, stat } from 'node:fs/promises'
import { DRIVE_PART_SIZE_BYTES, planParts, type PlannedPart } from '@rox/shared/drive'
import type { PersistedUploadFile, PersistedUploadPart, PersistedUploadQueue, QueueStore } from './upload-store'

export type { QueueStore } from './upload-store'
export { createFileQueueStore, defaultUploadQueueStorePath, UPLOAD_QUEUE_STORE_FILE } from './upload-store'

/** Concurrent part streams across the whole queue. */
export const MAX_PARALLEL_STREAMS = 8

/** Default part size; mirrors the shared Drive contract. */
export const DEFAULT_PART_SIZE_BYTES = DRIVE_PART_SIZE_BYTES

/** Retry attempts after the first failure (i.e. up to 6 tries). */
export const DEFAULT_MAX_RETRIES = 5

export interface UploadSessionHandle {
  uploadId: string
  /** Transport-preferred part size; overrides the queue default when set. */
  partSize?: number
  /** Parts the transport already holds for this file. */
  existingParts: number[]
}

export interface CompletedPart {
  partNumber: number
  etag: string
}

export interface OpenUploadSessionInput {
  path: string
  name: string
  size: number
  partSize: number
}

/**
 * Remote half of an upload. Implementations may be backed by the ROX Drive RPC,
 * an S3 multipart upload, … — the queue only needs these four calls.
 */
export interface UploadTransport {
  openSession(file: OpenUploadSessionInput): Promise<UploadSessionHandle>
  putPart(uploadId: string, partNumber: number, chunk: Uint8Array): Promise<{ etag: string }>
  complete(uploadId: string, parts: CompletedPart[]): Promise<{ fileId: string }>
  abort(uploadId: string): Promise<void>
}

/** Random-access byte source; `read` returns `[start, end)`. */
export interface FileSource {
  path: string
  size: number
  read(start: number, end: number): Promise<Uint8Array>
}

export type QueueFileStatus = 'pending' | 'opening' | 'uploading' | 'completed' | 'failed' | 'cancelled'

export interface FileProgress {
  fileId: string
  name: string
  path: string
  size: number
  doneBytes: number
  doneParts: number
  totalParts: number
  status: QueueFileStatus
  error?: string
}

export interface QueueOverallProgress {
  doneBytes: number
  totalBytes: number
  doneFiles: number
  totalFiles: number
}

export interface QueueProgressEvent {
  file: FileProgress
  overall: QueueOverallProgress
}

export interface UploadQueueOptions {
  transport: UploadTransport
  /** Durable resume state. When omitted the queue is memory-only. */
  store?: QueueStore
  /** Concurrency cap; defaults to `MAX_PARALLEL_STREAMS`. */
  maxParallelStreams?: number
  /** Default part size; defaults to `DEFAULT_PART_SIZE_BYTES`. */
  partSize?: number
  /** Retry attempts after the first failure; defaults to `DEFAULT_MAX_RETRIES`. */
  maxRetries?: number
  /** Delay before retry `attempt` (1-based). Defaults to capped exponential. */
  backoffMs?: (attempt: number) => number
  /** Injectable timer seam for tests; defaults to an unref'd `setTimeout`. */
  sleep?: (ms: number) => Promise<void>
  /** Reconstructs a `FileSource` for files restored from the store. */
  resolveSource?: (file: { path: string; size: number; name: string }) => Promise<FileSource>
  /** Whether a `putPart`/`complete`/`openSession` rejection is worth retrying. */
  isRetryable?: (error: unknown) => boolean
  onProgress?: (event: QueueProgressEvent) => void
}

interface QueueFileState {
  id: string
  path: string
  name: string
  size: number
  partSize: number
  status: QueueFileStatus
  source?: FileSource
  uploadId?: string
  error?: string
  cancelled: boolean
  parts: PlannedPart[]
  doneParts: Map<number, { etag: string; sizeBytes: number }>
}

/** Attempts are 1-based; 250 ms, 500 ms, … capped at 30 s. */
function defaultBackoffMs(attempt: number): number {
  return Math.min(250 * 2 ** (attempt - 1), 30_000)
}

function defaultSleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>()
  // Never hold the process open for a retry backoff.
  setTimeout(resolve, ms).unref()
  return promise
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return typeof error === 'string' ? error : String(error)
}

/** Open a real file as a `FileSource` (reads the requested slice per call). */
export async function createNodeFileSource(path: string): Promise<FileSource> {
  const info = await stat(path)
  return {
    path,
    size: info.size,
    async read(start: number, end: number): Promise<Uint8Array> {
      const length = Math.max(0, end - start)
      if (length === 0) return new Uint8Array(0)
      const handle = await open(path, 'r')
      try {
        const buffer = Buffer.allocUnsafe(length)
        const { bytesRead } = await handle.read(buffer, 0, length, start)
        return new Uint8Array(buffer.buffer, buffer.byteOffset, bytesRead)
      } finally {
        await handle.close()
      }
    },
  }
}

/**
 * Resumable upload queue. Construct, `enqueue(source)`, `start()`, `drain()`.
 * Cancel a single file with `cancelFile(id)`; pause/resume the whole queue with
 * `pause()`/`resume()`.
 */
export class UploadQueue {
  private readonly transport: UploadTransport
  private readonly store?: QueueStore
  private readonly maxParallel: number
  private readonly partSize: number
  private readonly maxRetries: number
  private readonly backoffMs: (attempt: number) => number
  private readonly sleep: (ms: number) => Promise<void>
  private readonly resolveSource?: UploadQueueOptions['resolveSource']
  private readonly isRetryable: (error: unknown) => boolean
  private readonly onProgress?: (event: QueueProgressEvent) => void

  private readonly files = new Map<string, QueueFileState>()
  private readonly fileWorkers = new Map<string, Promise<void>>()

  private inFlight = 0
  private readonly slotWaiters: Array<() => void> = []
  private readonly resumeWaiters: Array<() => void> = []
  private paused = false
  private disposed = false
  private started = false
  private restored = false

  private persistChain: Promise<void> = Promise.resolve()

  constructor(options: UploadQueueOptions) {
    this.transport = options.transport
    this.store = options.store
    this.maxParallel = Math.max(1, options.maxParallelStreams ?? MAX_PARALLEL_STREAMS)
    this.partSize = options.partSize ?? DEFAULT_PART_SIZE_BYTES
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES
    this.backoffMs = options.backoffMs ?? defaultBackoffMs
    this.sleep = options.sleep ?? defaultSleep
    this.resolveSource = options.resolveSource
    this.isRetryable = options.isRetryable ?? (() => true)
    this.onProgress = options.onProgress
  }

  /** Add a file; returns its queue id. Safe before or after `start()`. */
  enqueue(source: FileSource, options: { name?: string; partSize?: number } = {}): string {
    const partSize = options.partSize ?? this.partSize
    const file: QueueFileState = {
      id: randomUUID(),
      path: source.path,
      name: options.name ?? source.path.split(/[\\/]/).pop() ?? source.path,
      size: source.size,
      partSize,
      status: 'pending',
      source,
      cancelled: false,
      parts: planParts(source.size, partSize),
      doneParts: new Map(),
    }
    this.files.set(file.id, file)
    this.queuePersist()
    this.emitProgress(file)
    if (this.started) this.launch(file)
    return file.id
  }

  /** Restore any persisted state, then begin uploading everything queued. */
  async start(): Promise<void> {
    if (this.started) return
    this.started = true
    await this.restore()
    for (const file of this.files.values()) this.launch(file)
  }

  /** Resolve once every launched file reached a terminal (or failed) state. */
  async drain(): Promise<void> {
    await Promise.all([...this.fileWorkers.values()])
    await this.persistChain
  }

  /** Stop launching new parts; in-flight parts finish. */
  pause(): void {
    this.paused = true
  }

  /** Resume after `pause()`. */
  resume(): void {
    if (!this.paused) return
    this.paused = false
    for (const wake of this.resumeWaiters.splice(0)) wake()
  }

  /** Cancel one file: abort its session and drop it from the store. */
  async cancelFile(fileId: string): Promise<void> {
    const file = this.files.get(fileId)
    if (!file) return
    file.cancelled = true
    file.status = 'cancelled'
    this.files.delete(fileId)
    this.wakeWaiters()
    if (file.uploadId) {
      try {
        await this.transport.abort(file.uploadId)
      } catch {
        // Aborting a session that never existed is not the caller's problem.
      }
    }
    this.queuePersist()
    this.emitProgress(file)
  }

  /** Release timers/waiters; the queue becomes unusable. */
  async dispose(): Promise<void> {
    this.disposed = true
    this.wakeWaiters()
    await this.persistChain
  }

  getFiles(): FileProgress[] {
    return [...this.files.values()].map(file => this.snapshotFile(file))
  }

  getProgress(): QueueOverallProgress {
    return this.overallProgress()
  }

  private async restore(): Promise<void> {
    if (!this.store || this.restored) return
    this.restored = true
    const state = await this.store.load()
    if (!state || !Array.isArray(state.files)) return
    for (const persisted of state.files) {
      if (this.files.has(persisted.id)) continue
      const file = await this.hydrateFile(persisted)
      if (file) this.files.set(file.id, file)
    }
  }

  private async hydrateFile(persisted: PersistedUploadFile): Promise<QueueFileState | undefined> {
    if (!persisted || typeof persisted.id !== 'string' || typeof persisted.path !== 'string') return undefined
    const size = Number.isFinite(persisted.size) ? persisted.size : 0
    const partSize = Number.isFinite(persisted.partSize) && persisted.partSize > 0 ? persisted.partSize : this.partSize
    const file: QueueFileState = {
      id: persisted.id,
      path: persisted.path,
      name: typeof persisted.name === 'string' ? persisted.name : persisted.path,
      size,
      partSize,
      status: 'pending',
      uploadId: persisted.uploadId,
      error: persisted.error,
      cancelled: false,
      parts: planParts(size, partSize),
      doneParts: new Map(),
    }
    for (const part of persisted.parts ?? []) file.doneParts.set(part.number, { etag: part.etag, sizeBytes: part.sizeBytes })
    if (this.resolveSource) {
      try {
        file.source = await this.resolveSource({ path: file.path, size: file.size, name: file.name })
      } catch (err) {
        file.error = errorMessage(err)
      }
    }
    if (!file.source) {
      file.status = 'failed'
      file.error = file.error ?? 'upload source unavailable'
    }
    return file
  }

  private launch(file: QueueFileState): void {
    if (this.fileWorkers.has(file.id)) return
    if (file.status !== 'pending' && file.status !== 'uploading' && file.status !== 'opening') return
    const worker = this.runFile(file)
      .catch(() => undefined) // failures are recorded on the file entry
      .finally(() => {
        this.fileWorkers.delete(file.id)
      })
    this.fileWorkers.set(file.id, worker)
  }

  private async runFile(file: QueueFileState): Promise<void> {
    if (file.cancelled || !file.source) return
    file.status = 'opening'
    this.emitProgress(file)

    let session: UploadSessionHandle
    try {
      session = await this.withRetry(file, () =>
        this.transport.openSession({ path: file.path, name: file.name, size: file.size, partSize: file.partSize }),
      )
    } catch (err) {
      this.failFile(file, err)
      return
    }
    if (file.cancelled) return
    file.uploadId = session.uploadId

    // A transport-provided part size wins; re-plan and drop parts that no
    // longer line up with the new numbering.
    const overridePartSize = session.partSize
    if (typeof overridePartSize === 'number' && overridePartSize > 0 && overridePartSize !== file.partSize) {
      file.partSize = overridePartSize
      file.parts = planParts(file.size, overridePartSize)
      for (const number of [...file.doneParts.keys()]) {
        if (number >= file.parts.length) file.doneParts.delete(number)
      }
    }

    // The transport is the source of truth for which parts still exist. Any
    // part we remembered but it no longer holds must be re-sent; parts it holds
    // that we lack an ETag for are re-sent too (a same-number PUT is idempotent).
    const existing = new Set(session.existingParts)
    for (const number of [...file.doneParts.keys()]) {
      if (!existing.has(number)) file.doneParts.delete(number)
    }

    file.status = 'uploading'
    this.queuePersist()
    this.emitProgress(file)

    const pending = file.parts.filter(part => !file.doneParts.has(part.index))
    let cursor = 0
    const next = (): PlannedPart | undefined => (cursor < pending.length ? pending[cursor++] : undefined)
    const workerCount = Math.min(this.maxParallel, pending.length)
    const workers: Array<Promise<void>> = []
    for (let i = 0; i < workerCount; i += 1) workers.push(this.partWorker(file, next))
    await Promise.all(workers)

    if (file.cancelled) return
    if (file.status !== 'uploading') return // a part failed and recorded it
    if (file.doneParts.size !== file.parts.length) {
      this.failFile(file, new Error(`upload incomplete: ${file.doneParts.size}/${file.parts.length} parts`))
      return
    }

    try {
      const parts = [...file.doneParts.entries()]
        .map(([partNumber, record]) => ({ partNumber, etag: record.etag }))
        .sort((a, b) => a.partNumber - b.partNumber)
      await this.withRetry(file, () => this.transport.complete(file.uploadId!, parts))
      file.status = 'completed'
      // Emit while the file is still counted, so the final overall progress is
      // the full size; then drop it from the store.
      this.emitProgress(file)
      this.files.delete(file.id)
      this.queuePersist()
    } catch (err) {
      this.failFile(file, err)
    }
  }

  private async partWorker(file: QueueFileState, next: () => PlannedPart | undefined): Promise<void> {
    while (!file.cancelled && file.status === 'uploading') {
      const part = next()
      if (!part) return
      await this.acquire()
      try {
        if (file.cancelled || file.status !== 'uploading') return
        if (file.doneParts.has(part.index)) continue
        await this.uploadPart(file, part)
      } catch {
        // Recorded on the file by uploadPart/failFile; stop this worker.
        return
      } finally {
        this.release()
      }
    }
  }

  private async uploadPart(file: QueueFileState, part: PlannedPart): Promise<void> {
    const source = file.source!
    for (let attempt = 1; ; attempt += 1) {
      if (file.cancelled) return
      try {
        const chunk = await source.read(part.start, part.end)
        if (file.cancelled) return
        const { etag } = await this.transport.putPart(file.uploadId!, part.index, chunk)
        if (file.cancelled) return
        if (file.doneParts.has(part.index)) return // duplicate guard
        file.doneParts.set(part.index, { etag, sizeBytes: part.sizeBytes })
        this.queuePersist()
        this.emitProgress(file)
        return
      } catch (err) {
        if (file.cancelled) return
        if (attempt > this.maxRetries || !this.isRetryable(err)) {
          this.failFile(file, err)
          throw err
        }
        await this.sleep(this.backoffMs(attempt))
      }
    }
  }

  private failFile(file: QueueFileState, error: unknown): void {
    if (file.cancelled) return
    file.status = 'failed'
    file.error = errorMessage(error)
    if (file.uploadId) void this.transport.abort(file.uploadId).catch(() => undefined)
    this.queuePersist()
    this.emitProgress(file)
    this.wakeWaiters()
  }

  private async withRetry<T>(file: QueueFileState, run: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await run()
      } catch (err) {
        if (file.cancelled) throw err
        if (attempt > this.maxRetries || !this.isRetryable(err)) throw err
        await this.sleep(this.backoffMs(attempt))
      }
    }
  }

  private async acquire(): Promise<void> {
    for (;;) {
      if (this.disposed) throw new Error('upload queue disposed')
      if (!this.paused && this.inFlight < this.maxParallel) {
        this.inFlight += 1
        return
      }
      const { promise, resolve } = Promise.withResolvers<void>()
      if (this.paused) this.resumeWaiters.push(resolve)
      else this.slotWaiters.push(resolve)
      await promise
    }
  }

  private release(): void {
    this.inFlight = Math.max(0, this.inFlight - 1)
    const wake = this.slotWaiters.shift()
    if (wake) wake()
  }

  private wakeWaiters(): void {
    for (const wake of this.slotWaiters.splice(0)) wake()
    for (const wake of this.resumeWaiters.splice(0)) wake()
  }

  private queuePersist(): void {
    const store = this.store
    if (!store) return
    this.persistChain = this.persistChain.then(() => store.save(this.serialize())).catch(() => undefined)
  }

  private serialize(): PersistedUploadQueue {
    const files: PersistedUploadFile[] = []
    for (const file of this.files.values()) {
      if (file.status === 'completed' || file.status === 'cancelled') continue
      const parts: PersistedUploadPart[] = [...file.doneParts.entries()].map(([number, record]) => ({
        number,
        sizeBytes: record.sizeBytes,
        etag: record.etag,
      }))
      files.push({
        id: file.id,
        path: file.path,
        name: file.name,
        size: file.size,
        partSize: file.partSize,
        uploadId: file.uploadId,
        status: file.status,
        error: file.error,
        parts,
      })
    }
    return { version: 1, files }
  }

  private snapshotFile(file: QueueFileState): FileProgress {
    let doneBytes = 0
    for (const record of file.doneParts.values()) doneBytes += record.sizeBytes
    return {
      fileId: file.id,
      name: file.name,
      path: file.path,
      size: file.size,
      doneBytes,
      doneParts: file.doneParts.size,
      totalParts: file.parts.length,
      status: file.status,
      error: file.error,
    }
  }

  private overallProgress(): QueueOverallProgress {
    let doneBytes = 0
    let totalBytes = 0
    let doneFiles = 0
    let totalFiles = 0
    for (const file of this.files.values()) {
      if (file.status === 'cancelled') continue
      totalFiles += 1
      totalBytes += file.size
      if (file.status === 'completed') {
        doneBytes += file.size
        doneFiles += 1
      } else {
        for (const record of file.doneParts.values()) doneBytes += record.sizeBytes
      }
    }
    return { doneBytes, totalBytes, doneFiles, totalFiles }
  }

  private emitProgress(file: QueueFileState): void {
    if (!this.onProgress) return
    this.onProgress({ file: this.snapshotFile(file), overall: this.overallProgress() })
  }
}