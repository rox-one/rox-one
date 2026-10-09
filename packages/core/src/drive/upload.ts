/**
 * W1-14 (#1511) — Upload protocol (TECH-SPEC §16.2, DATA-MODEL §5.15).
 *
 * 1. `drive.open_upload {folderId, name, size, contentType, sha256?}` →
 *    admission against the quota → `upload_session` + S3
 *    `CreateMultipartUpload` → presigned part URLs (8–64 MB parts).
 *    A known `sha256` makes it an **instant upload**: no bytes travel, and the
 *    ledger is charged anyway (dedupe saves backend space, never the charge).
 * 2. The client PUTs three parts at a time; progress lives in
 *    `upload_session.parts` so a reconnect or a restart resumes.
 * 3. `drive.complete_upload {uploadSessionId, sha256, parts}` → attest the
 *    uploaded bytes (the part sizes must sum to `size_expected`) →
 *    `file_object` + `file_version` → ledger `upload` → release the
 *    reservation → enqueue the preview job.
 * 4. Abort or 24 h expiry → `AbortMultipartUpload`, then release the
 *    reservation. An expired session can never be completed.
 */

import { MIB_BYTES } from './quota.ts'

export const UPLOAD_SESSION_STATUSES = ['open', 'completed', 'aborted', 'expired'] as const
export type UploadSessionStatus = (typeof UPLOAD_SESSION_STATUSES)[number]

/** A session expires 24 h after it was opened (§16.2 step 4). */
export const UPLOAD_SESSION_TTL_MS = 24 * 60 * 60 * 1000

/** S3 multipart minimum part size (except the last part) and maximum. */
export const UPLOAD_PART_MIN_BYTES = 8 * MIB_BYTES
export const UPLOAD_PART_MAX_BYTES = 64 * MIB_BYTES

/** Parts the client uploads in parallel. */
export const UPLOAD_PARALLEL_PARTS = 3

export interface UploadPart {
  partNumber: number
  etag: string
  sizeBytes?: number
}

/** `upload_session` row (`16-drive-quota.sql`). */
export interface UploadSession {
  uploadSessionId: string
  driveId: string
  folderId?: string
  fileName: string
  sizeExpected: number
  contentType?: string
  s3UploadId?: string
  parts: UploadPart[]
  /** Quota held while the session is open (`reserved_bytes`). */
  reservedBytes: number
  status: UploadSessionStatus
  idempotencyKey: string
  expiresAt: string
  createdAt: string
  /** Present once the server has hashed the uploaded bytes. */
  sha256?: string
}

export interface OpenUploadInput {
  uploadSessionId: string
  driveId: string
  folderId?: string
  fileName: string
  sizeExpected: number
  contentType?: string
  /** Content hash of the file, when the client already knows it. */
  sha256?: string
  idempotencyKey: string
  now: string
}

/** A session with its reservation taken (`reserved_bytes = size_expected`). */
export function openUploadSession(input: OpenUploadInput): UploadSession {
  const session: UploadSession = {
    uploadSessionId: input.uploadSessionId,
    driveId: input.driveId,
    fileName: input.fileName,
    sizeExpected: input.sizeExpected,
    parts: [],
    reservedBytes: input.sizeExpected,
    status: 'open',
    idempotencyKey: input.idempotencyKey,
    expiresAt: new Date(Date.parse(input.now) + UPLOAD_SESSION_TTL_MS).toISOString(),
    createdAt: input.now,
  }
  if (input.folderId) session.folderId = input.folderId
  if (input.contentType) session.contentType = input.contentType
  if (input.sha256) session.sha256 = input.sha256
  return session
}

/**
 * A known content hash turns the upload into an instant one: nothing is
 * transferred, but the file, its version and its ledger charge are real.
 */
export function isInstantUpload(sha256: string | undefined, blobExists: (sha256: string) => boolean): boolean {
  return Boolean(sha256) && blobExists(sha256!)
}

export type UploadCompletion =
  | { ok: true; instant: boolean }
  | { ok: false; reason: 'already_completed' | 'aborted' | 'expired' }

/** Whether `drive.complete_upload` may proceed. Expiry is checked first. */
export function canCompleteUpload(session: Pick<UploadSession, 'status' | 'expiresAt'>, now: string): UploadCompletion {
  if (session.status === 'aborted') return { ok: false, reason: 'aborted' }
  if (session.status === 'expired') return { ok: false, reason: 'expired' }
  if (session.status === 'completed') return { ok: false, reason: 'already_completed' }
  if (Date.parse(session.expiresAt) <= Date.parse(now)) return { ok: false, reason: 'expired' }
  return { ok: true, instant: false }
}

/** Bytes of an uploaded part map; the caller compares it with `size_expected`. */
export function uploadedBytes(session: Pick<UploadSession, 'sizeExpected'> & { parts: readonly UploadPart[] }, partSizes: Readonly<Record<string, number>>): number {
  return session.parts.reduce((total, part) => total + (part.sizeBytes ?? partSizes[String(part.partNumber)] ?? 0), 0)
}

export interface UploadRelease {
  session: UploadSession
  /** Bytes handed back to the quota (`reserved_bytes -= reservedBytes`). */
  releasedBytes: number
}

/** Abort: the reservation goes back, the session keeps its parts for forensics. */
export function abortUpload(session: UploadSession, now: string): UploadRelease {
  return {
    session: { ...session, status: 'aborted', reservedBytes: 0, parts: session.parts },
    releasedBytes: session.reservedBytes,
  }
}

/**
 * Expire every open session of a drive past its deadline and release the
 * reservations. A reference implementation runs this before admitting a new
 * upload (the wave-2 worker runs it on a schedule, §16.2 step 4).
 */
export function expireUploadSessions(sessions: readonly UploadSession[], now: string): UploadRelease[] {
  const releases: UploadRelease[] = []
  for (const session of sessions) {
    if (session.status !== 'open' || Date.parse(session.expiresAt) > Date.parse(now)) continue
    releases.push({ session: { ...session, status: 'expired', reservedBytes: 0 }, releasedBytes: session.reservedBytes })
  }
  return releases
}

/** Reserved bytes of every open session of a drive. */
export function reservedBytesOf(sessions: readonly UploadSession[]): number {
  return sessions.reduce((total, session) => total + (session.status === 'open' ? session.reservedBytes : 0), 0)
}