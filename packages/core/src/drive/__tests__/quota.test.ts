/**
 * W1-14 (#1511) — Drive quota arithmetic (TECH-SPEC §16.3, D-v2-8).
 *
 * The numbers of the decision: 1 TiB = 1 099 511 627 776 bytes shown as
 * «1 ТБ», versions and trash counted, chat attachments charged to the
 * uploader, and admission `used + reserved + size ≤ quota` — including the
 * boundary at exactly 1 TiB.
 */

import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_DRIVE_QUOTA_BYTES, MIB_BYTES, TIB_BYTES, abortUpload, admitUpload, applyLedgerEntry, canCompleteUpload, chargePrincipal,
  creditReservation, crossedQuotaThresholds, driveStateFor, expireUploadSessions, fileSourceRef, formatDriveSize, isInstantUpload,
  ledgerDeltaBytes, openUploadSession, planUploadParts, quotaExceededError, quotaSnapshot, quotaWarningAllowed, reservedBytesOf,
  uploadedBytes, usedBytesFromLedger,
} from '../index'
import type { UploadSession } from '../index'

const NOW = '2026-10-08T12:00:00.000Z'
const drive = { quotaBytes: TIB_BYTES, usedBytes: 0, reservedBytes: 0, trashBytes: 0, state: 'active' as const }

describe('quota constants and formatting (D-v2-8)', () => {
  test('the default quota is 1 TiB and is shown as «1 ТБ» in Russian', () => {
    expect(TIB_BYTES).toBe(1_099_511_627_776)
    expect(DEFAULT_DRIVE_QUOTA_BYTES).toBe(TIB_BYTES)
    expect(formatDriveSize(TIB_BYTES, 'ru')).toBe('1 ТБ')
    expect(formatDriveSize(TIB_BYTES, 'en')).toBe('1 TB')
    expect(formatDriveSize(512 * MIB_BYTES, 'ru')).toBe('512 МБ')
    expect(formatDriveSize(TIB_BYTES, 'fr')).toBe('1 To')
    expect(formatDriveSize(1024, 'ru')).toBe('1 КБ')
    expect(formatDriveSize(7, 'ru')).toBe('7 Б')
  })

  test('the usage snapshot reports free space and the meter severity', () => {
    const usage = quotaSnapshot({ ...drive, usedBytes: TIB_BYTES / 2, reservedBytes: TIB_BYTES / 4 })
    expect(usage.free).toBe(TIB_BYTES / 4)
    expect(usage.percent).toBe(75)
    expect(usage.severity).toBe('ok')
    expect(quotaSnapshot({ ...drive, usedBytes: TIB_BYTES * 0.8, reservedBytes: 0 }).severity).toBe('warning')
    expect(quotaSnapshot({ ...drive, usedBytes: TIB_BYTES, reservedBytes: 0 }).severity).toBe('critical')
  })

  test('notification thresholds fire at 80 / 90 / 100 and cooldown for 7 days', () => {
    expect(crossedQuotaThresholds(79.9)).toEqual([])
    expect(crossedQuotaThresholds(80)).toEqual([80])
    expect(crossedQuotaThresholds(100)).toEqual([80, 90, 100])
    expect(quotaWarningAllowed(null, 0)).toBe(true)
    expect(quotaWarningAllowed(0, 6 * 24 * 3600 * 1000)).toBe(false)
    expect(quotaWarningAllowed(0, 7 * 24 * 3600 * 1000)).toBe(true)
  })
})

