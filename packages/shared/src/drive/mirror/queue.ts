/**
 * ROX Drive (R13 mirror) — resumable upload queue.
 *
 * Runs the `add` + `changed` half of a `MirrorPlan` through a
 * `DriveUploadTarget`, committing each file to the journal only after the
 * receiver accepted it — so the committed file is the unit of resume and a
 * crash never re-sends completed work. `tombstones` (files deleted from disk)
 * are recorded in the journal; `DriveUploadTarget` exposes no delete, so the
 * deletion is durable in the mirror's own state rather than in the receiver.
 *
 * Per-file failures are retried (3 attempts, exponential backoff) and then
 * collected in `errors` without aborting the run. File bytes are read lazily,
 * one file at a time, and never retained after the upload.
 */
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type {
  MirrorPlan,
  MirrorQueue,
  MirrorQueueOptions,
  MirrorQueueState,
  MirrorQueueStatus,
  MirrorRunError,
  MirrorRunResult,
  MirrorSourceEntry,
} from './types'

const MAX_ATTEMPTS = 3
const RETRY_BASE_MS = 250
const DEFAULT_MAX_PARALLEL = 2

/** Object key prefix inside the Drive target's namespace. */
const MIRROR_KEY_PREFIX = 'app-mirror/'

type PendingKind = 'add' | 'changed'

interface PendingFile {
  kind: PendingKind
  entry: MirrorSourceEntry
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function sha256Of(bytes: Uint8Array): Promise<string> {
  return createHash('sha256').update(bytes).digest('hex')
}

export function createMirrorQueue(options: MirrorQueueOptions): MirrorQueue {
  const now = options.now ?? Date.now
  const hash = options.hash ?? sha256Of
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)))
  const requestedParallel = options.maxParallel ?? DEFAULT_MAX_PARALLEL
  const maxParallel = Number.isFinite(requestedParallel) ? Math.max(1, Math.floor(requestedParallel)) : DEFAULT_MAX_PARALLEL

  let pending: PendingFile[] = []
  let tombstones: string[] = []
  const done = new Set<string>()
  let errors: MirrorRunError[] = []
  let state: MirrorQueueState = 'idle'
  let paused = false
  let cancelled = false
  let isRunning = false
  let lastCommittedAtMs: number | undefined
  let bytesDone = 0
  let added = 0
  let changed = 0
  let removed = 0
  let running: Promise<MirrorRunResult> | null = null

  function snapshotStatus(): MirrorQueueStatus {
    let bytesTotal = 0
    for (const item of pending) bytesTotal += item.entry.sizeBytes
    return {
      state,
      filesDone: done.size,
      filesTotal: pending.length,
      bytesDone,
      bytesTotal,
      lastCommittedAtMs,
    }
  }

  async function uploadOne(item: PendingFile): Promise<void> {
    const { entry, kind } = item
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      if (cancelled) return
      try {
        // Read lazily: one file's bytes live only for as long as its upload.
        const bytes = await readFile(entry.absPath)
        const sha256 = entry.sha256 ?? (await hash(bytes))
        await options.uploadTarget.put(`${MIRROR_KEY_PREFIX}${entry.relativePath}`, bytes, { sizeBytes: entry.sizeBytes })
        await options.journal.commit({ relativePath: entry.relativePath, sha256, sizeBytes: entry.sizeBytes })
        done.add(entry.relativePath)
        bytesDone += entry.sizeBytes
        if (kind === 'add') added += 1
        else changed += 1
        lastCommittedAtMs = now()
        return
      } catch (error) {
        if (attempt >= MAX_ATTEMPTS || cancelled) {
          errors.push({ relativePath: entry.relativePath, message: messageOf(error) })
          return
        }
        await sleep(RETRY_BASE_MS * 2 ** (attempt - 1))
      }
    }
  }

  async function run(): Promise<MirrorRunResult> {
    if (running) return running
    paused = false
    cancelled = false
    state = 'running'
    running = (async (): Promise<MirrorRunResult> => {
      // Removing an object is not part of `DriveUploadTarget`; the deletion is
      // durable in the journal (which the receiver side reconciles from).
      if (tombstones.length > 0) {
        const toRemove = tombstones
        tombstones = []
        try {
          await options.journal.addTombstones(toRemove)
          removed += toRemove.length
        } catch (error) {
          for (const path of toRemove) errors.push({ relativePath: path, message: messageOf(error) })
        }
      }

      let cursor = 0
      async function worker(): Promise<void> {
        while (true) {
          if (cancelled || paused) return
          const index = cursor
          cursor += 1
          const item = pending[index]
          if (!item) return
          if (done.has(item.entry.relativePath)) continue
          await uploadOne(item)
        }
      }
      await Promise.all(Array.from({ length: maxParallel }, () => worker()))

      if (cancelled) state = 'cancelled'
      else if (paused) state = 'paused'
      else if (pending.length > 0 && errors.length >= pending.length) state = 'error'
      else state = 'idle'

      return {
        added,
        changed,
        removed,
        bytesUploaded: bytesDone,
        paused,
        cancelled,
        errors: [...errors],
      }
    })()

    isRunning = true
    try {
      return await running
    } finally {
      isRunning = false
      running = null
    }
  }

  return {
    enqueue(plan: MirrorPlan): void {
      if (isRunning) throw new Error('Cannot enqueue while the mirror queue is running')
      pending = [
        ...plan.add.map(entry => ({ kind: 'add' as const, entry })),
        ...plan.changed.map(entry => ({ kind: 'changed' as const, entry })),
      ]
      tombstones = [...plan.tombstones]
      done.clear()
      errors = []
      bytesDone = 0
      added = 0
      changed = 0
      removed = 0
      lastCommittedAtMs = undefined
      paused = false
      cancelled = false
      state = 'idle'
    },

    run,

    pause(): void {
      if (!isRunning) return
      paused = true
      state = 'paused'
    },

    cancel(): void {
      cancelled = true
      paused = false
      state = 'cancelled'
    },

    status(): MirrorQueueStatus {
      return snapshotStatus()
    },
  }
}