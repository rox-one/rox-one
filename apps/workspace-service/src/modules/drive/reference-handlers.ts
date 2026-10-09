/**
 * W1-14 (#1511) — Drive upload admission in the workspace service
 * (TECH-SPEC §16.2).
 *
 * The command handlers decide *whether* an upload may start; the service is
 * what actually talks to S3: `CreateMultipartUpload`, the presigned part URLs
 * and `AbortMultipartUpload`. This module keeps that half — admission on top
 * of the drive row, then the S3 calls through an injected port, so the cloud
 * deployment can point at any S3 (ADR-U17) and an operator can test the refusal
 * path without a bucket.
 */

import { UPLOAD_PARALLEL_PARTS, UPLOAD_SESSION_TTL_MS, admitUpload, planUploadParts, quotaExceededError, type DriveQuota, type QuotaExceededError } from '@rox/core/drive'

export interface StoragePort {
  /** The quota counters of a drive row, or `null` when it has none. */
  quota(driveId: string): Promise<Omit<DriveQuota, 'trashBytes'> | null>
  createMultipartUpload(input: { key: string; contentType?: string }): Promise<{ s3UploadId: string }>
  presignParts(input: { s3UploadId: string; key: string; partCount: number }): Promise<string[]>
  abortMultipartUpload(input: { s3UploadId: string; key: string }): Promise<void>
}

export interface OpenUploadRequest {
  driveId: string
  fileName: string
  sizeExpected: number
  contentType?: string
}

export interface OpenUploadOutcome {
  s3UploadId: string
  /** Object key of the multipart upload (needed to abort or complete it). */
  key: string
  /** One presigned URL per part; the client uploads `UPLOAD_PARALLEL_PARTS` at a time. */
  partUrls: string[]
  partSizeBytes: number
  parallelParts: number
  /** Unix-epoch ms the session must be finished or aborted by (§16.2 step 4). */
  expiresAt: number
}

export interface DriveUploadService {
  /** Admission first, S3 second: a refused upload never opens a multipart session. */
  openUpload(request: OpenUploadRequest): Promise<OpenUploadOutcome | { error: QuotaExceededError }>
  abortUpload(input: { s3UploadId: string; key: string }): Promise<void>
}

export function createDriveUploadService(port: StoragePort, now: () => Date = () => new Date()): DriveUploadService {
  return {
    async openUpload(request) {
      const quota = await port.quota(request.driveId)
      if (!quota) return { error: quotaExceededError({ used: 0, limit: 0, needed: request.sizeExpected, free: 0 }) }
      const admission = admitUpload(quota, request.sizeExpected)
      if (!admission.ok) return { error: quotaExceededError(admission.detail) }
      const plan = planUploadParts(request.sizeExpected)
      const key = `uploads/${request.driveId}/${Date.now()}-${request.fileName}`
      const { s3UploadId } = await port.createMultipartUpload({ key, ...(request.contentType ? { contentType: request.contentType } : {}) })
      const partUrls = await port.presignParts({ s3UploadId, key, partCount: plan.partCount })
      return {
        s3UploadId,
        key,
        partUrls,
        partSizeBytes: plan.partSizeBytes,
        parallelParts: UPLOAD_PARALLEL_PARTS,
        expiresAt: now().getTime() + UPLOAD_SESSION_TTL_MS,
      }
    },
    async abortUpload({ s3UploadId, key }) {
      await port.abortMultipartUpload({ s3UploadId, key })
    },
  }
}