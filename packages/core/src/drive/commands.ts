/**
 * W1-14 (#1511) — Drive command contracts (TECH-SPEC §16, DATA-MODEL §5.15).
 *
 * Three commands carry the personal Drive: `drive.provision` (R5: one drive
 * and its root folder per account), `drive.open_upload` (admission +
 * reservation) and `drive.complete_upload` (file + version + ledger). The
 * remaining Drive commands (`drive.create_folder`, `drive.move_items`, …) keep
 * the #1503 reference handlers; this module adds the quota-bearing paths.
 *
 * Risk classes (TECH-SPEC §13): all three are **routine** — they write to the
 * caller's own drive and never touch another principal's data. Uploading a file
 * for someone else, or raising a quota, is not one of these commands.
 */

import type { EntityRef } from '../entities/refs.ts'
import type { CommandRiskContext, RiskClass } from '../commands/registry.ts'
import { UPLOAD_PART_MAX_BYTES, UPLOAD_PART_MIN_BYTES } from './upload.ts'
import type { QuotaExceededDetail } from './quota.ts'

/** `QUOTA_EXCEEDED` (`COMMAND_ERROR_CODES`), the §16.3 admission rejection. */
export const QUOTA_EXCEEDED_CODE = 'QUOTA_EXCEEDED'

export interface QuotaExceededError {
  code: typeof QUOTA_EXCEEDED_CODE
  message: string
  /** `{used, limit, needed, free}` — exactly what the upload panel prints. */
  detail: QuotaExceededDetail
}

export function quotaExceededError(detail: QuotaExceededDetail): QuotaExceededError {
  return {
    code: QUOTA_EXCEEDED_CODE,
    message: `Drive quota exceeded: ${detail.needed} bytes needed, ${detail.free} free`,
    detail,
  }
}

/**
 * `drive.provision` — R5 (DATA-MODEL §5.16): one `drive` row plus the root
 * folder «Мой диск». `quotaBytes` defaults to the workspace setting and then
 * to 1 TiB (D-v2-8); a per-user override is an admin action and audited.
 */
export interface DriveProvisionPayload {
  quotaBytes?: number
  /** Localised name of the root folder at creation time. */
  rootFolderName?: string
  /** Charge files that already exist in the account's folders to the ledger. */
  backfill?: boolean
}

export interface DriveProvisionResult {
  driveRef: EntityRef
  rootFolderRef: EntityRef
  quotaBytes: number
  /** Files the backfill charged, when `backfill` was set. */
  backfilled?: number
}

/** The stored default root-folder name (the DDL comment's «Мой диск»). */
export const DEFAULT_DRIVE_ROOT_FOLDER_NAME = 'Мой диск'

export interface DriveOpenUploadPayload {
  /** Client id for the `upload_session` row. */
  id?: string
  folderId?: string
  fileName: string
  sizeExpected: number
  contentType?: string
  /** When the blob is already stored, the upload completes without bytes. */
  sha256?: string
}

export interface DriveOpenUploadResult {
  uploadSessionId: string
  /** Presigned multipart URLs, `partCount` of them, 8–64 MB parts. */
  partCount: number
  partSizeBytes: number
  /** `true`: the blob exists — no bytes are sent, the ledger is charged anyway. */
  instant: boolean
  expiresAt: string
  /** Quota after the reservation was taken. */
  usedBytes: number
  reservedBytes: number
}

export interface DriveCompleteUploadPayload {
  uploadSessionId: string
  /** Content hash the client claims; the server checks it against the declared one. */
  sha256: string
  /** Every part must report its `sizeBytes` — the server sums them to attest the upload. */
  parts?: { partNumber: number; etag: string; sizeBytes?: number }[]
}

export interface DriveCompleteUploadResult {
  fileRef: EntityRef
  versionNo: number
  sizeBytes: number
  /** Drive counters after the reservation became a ledger `upload`. */
  usedBytes: number
  reservedBytes: number
  /** Preview job enqueued for the new version. */
  previewQueued: boolean
}

export type DriveContractType = 'drive.provision' | 'drive.open_upload' | 'drive.complete_upload' | 'drive.abort_upload'

/** The four commands this module owns (catalogue order). */
export const DRIVE_CONTRACT_TYPES: readonly DriveContractType[] = ['drive.provision', 'drive.open_upload', 'drive.complete_upload', 'drive.abort_upload']

/** Storage lives in the caller's own drive for every one of the four. */
export function driveRiskClass(_payload: unknown, _ctx: CommandRiskContext): RiskClass {
  return 'routine'
}

/** Risk class per drive contract command; the registry binds these. */
export const DRIVE_COMMAND_RISK: Readonly<Record<DriveContractType, (payload: unknown, ctx: CommandRiskContext) => RiskClass>> = {
  'drive.provision': driveRiskClass,
  'drive.open_upload': driveRiskClass,
  'drive.complete_upload': driveRiskClass,
  'drive.abort_upload': driveRiskClass,
}

/** `drive.abort_upload {uploadSessionId}` — TECH-SPEC §16.2 step 4. */
export interface DriveAbortUploadPayload {
  uploadSessionId: string
}

export interface DriveAbortUploadResult {
  uploadSessionId: string
  /** Bytes handed back to the quota. */
  releasedBytes: number
}

export interface UploadPartPlan {
  partSizeBytes: number
  partCount: number
}

/** S3 allows at most 10 000 parts. */
export const MAX_UPLOAD_PARTS = 10_000

/**
 * The multipart plan of one upload: parts stay between 8 and 64 MB and the
 * count stays under the S3 ceiling. A file smaller than the minimum becomes a
 * single part.
 */
export function planUploadParts(sizeExpected: number): UploadPartPlan {
  const size = Math.max(0, Math.trunc(sizeExpected))
  if (size === 0) return { partSizeBytes: 0, partCount: 1 }
  // A file below the multipart minimum is one part of its own size (S3 allows
  // that for a single-part upload).
  if (size <= UPLOAD_PART_MIN_BYTES) return { partSizeBytes: size, partCount: 1 }
  let partSizeBytes = UPLOAD_PART_MIN_BYTES
  while (partSizeBytes < UPLOAD_PART_MAX_BYTES && Math.ceil(size / partSizeBytes) > MAX_UPLOAD_PARTS) partSizeBytes *= 2
  return { partSizeBytes, partCount: Math.ceil(size / partSizeBytes) }
}