describe('upload admission (§16.3)', () => {
  test('admission is used + reserved + size ≤ quota, exactly at the boundary', () => {
    const nearlyFull = { ...drive, usedBytes: TIB_BYTES - 1024, reservedBytes: 0 }
    expect(admitUpload(nearlyFull, 1024)).toEqual({ ok: true, reservedBytes: 1024 })
    const rejected = admitUpload(nearlyFull, 1025)
    expect(rejected.ok).toBe(false)
    if (rejected.ok) throw new Error('unreachable')
    expect(rejected.error).toBe('QUOTA_EXCEEDED')
    expect(rejected.detail).toEqual({ used: TIB_BYTES - 1024, limit: TIB_BYTES, needed: 1025, free: 1024 })
    expect(quotaExceededError(rejected.detail)).toMatchObject({ code: 'QUOTA_EXCEEDED', detail: { needed: 1025 } })
  })

  test('an existing reservation is never double-counted into free space', () => {
    const tiny = { ...drive, quotaBytes: 10_000, usedBytes: 1000, reservedBytes: 4000 }
    // 1000 used + 4000 reserved + 5000 = the quota: admitted exactly.
    expect(admitUpload(tiny, 5000)).toEqual({ ok: true, reservedBytes: 9000 })
    const tooBig = admitUpload(tiny, 5001)
    expect(tooBig.ok).toBe(false)
    if (tooBig.ok) throw new Error('unreachable')
    expect(tooBig.detail).toEqual({ used: 1000, limit: 10_000, needed: 5001, free: 5000 })
  })

  test('over_quota and frozen drives reject new uploads but the snapshot stays readable', () => {
    for (const state of ['over_quota', 'frozen'] as const) {
      const rejected = admitUpload({ ...drive, usedBytes: TIB_BYTES + 1, state }, 1)
      expect(rejected.ok).toBe(false)
      expect(quotaSnapshot({ ...drive, usedBytes: TIB_BYTES + 1, reservedBytes: 0, trashBytes: 0, state }).state).toBe(state)
    }
  })

  test('a negative or non-finite size is rejected, a zero-byte upload is admitted', () => {
    expect(admitUpload(drive, -1).ok).toBe(false)
    expect(admitUpload(drive, Number.POSITIVE_INFINITY).ok).toBe(false)
    expect(admitUpload(drive, 0)).toEqual({ ok: true, reservedBytes: 0 })
    expect(creditReservation(10, 25)).toBe(0)
    expect(creditReservation(25, 10)).toBe(15)
    expect(driveStateFor(TIB_BYTES + 1, TIB_BYTES, 'active')).toBe('over_quota')
    expect(driveStateFor(0, TIB_BYTES, 'frozen')).toBe('frozen')
  })
})

describe('storage ledger (§5.15 quota rules)', () => {
  test('reasons charge, release or stay informational', () => {
    expect(ledgerDeltaBytes('upload', 100)).toBe(100)
    expect(ledgerDeltaBytes('version', 100)).toBe(100)
    expect(ledgerDeltaBytes('trash', 100)).toBe(0)
    expect(ledgerDeltaBytes('restore', 100)).toBe(0)
    expect(ledgerDeltaBytes('purge', 100)).toBe(-100)
    expect(ledgerDeltaBytes('transfer_out', 100)).toBe(-100)
    expect(ledgerDeltaBytes('adjust', 100, -42)).toBe(-42)
    expect(usedBytesFromLedger([{ deltaBytes: 100 }, { deltaBytes: -30 }, { deltaBytes: 0 }])).toBe(70)
  })

  test('trash moves bytes into trash_bytes without touching used_bytes; purge debits both', () => {
    const afterUpload = applyLedgerEntry({ usedBytes: 0, reservedBytes: 0, trashBytes: 0 }, 'upload', 100)
    expect(afterUpload).toEqual({ usedBytes: 100, reservedBytes: 0, trashBytes: 0 })
    const trashed = applyLedgerEntry(afterUpload, 'trash', 100)
    expect(trashed).toEqual({ usedBytes: 100, reservedBytes: 0, trashBytes: 100 })
    const purged = applyLedgerEntry(trashed, 'purge', 100)
    expect(purged).toEqual({ usedBytes: 0, reservedBytes: 0, trashBytes: 0 })
    // A purge of something already purged never credits.
    expect(applyLedgerEntry(purged, 'purge', 100).usedBytes).toBe(0)
  })

  test('D-v2-8: the uploader pays for a chat attachment, the organiser for a recording', () => {
    expect(chargePrincipal('upload', { driveOwnerId: 'owner', actorId: 'uploader', sourceRef: 'channel-message:c1#4' })).toBe('uploader')
    expect(chargePrincipal('recording', { driveOwnerId: 'owner', actorId: 'uploader', organiserId: 'host' })).toBe('host')
    expect(chargePrincipal('artifact', { driveOwnerId: 'owner', actorId: 'uploader', agentOwnerId: 'agent-owner' })).toBe('agent-owner')
    // A shared file counts only against its owner.
    expect(chargePrincipal('version', { driveOwnerId: 'owner', actorId: 'someone-else' })).toBe('owner')
    expect(fileSourceRef({ kind: 'channel-message', chatId: 'c1', seq: 4 })).toBe('channel-message:c1#4')
    expect(fileSourceRef({ kind: 'session', sessionRef: 's1' })).toBe('session:s1')
  })
})

