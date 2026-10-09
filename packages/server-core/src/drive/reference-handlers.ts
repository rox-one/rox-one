/**
 * W1-14 (#1511) — Personal Drive reference handlers (TECH-SPEC §16.
 *
 * The quota-bearing commands, implemented for real against the ordinary
 * record backends:
 *
 * - `drive.provision` — the drive row and its «Мой диск» root folder (R5);
 * - `drive.open_upload` — admission (`used + reserved + size ≤ quota`), the
 *   reservation, and the instant-upload case for a known `sha256`;
 * - `drive.complete_upload` — file + version + ledger `upload`, reservation
 *   released, preview queued;
 * - `drive.abort_upload` — §16.2 step 4: the reservation goes back.
 *
 * Everything the quota depends on lives on the `drive-quota` row
 * (`usedBytes`, `reservedBytes`, `trashBytes`, `state`), and every byte that is
 * charged has a `storage-ledger` row, so a reconciler can always recompute
 * `usedBytes` from the ledger (DATA-MODEL §5.15, quota rule 2).
 */

import { CommandRejection } from '@rox/core/commands'
import {
  DEFAULT_DRIVE_QUOTA_BYTES, DEFAULT_DRIVE_ROOT_FOLDER_NAME, abortUpload, admitUpload, applyLedgerEntry, canCompleteUpload, creditReservation,
  driveStateFor, ledgerDeltaBytes, openUploadSession, planUploadParts, quotaExceededError, uploadedBytes,
  type DriveCounters, type StorageLedgerReason, type UploadPart, type UploadSession,
} from '@rox/core/drive'
import { deterministicId, isDeleted, type ReferenceOutcome, type ReferenceTx } from '../work/reference/engine'
import { authorizeId } from '../work/reference/ops'
import type { RecordData, StoredRecord } from '../work/reference/types'
import type { ReferenceSpecMap } from '../work/reference/specs/types'

const DRIVE = 'drive-quota'
const SESSION = 'upload-session'
const FILE = 'file'
const VERSION = 'file-version'
const LEDGER = 'storage-ledger'
const PREVIEW = 'file-preview'
const BLOB = 'file-blob'

const out = (collection: string, record: StoredRecord, changes: string[], extra: Partial<ReferenceOutcome> = {}): ReferenceOutcome => ({
  collection, id: record.id, revision: record.revision, changes, ...extra,
})

/** The drive row of one principal, or `null`. */
async function driveOf(tx: ReferenceTx, principalId: string): Promise<StoredRecord | null> {
  const record = await tx.get(DRIVE, principalId)
  return record && !isDeleted(record) ? record : null
}

function countersOf(drive: StoredRecord): DriveCounters {
  return {
    usedBytes: Number(drive.data.usedBytes ?? 0),
    reservedBytes: Number(drive.data.reservedBytes ?? 0),
    trashBytes: Number(drive.data.trashBytes ?? 0),
  }
}

/** The open sessions of a drive, from the index the drive row carries. */
async function openSessionIds(drive: StoredRecord): Promise<string[]> {
  return Array.isArray(drive.data.openSessionIds) ? (drive.data.openSessionIds as string[]) : []
}

/**
 * Expire this drive's overdue sessions and hand their reservations back
 * (§16.2 step 4). A reference run does it before admitting a new upload; the
 * wave-2 worker runs it on a schedule.
 */
async function releaseExpired(tx: ReferenceTx, drive: StoredRecord): Promise<{ drive: StoredRecord; released: string[] }> {
  let current = drive
  const released: string[] = []
  for (const id of await openSessionIds(drive)) {
    const session = await tx.get(SESSION, id)
    if (!session || isDeleted(session) || session.data.status !== 'open') continue
    if (Date.parse(String(session.data.expiresAt ?? '')) > Date.parse(tx.now)) continue
    const stored = storedSession(session)
    const release = abortUpload({ ...stored, status: 'open' }, tx.now)
    await tx.update(SESSION, session, { status: 'expired', reservedBytes: 0 })
    current = await tx.update(DRIVE, current, {
      reservedBytes: Math.max(0, Number(current.data.reservedBytes ?? 0) - release.releasedBytes),
      openSessionIds: (await openSessionIds(current)).filter(open => open !== id),
    })
    released.push(id)
  }
  return { drive: current, released }
}

