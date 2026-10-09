/**
 * ROX Drive — resumable upload queue persistence.
 *
 * The queue owns no durable state of its own: which parts a transport has
 * already accepted (and their ETags) lives in a single atomically-rewritten
 * JSON document under the ROX config dir. Losing the document only costs
 * re-uploading parts — it can never corrupt a completed file, because complete
 * files are dropped from the store the moment the transport acknowledges them.
 *
 * The store is injected into `UploadQueue`; tests use an in-memory
 * implementation, production uses `createFileQueueStore`.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { CONFIG_DIR } from '@rox/shared/config'

/** File name under the ROX config dir. */
export const UPLOAD_QUEUE_STORE_FILE = 'drive-upload-queue.json'

/** Bumped when the persisted shape changes incompatibly. */
export const UPLOAD_QUEUE_STORE_VERSION = 1

export interface PersistedUploadPart {
  /** Zero-based part number. */
  number: number
  sizeBytes: number
  /** ETag returned by the transport's `putPart`. */
  etag: string
}

export interface PersistedUploadFile {
  id: string
  path: string
  name: string
  size: number
  partSize: number
  /** Session handle from `openSession`; reused on resume. */
  uploadId?: string
  /** Last observed status, for diagnostics only — restore always requeues. */
  status?: string
  error?: string
  /** Parts the transport has acknowledged, keyed by number. */
  parts: PersistedUploadPart[]
}

export interface PersistedUploadQueue {
  version: number
  files: PersistedUploadFile[]
}

/**
 * Durable home for the queue's resume state. `save` receives the full next
 * state (the queue never asks the store to patch) and both methods may be sync
 * or async.
 */
export interface QueueStore {
  load(): Promise<PersistedUploadQueue | undefined> | PersistedUploadQueue | undefined
  save(state: PersistedUploadQueue): Promise<void> | void
}

/** Default store location: the ROX config dir (userData). */
export function defaultUploadQueueStorePath(configDir: string = CONFIG_DIR): string {
  return join(configDir, UPLOAD_QUEUE_STORE_FILE)
}

/** JSON-file `QueueStore` with serialized, atomic (tmp + rename) writes. */
export function createFileQueueStore(filePath: string = defaultUploadQueueStorePath()): QueueStore {
  let writeChain: Promise<void> = Promise.resolve()
  return {
    async load(): Promise<PersistedUploadQueue | undefined> {
      try {
        const text = await readFile(filePath, 'utf8')
        const parsed = JSON.parse(text) as PersistedUploadQueue | null
        if (!parsed || !Array.isArray(parsed.files)) return undefined
        return parsed
      } catch (err) {
        // A missing file is the "nothing queued" case, not an error.
        if (err instanceof Error && 'code' in err && err.code === 'ENOENT') return undefined
        throw err
      }
    },
    save(state: PersistedUploadQueue): Promise<void> {
      // Chain writes so a later save can never be clobbered by an earlier one.
      writeChain = writeChain.then(async () => {
        await mkdir(dirname(filePath), { recursive: true })
        const tmp = `${filePath}.${process.pid}.tmp`
        await writeFile(tmp, JSON.stringify(state), 'utf8')
        await rename(tmp, filePath)
      })
      return writeChain
    },
  }
}