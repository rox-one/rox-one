/**
 * Meeting journal migrations: backup, count, hash, readback.
 * Unknown schema versions are blocked; source files are never deleted.
 */

import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { MEETING_SCHEMA_VERSION, parseMeeting } from '@craft-agent/core/meetings'
import { MeetingJournal } from './journal.ts'

export type MigrationReport = {
  backupDir: string
  meetingCount: number
  hash: string
  readbackOk: boolean
  blocked: string[]
}

export function migrateMeetingJournal(journal: MeetingJournal, now = Date.now()): MigrationReport {
  const backupDir = join(journal.rootDir, 'backups', `meetings-${now}`)
  mkdirSync(backupDir, { recursive: true })
  const meetingsDir = join(journal.rootDir, 'meetings')
  const blocked: string[] = []
  const hashes: string[] = []
  let meetingCount = 0
  if (existsSync(meetingsDir)) {
    for (const meetingId of readdirSync(meetingsDir)) {
      const snap = join(meetingsDir, meetingId, 'snapshot.json')
      if (!existsSync(snap)) continue
      const destDir = join(backupDir, meetingId)
      mkdirSync(destDir, { recursive: true })
      copyFileSync(snap, join(destDir, 'snapshot.json'))
      const body = readFileSync(snap, 'utf8')
      hashes.push(createHash('sha256').update(body).digest('hex'))
      meetingCount += 1
      const parsed = parseMeeting(JSON.parse(body).meeting)
      if ('status' in parsed && parsed.status === 'blocked') blocked.push(meetingId)
      if ('status' in parsed && parsed.status === 'invalid') blocked.push(meetingId)
    }
  }
  const hash = createHash('sha256').update(hashes.sort().join('|')).digest('hex')
  let readbackOk = true
  try {
    if (meetingCount > 0) {
      const first = readdirSync(meetingsDir)[0]
      if (first) journal.read(first)
    }
  } catch {
    readbackOk = false
  }
  return { backupDir, meetingCount, hash, readbackOk, blocked }
}

export function supportedMeetingSchema(): number {
  return MEETING_SCHEMA_VERSION
}