/** An `upload_session` row as the core contract types it. */
function storedSession(record: StoredRecord): UploadSession {
  const data = record.data
  return {
    uploadSessionId: record.id,
    driveId: String(data.driveId ?? ''),
    ...(typeof data.folderId === 'string' ? { folderId: data.folderId } : {}),
    fileName: String(data.fileName ?? ''),
    sizeExpected: Number(data.sizeExpected ?? 0),
    ...(typeof data.contentType === 'string' ? { contentType: data.contentType } : {}),
    ...(typeof data.s3UploadId === 'string' ? { s3UploadId: data.s3UploadId } : {}),
    parts: Array.isArray(data.parts) ? (data.parts as UploadSession['parts']) : [],
    reservedBytes: Number(data.reservedBytes ?? 0),
    status: (data.status ?? 'open') as UploadSession['status'],
    idempotencyKey: String(data.idempotencyKey ?? record.id),
    expiresAt: String(data.expiresAt ?? ''),
    createdAt: String(data.createdAt ?? ''),
    ...(typeof data.sha256 === 'string' ? { sha256: data.sha256 } : {}),
  }
}

/**
 * The uploaded byte total the server can attest (§16.2 step 3). An empty
 * session is only attestable for a zero-byte file; otherwise every part must
 * report its size — a client that only claims an etag gets an explicit
 * `unverified upload`, never a silent charge.
 */
function attestedUploadSize(parts: readonly UploadPart[], sizeExpected: number): number {
  if (parts.length === 0) {
    if (sizeExpected === 0) return 0
    throw new CommandRejection('VALIDATION', 'unverified upload: the server cannot attest the uploaded bytes')
  }
  if (parts.some(part => typeof part.sizeBytes !== 'number')) {
    throw new CommandRejection('VALIDATION', 'unverified upload: every part must report its size')
  }
  const partSizes: Record<string, number> = {}
  for (const part of parts) partSizes[String(part.partNumber)] = part.sizeBytes as number
  return uploadedBytes({ sizeExpected, parts }, partSizes)
}

/** One `storage_ledger` row; its key is the idempotency key, so a retry writes one entry. */
async function ledgerEntry(tx: ReferenceTx, driveId: string, reason: StorageLedgerReason, sizeBytes: number, key: string, extra: RecordData = {}): Promise<StoredRecord> {
  return tx.upsert(LEDGER, deterministicId(tx.ctx.workspaceId, 'ledger', key), {
    driveId,
    deltaBytes: ledgerDeltaBytes(reason, sizeBytes),
    reason,
    ...extra,
  }, { driveId, reason, idempotencyKey: key })
}

