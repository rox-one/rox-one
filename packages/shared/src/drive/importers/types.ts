/**
 * ROX Drive (wave 4) — cloud import contracts shared by the provider adapters
 * (`./providers/*`), the resumable job runner (`./job-runner`), the S3 upload
 * target (`./r2-target`) and the `drive:import*` RPC surface.
 *
 * This module is pure: no I/O, no env, no node builtins. That keeps it safe to
 * import from the renderer, the server-core handlers and the provider adapters
 * alike. Bytes and persistence live in `job-runner.ts` / `r2-target.ts`.
 */

/** Providers the import pipeline can pull from. */
export type ImportProviderId = 'google-drive' | 'onedrive' | 'yandex-disk' | 'icloud'

/** One directory listing entry returned by a provider. */
export interface ImportSourceEntry {
  id: string
  name: string
  kind: 'file' | 'folder'
  sizeBytes?: number
  modifiedAt?: string
}

/**
 * One file to import, resolved to its destination path inside the drive.
 * `path` is relative and uses `/` separators (folders are always traversed to
 * their file leaves — the plan never carries folder nodes).
 */
export interface ImportPlanNode {
  sourceId: string
  path: string
  sizeBytes?: number
}

/** Running counter for one import job. */
export interface ImportProgress {
  filesDone: number
  filesTotal: number
  bytesDone: number
  bytesTotal: number
  currentPath?: string
}

/**
 * A provider adapter. `list` enumerates one folder (the root when `folderId`
 * is omitted); `stream` opens a byte range of a file (whole file when `range`
 * is omitted). Adapters are stateless and re-entrant — the runner owns
 * retries, ordering and backoff.
 */
export interface ImportProvider {
  id: ImportProviderId
  list(folderId?: string): Promise<ImportSourceEntry[]>
  stream(sourceId: string, range?: { start: number; end: number }): Promise<ReadableStream<Uint8Array>>
}

/**
 * Destination for imported bytes (S3-compatible object storage). `put` writes
 * the whole object at `key`; a key always maps to exactly one planned file, so
 * the runner's unit of resume is the committed file.
 */
export interface DriveUploadTarget {
  put(
    key: string,
    body: ReadableStream<Uint8Array> | Uint8Array,
    opts?: { sizeBytes?: number; contentType?: string },
  ): Promise<void>
}

export type ImportJobStatus = 'idle' | 'planning' | 'running' | 'paused' | 'error' | 'done'

/** Durable, serializable snapshot of one import job. */
export interface ImportJob {
  id: string
  provider: ImportProviderId
  status: ImportJobStatus
  plan: ImportPlanNode[]
  progress: ImportProgress
  error?: string
}

/** Events emitted while a job plans/runs; `subscribe` fans them out to hosts. */
export type ImportEvent =
  | { type: 'plan'; job: ImportJob }
  | { type: 'status'; job: ImportJob }
  | { type: 'progress'; jobId: string; progress: ImportProgress }
  | { type: 'file'; jobId: string; path: string; sizeBytes?: number; bytesDone: number }
  | { type: 'retry'; jobId: string; path: string; attempt: number; error: string }
  | { type: 'error'; jobId: string; error: string }
  | { type: 'done'; job: ImportJob }

/**
 * The runner surface consumed by `drive:import*` RPC handlers. `plan` resolves
 * the source tree into an idle job; `start`/`resume` drive it; `pause` stops
 * scheduling new files once in-flight work settles; `cancel` abandons the job.
 */
export interface ImportJobRunner {
  plan(provider: ImportProviderId, folderId?: string): Promise<ImportJob>
  start(jobId: string): Promise<ImportJob>
  resume(jobId: string): Promise<ImportJob>
  pause(jobId: string): Promise<ImportJob>
  cancel(jobId: string): Promise<ImportJob>
  /** One job by id, or the known jobs when no id is given. */
  status(jobId?: string): Promise<ImportJob | ImportJob[] | null>
  /** Registers (or replaces) one provider adapter. */
  registerProvider(provider: ImportProvider): void
  /** Consume runner events; returns an unsubscribe function. */
  subscribe(listener: (event: ImportEvent) => void): () => void
}