describe('upload protocol (§16.2)', () => {
  const sessionOf = (overrides: Partial<UploadSession> = {}): UploadSession => ({
    ...openUploadSession({ uploadSessionId: 'u1', driveId: 'd1', fileName: 'a.bin', sizeExpected: 10 * MIB_BYTES, idempotencyKey: 'u1', now: NOW }),
    ...overrides,
  })

  test('a session reserves its full size and expires after 24 h', () => {
    const session = sessionOf()
    expect(session.reservedBytes).toBe(10 * MIB_BYTES)
    expect(session.status).toBe('open')
    expect(Date.parse(session.expiresAt) - Date.parse(NOW)).toBe(24 * 60 * 60 * 1000)
    expect(reservedBytesOf([session, sessionOf({ status: 'completed', reservedBytes: 0 })])).toBe(10 * MIB_BYTES)
  })

  test('an expired session can never complete, and expiry releases the reservation', () => {
    const session = sessionOf()
    expect(canCompleteUpload(session, NOW).ok).toBe(true)
    const after = new Date(Date.parse(NOW) + 24 * 60 * 60 * 1000 + 1).toISOString()
    expect(canCompleteUpload(session, after)).toEqual({ ok: false, reason: 'expired' })
    const releases = expireUploadSessions([session, sessionOf({ uploadSessionId: 'u2', status: 'completed', reservedBytes: 0 })], after)
    expect(releases).toHaveLength(1)
    expect(releases[0]!.releasedBytes).toBe(10 * MIB_BYTES)
    expect(releases[0]!.session.status).toBe('expired')
    expect(canCompleteUpload({ status: 'aborted', expiresAt: session.expiresAt }, NOW)).toEqual({ ok: false, reason: 'aborted' })
    expect(canCompleteUpload({ status: 'completed', expiresAt: session.expiresAt }, NOW)).toEqual({ ok: false, reason: 'already_completed' })
  })

  test('abort hands the reservation back and keeps the parts for forensics', () => {
    const session = sessionOf({ parts: [{ partNumber: 1, etag: 'e1' }] })
    const release = abortUpload(session, NOW)
    expect(release.releasedBytes).toBe(10 * MIB_BYTES)
    expect(release.session.status).toBe('aborted')
    expect(release.session.reservedBytes).toBe(0)
    expect(release.session.parts).toEqual([{ partNumber: 1, etag: 'e1' }])
  })

  test('an instant upload needs a known blob; the ledger is charged anyway', () => {
    expect(isInstantUpload(undefined, () => true)).toBe(false)
    expect(isInstantUpload('a'.repeat(64), () => false)).toBe(false)
    expect(isInstantUpload('a'.repeat(64), hash => hash === 'a'.repeat(64))).toBe(true)
  })

  test('the multipart plan stays inside 8–64 MB parts and the S3 part ceiling', () => {
    expect(planUploadParts(0)).toEqual({ partSizeBytes: 0, partCount: 1 })
    expect(planUploadParts(1024)).toEqual({ partSizeBytes: 1024, partCount: 1 })
    expect(planUploadParts(8 * MIB_BYTES).partCount).toBe(1)
    const large = planUploadParts(200 * 1024 * MIB_BYTES)
    expect(large.partSizeBytes).toBeGreaterThanOrEqual(8 * MIB_BYTES)
    expect(large.partSizeBytes).toBeLessThanOrEqual(64 * MIB_BYTES)
    expect(large.partCount).toBeLessThanOrEqual(10_000)
    expect(uploadedBytes({ sizeExpected: 10, parts: [{ partNumber: 1, etag: 'a' }, { partNumber: 2, etag: 'b' }] }, { '1': 6, '2': 4 })).toBe(10)
  })
})