export const DRIVE_REFERENCE_SPECS: ReferenceSpecMap = {
  /** R5: the drive row plus its root folder «Мой диск» (DATA-MODEL §5.16). */
  'drive.provision': async tx => {
    const quotaBytes = Number(tx.payload.quotaBytes ?? DEFAULT_DRIVE_QUOTA_BYTES)
    if (quotaBytes <= 0) throw new CommandRejection('VALIDATION', 'quotaBytes must be positive')
    const current = await tx.get(DRIVE, tx.actor)
    if (current && !isDeleted(current)) {
      return out(DRIVE, current, [], { ref: null, result: { driveRef: { kind: 'folder', id: String(current.data.rootFolderId ?? '') }, rootFolderRef: { kind: 'folder', id: String(current.data.rootFolderId ?? '') }, quotaBytes: Number(current.data.quotaBytes ?? quotaBytes), existed: true } })
    }
    const rootFolderId = deterministicId(tx.ctx.workspaceId, 'drive-root', tx.actor)
    const root = await tx.insert('folder', rootFolderId, { name: String(tx.payload.rootFolderName ?? DEFAULT_DRIVE_ROOT_FOLDER_NAME), ownerType: 'user', ownerId: tx.actor })
    const record = await tx.insert(DRIVE, tx.actor, {
      ownerPrincipalId: tx.actor,
      rootFolderId,
      quotaBytes,
      usedBytes: 0,
      reservedBytes: 0,
      trashBytes: 0,
      openSessionIds: [],
      state: 'active',
      ...(tx.payload.backfill ? { backfillRequestedAt: tx.now } : {}),
    })
    return out(DRIVE, record, ['state', 'quotaBytes'], {
      ref: { kind: 'folder', id: rootFolderId },
      result: { driveRef: { kind: 'folder', id: rootFolderId }, rootFolderRef: { kind: 'folder', id: root.id }, quotaBytes, existed: false },
    })
  },

  /** §16.2 step 1: admission, reservation and the multipart plan. */
  'drive.open_upload': async tx => {
    const drive = await driveOf(tx, tx.actor)
    if (!drive) throw new CommandRejection('NOT_FOUND', 'no drive for this principal: run drive.provision')
    if (tx.payload.folderId) await authorizeId(tx, 'folder', tx.payload.folderId, 'write')
    const { drive: current } = await releaseExpired(tx, drive)
    const size = Number(tx.payload.sizeExpected)
    const admission = admitUpload({ ...countersOf(current), quotaBytes: Number(current.data.quotaBytes ?? DEFAULT_DRIVE_QUOTA_BYTES), state: (current.data.state ?? 'active') as never }, size)
    if (!admission.ok) {
      const error = quotaExceededError(admission.detail)
      throw new CommandRejection('QUOTA_EXCEEDED', error.message, admission.detail as unknown as Record<string, unknown>)
    }
    const id = tx.createId()
    await tx.assertAbsent(SESSION, id)
    const sha256 = typeof tx.payload.sha256 === 'string' ? tx.payload.sha256 : undefined
    // A known blob turns this into an instant upload: no bytes travel, the
    // ledger is still charged (§16.2 step 1, DATA-MODEL quota rule 4).
    const instant = sha256 !== undefined && (await tx.get(BLOB, sha256)) !== null
    const session = openUploadSession({
      uploadSessionId: id,
      driveId: current.id,
      ...(typeof tx.payload.folderId === 'string' ? { folderId: tx.payload.folderId } : {}),
      fileName: String(tx.payload.fileName),
      sizeExpected: size,
      ...(typeof tx.payload.contentType === 'string' ? { contentType: tx.payload.contentType } : {}),
      ...(sha256 ? { sha256 } : {}),
      idempotencyKey: tx.ctx.envelope.idempotencyKey,
      now: tx.now,
    })
    const reserved = Number(current.data.reservedBytes ?? 0) + session.reservedBytes
    const updated = await tx.update(DRIVE, current, {
      reservedBytes: reserved,
      openSessionIds: [...new Set([...(await openSessionIds(current)), id])],
    })
    const record = await tx.insert(SESSION, id, { ...session, instant })
    const plan = planUploadParts(size)
    return out(SESSION, record, ['status', 'reservedBytes'], {
      ref: { kind: 'folder', id: String(updated.data.rootFolderId ?? '') },
      result: {
        uploadSessionId: id,
        partCount: instant ? 0 : plan.partCount,
        partSizeBytes: instant ? 0 : plan.partSizeBytes,
        instant,
        expiresAt: session.expiresAt,
        usedBytes: Number(updated.data.usedBytes ?? 0),
        reservedBytes: reserved,
      },
    })
  },

  /** §16.2 step 3: file + version + ledger, reservation released, preview queued. */
  'drive.complete_upload': async tx => {
    const sessionId = String(tx.payload.uploadSessionId)
    const row = await tx.get(SESSION, sessionId)
    if (!row || isDeleted(row)) throw new CommandRejection('NOT_FOUND', `upload session ${sessionId} not found`)
    const session = storedSession(row)
    if (session.driveId !== tx.actor) throw new CommandRejection('FORBIDDEN', 'upload session belongs to another drive')
    if (tx.payload.sha256 && session.sha256 && tx.payload.sha256 !== session.sha256) throw new CommandRejection('VALIDATION', 'sha256 does not match the declared upload')
    const decision = canCompleteUpload(session, tx.now)
    if (!decision.ok) {
      if (decision.reason === 'expired') throw new CommandRejection('VALIDATION', 'upload session expired')
      throw new CommandRejection('VALIDATION', `upload session is ${decision.reason}`)
    }
    const drive = await driveOf(tx, tx.actor)
    if (!drive) throw new CommandRejection('NOT_FOUND', 'no drive for this principal: run drive.provision')
    const sha256 = String(tx.payload.sha256)
    const storedParts = Array.isArray(row.data.parts) ? (row.data.parts as UploadSession['parts']) : []
    const incoming = Array.isArray(tx.payload.parts) ? (tx.payload.parts as UploadPart[]) : []
    const parts = incoming.length > 0 ? incoming : storedParts
    // Fail closed: charge the ledger only for bytes the server can attest
    // (§16.2 step 3). A known blob is already-stored content, so its size is
    // the attestation; an ordinary upload must report every part size and
    // their sum is the attestation used below.
    const blob = await tx.get(BLOB, sha256)
    const sizeBytes = blob && !isDeleted(blob)
      ? Number(blob.data.sizeBytes ?? 0)
      : attestedUploadSize(parts, session.sizeExpected)
    if (sizeBytes !== session.sizeExpected) {
      throw new CommandRejection('VALIDATION', `uploaded ${sizeBytes} bytes do not match the declared ${session.sizeExpected}`)
    }
    await tx.update(SESSION, row, { status: 'completed', reservedBytes: 0, sha256, parts, completedAt: tx.now })
    const fileId = deterministicId(tx.ctx.workspaceId, 'file', sha256, session.fileName, tx.actor)
    const existing = await tx.get(FILE, fileId)
    const versionNo = existing && !isDeleted(existing) ? Number(existing.data.currentVersion ?? 1) + 1 : 1
    const file = await tx.upsert(FILE, fileId, {
      name: session.fileName,
      sizeBytes,
      sha256,
      currentVersion: versionNo,
      uploadedBy: tx.actor,
      ownerDriveId: tx.actor,
      storageKey: `blobs/sha256/${sha256.slice(0, 2)}/${sha256.slice(2, 4)}/${sha256}`,
      sourceRef: `upload`,
      ...(session.folderId ? { folderId: session.folderId } : {}),
      ...(session.contentType ? { contentType: session.contentType } : {}),
    }, { uploadedBy: tx.actor, currentVersion: 1 })
    await tx.upsert(VERSION, `${fileId}:${versionNo}`, {
      sizeBytes,
      sha256,
      storageKey: `blobs/sha256/${sha256.slice(0, 2)}/${sha256.slice(2, 4)}/${sha256}`,
      contentType: session.contentType ?? 'application/octet-stream',
    }, { fileId, versionNo, createdBy: tx.actor })
    await ledgerEntry(tx, drive.id, 'upload', sizeBytes, `upload:${sessionId}`, { fileId, versionNo })
    await tx.upsert(BLOB, sha256, { fileId, sizeBytes }, { sha256 })
    await tx.upsert(PREVIEW, `${fileId}:${versionNo}:thumb_256`, { status: 'pending' }, { fileId, versionNo, kind: 'thumb_256' })
    const counters = applyLedgerEntry(countersOf(drive), 'upload', sizeBytes)
    const usedBytes = Math.max(0, Number(drive.data.usedBytes ?? 0) + ledgerDeltaBytes('upload', sizeBytes))
    const updated = await tx.update(DRIVE, drive, {
      usedBytes,
      reservedBytes: Math.max(0, Number(drive.data.reservedBytes ?? 0) - session.reservedBytes),
      openSessionIds: (await openSessionIds(drive)).filter(open => open !== sessionId),
      state: driveStateFor(usedBytes, Number(drive.data.quotaBytes ?? DEFAULT_DRIVE_QUOTA_BYTES), (drive.data.state ?? 'active') as never),
    })
    return out(FILE, file, ['sha256', 'currentVersion'], {
      ref: { kind: 'file', id: fileId },
      result: { fileRef: { kind: 'file', id: fileId }, versionNo, sizeBytes, usedBytes, reservedBytes: Number(updated.data.reservedBytes ?? 0), previewQueued: true, trashBytes: counters.trashBytes },
    })
  },

  /** §16.2 step 4: abort releases the reservation immediately. */
  'drive.abort_upload': async tx => {
    const sessionId = String(tx.payload.uploadSessionId)
    const row = await tx.get(SESSION, sessionId)
    if (!row || isDeleted(row)) throw new CommandRejection('NOT_FOUND', `upload session ${sessionId} not found`)
    const session = storedSession(row)
    if (session.driveId !== tx.actor) throw new CommandRejection('FORBIDDEN', 'upload session belongs to another drive')
    if (session.status !== 'open') throw new CommandRejection('VALIDATION', `upload session is ${session.status}`)
    const release = abortUpload(session, tx.now)
    await tx.update(SESSION, row, { status: 'aborted', reservedBytes: 0 })
    const drive = await driveOf(tx, tx.actor)
    if (drive) {
      await tx.update(DRIVE, drive, {
        reservedBytes: creditReservation(Number(drive.data.reservedBytes ?? 0), release.releasedBytes),
        openSessionIds: (await openSessionIds(drive)).filter(open => open !== sessionId),
      })
    }
    return out(SESSION, row, ['status'], { ref: tx.rawTarget ?? null, result: { uploadSessionId: sessionId, releasedBytes: release.releasedBytes } })
  },
}

