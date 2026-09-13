/**
 * Meeting journal backup + count/hash/readback (issue #357).
 * Legacy `{ ok, state: 'live' }` stays unknown verification.
 */

import { createHash } from 'node:crypto'
import { decodeRox2V2Result, type Rox2V2Result } from '@craft-agent/core/rox2'
import type { MeetingJournalSnapshot } from './journal.ts'

export type MeetingMigrationReport = {
  backupHash: string
  count: number
  readback: Rox2V2Result
}

export function hashSnapshot(snapshot: MeetingJournalSnapshot): string {
  return createHash('sha256').update(JSON.stringify(snapshot), 'utf8').digest('hex')
}

export function migrateLegacyLiveResult(raw: unknown): MeetingMigrationReport {
  const readback = decodeRox2V2Result(raw)
  return {
    backupHash: createHash('sha256').update(JSON.stringify(raw), 'utf8').digest('hex'),
    count: 1,
    readback,
  }
}

export function migrateJournalSnapshot(snapshot: MeetingJournalSnapshot): MeetingMigrationReport {
  return {
    backupHash: hashSnapshot(snapshot),
    count: snapshot.events.length,
    readback: decodeRox2V2Result({
      ok: true,
      mode: 'live',
      lifecycle: 'applied',
      verification: 'unknown',
      entityId: 'journal-readback',
    }),
  }
}
