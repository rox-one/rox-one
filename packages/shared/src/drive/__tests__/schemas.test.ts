/**
 * W1-14 (#1511) — Zod round-trips for the personal Drive payloads (§16).
 */

import { describe, expect, test } from 'bun:test'
import { TIB_BYTES } from '@rox/core/drive'
import { DRIVE_CONTRACT_COMMAND_SCHEMAS, driveAbortUploadSchema, driveCompleteUploadSchema, driveOpenUploadSchema, driveProvisionSchema, fileVersionSchema, storageLedgerEntrySchema, uploadSessionSchema } from '../schemas'

const sha = 'ab'.repeat(32)

describe('drive payload schemas', () => {
  test('drive.provision defaults to the workspace quota and accepts an override', () => {
    expect(driveProvisionSchema.parse({})).toEqual({})
    expect(driveProvisionSchema.parse({ quotaBytes: TIB_BYTES, rootFolderName: 'Мой диск', backfill: true })).toEqual({ quotaBytes: TIB_BYTES, rootFolderName: 'Мой диск', backfill: true })
    expect(driveProvisionSchema.safeParse({ quotaBytes: 0 }).success).toBe(false)
    expect(driveProvisionSchema.safeParse({ quotaBytes: 1024 ** 4 + 1 }).success).toBe(false)
  })

  test('drive.open_upload takes the name, the size and an optional known hash', () => {
    const parsed = driveOpenUploadSchema.parse({ fileName: 'a.bin', sizeExpected: 5, folderId: 'f1', contentType: 'application/pdf', sha256: sha })
    expect(parsed).toMatchObject({ fileName: 'a.bin', sizeExpected: 5, sha256: sha })
    expect(driveOpenUploadSchema.safeParse({ fileName: 'a.bin', sizeExpected: -1 }).success).toBe(false)
    expect(driveOpenUploadSchema.safeParse({ fileName: 'a.bin', sizeExpected: 1, sha256: 'zz' }).success).toBe(false)
    expect(driveOpenUploadSchema.safeParse({ name: 'a.bin', size: 1 }).success).toBe(false)
  })

  test('drive.complete_upload verifies the hash and the parts', () => {
    expect(driveCompleteUploadSchema.parse({ uploadSessionId: 'u1', sha256: sha })).toEqual({ uploadSessionId: 'u1', sha256: sha })
    expect(driveCompleteUploadSchema.parse({ uploadSessionId: 'u1', sha256: sha, parts: [{ partNumber: 1, etag: 'e1' }] }).parts).toHaveLength(1)
    expect(driveCompleteUploadSchema.safeParse({ uploadSessionId: 'u1', sha256: 'nope' }).success).toBe(false)
    expect(driveCompleteUploadSchema.safeParse({ uploadSessionId: 'u1', sha256: sha, parts: [{ partNumber: 0, etag: 'e' }] }).success).toBe(false)
  })

  test('drive.abort_upload names its session and nothing else', () => {
    expect(driveAbortUploadSchema.parse({ uploadSessionId: 'u1' })).toEqual({ uploadSessionId: 'u1' })
    expect(driveAbortUploadSchema.safeParse({}).success).toBe(false)
    expect(driveAbortUploadSchema.safeParse({ uploadSessionId: 'u1', reason: 'x' }).success).toBe(false)
  })

  test('the command map covers the four quota-bearing commands', () => {
    expect(Object.keys(DRIVE_CONTRACT_COMMAND_SCHEMAS).sort()).toEqual(['drive.abort_upload', 'drive.complete_upload', 'drive.open_upload', 'drive.provision'])
  })
})

describe('drive stored shapes', () => {
  test('an upload session round-trips, including its parts', () => {
    const session = uploadSessionSchema.parse({
      uploadSessionId: 'u1', driveId: 'p1', folderId: 'f1', fileName: 'a.bin', sizeExpected: 10, contentType: 'application/pdf',
      parts: [{ partNumber: 1, etag: 'e1', sizeBytes: 10 }], reservedBytes: 10, status: 'open', idempotencyKey: 'u1',
      expiresAt: '2026-10-09T12:00:00Z', createdAt: '2026-10-08T12:00:00Z',
    })
    expect(session.parts).toHaveLength(1)
    expect(uploadSessionSchema.safeParse({ ...session, status: 'done' }).success).toBe(false)
    expect(uploadSessionSchema.safeParse({ ...session, reservedBytes: -1 }).success).toBe(false)
  })

  test('a file version carries the content-addressed key', () => {
    const version = fileVersionSchema.parse({ fileId: 'f1', versionNo: 2, sizeBytes: 10, sha256: sha, storageKey: `blobs/sha256/ab/ab/${sha}`, contentType: 'application/pdf', createdBy: 'p1', createdAt: '2026-10-08T12:00:00Z' })
    expect(version.versionNo).toBe(2)
    expect(fileVersionSchema.safeParse({ ...version, versionNo: 0 }).success).toBe(false)
  })

  test('a ledger entry uses a reason from the DDL and a unique key', () => {
    const entry = storageLedgerEntrySchema.parse({ entryId: 'e1', driveId: 'p1', deltaBytes: 10, reason: 'upload', fileId: 'f1', versionNo: 1, idempotencyKey: 'upload:u1', createdAt: '2026-10-08T12:00:00Z' })
    expect(entry.reason).toBe('upload')
    expect(storageLedgerEntrySchema.safeParse({ ...entry, reason: 'maybe' }).success).toBe(false)
    expect(storageLedgerEntrySchema.safeParse({ ...entry, deltaBytes: 1.5 }).success).toBe(false)
  })
})