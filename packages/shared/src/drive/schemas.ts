/**
 * W1-14 (#1511) — Zod validation for the personal Drive (TECH-SPEC §16,
 * DATA-MODEL §5.15).
 *
 * The three quota-bearing commands plus the abort, and the stored shapes the
 * ledger, the versions and the upload sessions have. `sha256` is hex either
 * way: the client sends it when it knows the blob (instant upload), the server
 * always verifies it on completion.
 */

import { z } from 'zod'
import { MAX_UPLOAD_PARTS } from '@rox/core/drive'
import { UPLOAD_SESSION_STATUSES, type UploadSession } from '@rox/core/drive'
import { STORAGE_LEDGER_REASONS } from '@rox/core/drive'
import { cmd, idSchema, isoDateTimeSchema, nameSchema, createIdShape, type CommandSchemaMap } from '../domain/common'

export const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/, { message: 'sha256 must be 64 lowercase hex characters' })

/** 1 TiB ceiling on a per-user override: the default is already the maximum we quote. */
export const DRIVE_QUOTA_MAX_BYTES = 1024 ** 4

export const driveProvisionSchema = cmd({
  quotaBytes: z.number().int().positive().max(DRIVE_QUOTA_MAX_BYTES).optional(),
  rootFolderName: nameSchema.optional(),
  backfill: z.boolean().optional(),
})

export const driveOpenUploadSchema = cmd({
  ...createIdShape,
  folderId: idSchema.optional(),
  fileName: nameSchema,
  sizeExpected: z.number().int().nonnegative().max(DRIVE_QUOTA_MAX_BYTES),
  contentType: z.string().max(255).optional(),
  sha256: sha256Schema.optional(),
})

export const uploadPartSchema = z.object({ partNumber: z.number().int().positive().max(MAX_UPLOAD_PARTS), etag: z.string().min(1).max(256) }).strict()

export const driveCompleteUploadSchema = cmd({
  uploadSessionId: idSchema,
  sha256: sha256Schema,
  parts: z.array(uploadPartSchema).max(MAX_UPLOAD_PARTS).optional(),
})

export const driveAbortUploadSchema = cmd({ uploadSessionId: idSchema })

const uploadPartStoredSchema = z.object({ partNumber: z.number().int().positive(), etag: z.string().min(1).max(256), sizeBytes: z.number().int().nonnegative().optional() }).strict()

/** `upload_session` row (`16-drive-quota.sql`). */
export const uploadSessionSchema: z.ZodType<UploadSession> = z
  .object({
    uploadSessionId: idSchema,
    driveId: idSchema,
    folderId: idSchema.optional(),
    fileName: nameSchema,
    sizeExpected: z.number().int().nonnegative(),
    contentType: z.string().max(255).optional(),
    s3UploadId: z.string().min(1).max(512).optional(),
    parts: z.array(uploadPartStoredSchema),
    reservedBytes: z.number().int().nonnegative(),
    status: z.enum(UPLOAD_SESSION_STATUSES),
    idempotencyKey: z.string().min(1).max(256),
    expiresAt: isoDateTimeSchema,
    createdAt: isoDateTimeSchema,
    sha256: sha256Schema.optional(),
  })
  .strict() as unknown as z.ZodType<UploadSession>

/** `file_version` row (`16-drive-quota.sql`). */
export const fileVersionSchema = z
  .object({
    fileId: idSchema,
    versionNo: z.number().int().positive(),
    sizeBytes: z.number().int().nonnegative(),
    sha256: sha256Schema,
    storageKey: z.string().min(1).max(1024),
    contentType: z.string().min(1).max(255),
    createdBy: idSchema,
    createdAt: isoDateTimeSchema,
  })
  .strict()

/** `storage_ledger` row (`16-drive-quota.sql`). */
export const storageLedgerEntrySchema = z
  .object({
    entryId: z.string().min(1).max(256),
    driveId: idSchema,
    deltaBytes: z.number().int(),
    reason: z.enum(STORAGE_LEDGER_REASONS),
    fileId: idSchema.optional(),
    versionNo: z.number().int().positive().optional(),
    idempotencyKey: z.string().min(1).max(256),
    createdAt: isoDateTimeSchema,
  })
  .strict()

/** Payload schema per catalogue command this package owns. */
export const DRIVE_CONTRACT_COMMAND_SCHEMAS: CommandSchemaMap = {
  'drive.provision': driveProvisionSchema,
  'drive.open_upload': driveOpenUploadSchema,
  'drive.complete_upload': driveCompleteUploadSchema,
  'drive.abort_upload': driveAbortUploadSchema,
}