/**
 * ROX Drive (wave 1) — pure planning/progress math.
 *
 * No I/O, no env, no Electron: this module is imported by the renderer (upload
 * scheduler + meter), the Electron main engine (part validation), and the
 * tests. Keeping the arithmetic here means the "8 parallel parts" contract is
 * verified once against the same code every host runs.
 */
import {
  DRIVE_DEFAULT_QUOTA_BYTES,
  DRIVE_MAX_PARALLEL_PARTS,
  DRIVE_PART_SIZE_BYTES,
  type DrivePart,
  type DriveQuota,
  type DriveUploadSession,
} from './types'

export interface PlannedPart {
  index: number
  /** Inclusive byte offset of the first byte in the source. */
  start: number
  /** Exclusive byte offset past the last byte. */
  end: number
  sizeBytes: number
}

/**
 * Split a file of `size` bytes into ordered 16 MiB parts.
 *
 * A zero-byte file still yields exactly one (empty) part so the upload session
 * has a stable part count and `completeUpload` has something to verify.
 */
export function planParts(
  size: number,
  partSize: number = DRIVE_PART_SIZE_BYTES,
): PlannedPart[] {
  if (!Number.isFinite(size) || size < 0) throw new Error('planParts: size must be a non-negative finite number')
  if (!Number.isInteger(partSize) || partSize <= 0) throw new Error('planParts: partSize must be a positive integer')
  const partCount = Math.max(1, Math.ceil(size / partSize))
  const parts: PlannedPart[] = []
  for (let index = 0; index < partCount; index += 1) {
    const start = index * partSize
    const end = Math.min(start + partSize, size)
    parts.push({ index, start, end, sizeBytes: end - start })
  }
  return parts
}

/**
 * Order-independent batches: each round carries at most `concurrency` part
 * indices. The renderer runs one batch concurrently, so the number of in-flight
 * `drive:uploadPart` calls never exceeds the requested bound.
 */
export function parallelBatches(
  partCount: number,
  concurrency: number = DRIVE_MAX_PARALLEL_PARTS,
): number[][] {
  if (!Number.isInteger(partCount) || partCount < 0) throw new Error('parallelBatches: partCount must be a non-negative integer')
  if (!Number.isInteger(concurrency) || concurrency <= 0) throw new Error('parallelBatches: concurrency must be a positive integer')
  const batches: number[][] = []
  for (let index = 0; index < partCount; index += concurrency) {
    const batch: number[] = []
    for (let offset = 0; offset < concurrency && index + offset < partCount; offset += 1) batch.push(index + offset)
    batches.push(batch)
  }
  return batches
}

/** Highest in-flight part count across all batches — always ≤ concurrency. */
export function maxParallelism(partCount: number, concurrency: number = DRIVE_MAX_PARALLEL_PARTS): number {
  return parallelBatches(partCount, concurrency).reduce((max, batch) => Math.max(max, batch.length), 0)
}

export type DriveMeterLevel = 'ok' | 'warn' | 'critical'

/** Amber at ≥80%, red at ≥95% (owner spec). */
export function meterLevel(usedBytes: number, totalBytes: number): DriveMeterLevel {
  if (!Number.isFinite(totalBytes) || totalBytes <= 0) return 'ok'
  const ratio = Math.max(0, usedBytes) / totalBytes
  if (ratio >= 0.95) return 'critical'
  if (ratio >= 0.8) return 'warn'
  return 'ok'
}

/** Used fraction clamped to [0, 1]; drives the meter fill width. */
export function meterFraction(usedBytes: number, totalBytes: number): number {
  if (!Number.isFinite(totalBytes) || totalBytes <= 0) return 0
  return Math.min(1, Math.max(0, usedBytes) / totalBytes)
}

/** Recompute the ledger from completed files; reservations are added by callers. */
export function recomputeLedger(
  fileSizes: Iterable<number>,
  totalBytes: number = DRIVE_DEFAULT_QUOTA_BYTES,
  reservedBytes = 0,
): DriveQuota {
  let usedBytes = 0
  for (const size of fileSizes) {
    if (Number.isFinite(size) && size > 0) usedBytes += size
  }
  const reserved = Number.isFinite(reservedBytes) && reservedBytes > 0 ? reservedBytes : 0
  return {
    totalBytes,
    usedBytes,
    reservedBytes: reserved,
    freeBytes: Math.max(0, totalBytes - usedBytes - reserved),
  }
}

/** Sum of parts still to transfer, in bytes. */
export function remainingBytes(parts: readonly DrivePart[]): number {
  let remaining = 0
  for (const part of parts) {
    if (!part.done) remaining += part.sizeBytes
  }
  return remaining
}

export function sessionProgress(session: DriveUploadSession): {
  doneBytes: number
  doneParts: number
  totalParts: number
} {
  let doneBytes = 0
  let doneParts = 0
  for (const part of session.parts) {
    if (part.done) {
      doneBytes += part.sizeBytes
      doneParts += 1
    }
  }
  return { doneBytes, doneParts, totalParts: session.parts.length }
}

/** Aggregate progress across a set of sessions. */
export function aggregateProgress(sessions: readonly DriveUploadSession[]): {
  doneBytes: number
  totalBytes: number
  doneFiles: number
  totalFiles: number
} {
  let doneBytes = 0
  let totalBytes = 0
  let doneFiles = 0
  for (const session of sessions) {
    totalBytes += session.size
    if (session.status === 'completed') {
      doneBytes += session.size
      doneFiles += 1
    } else if (session.status === 'open') {
      doneBytes += sessionProgress(session).doneBytes
    } else {
      totalBytes -= session.size
    }
  }
  return { doneBytes, totalBytes, doneFiles, totalFiles: sessions.length }
}

/** FNV-1a 32-bit — a cheap, stable identity for a part's byte range. */
export function partFingerprint(uploadId: string, index: number, sizeBytes: number): string {
  const text = `${uploadId}:${index}:${sizeBytes}`
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}