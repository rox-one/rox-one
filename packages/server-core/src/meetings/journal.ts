/**
 * Append-only meeting journal with CAS, command dedupe, atomic snapshots,
 * and quarantine of a corrupt tail. Single writer per workspace directory.
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, copyFileSync, openSync, closeSync, unlinkSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { assertWritableSchema } from '@craft-agent/core/meetings'
import type { MeetingCommitCommand, MeetingCommitResult, MeetingJournalEvent, MeetingOutboxEntry } from '@craft-agent/core/meetings'
import { emptyMeeting, type Meeting } from '@craft-agent/core/meetings'

export type JournalSnapshot = {
  schemaVersion: 1
  meeting: Meeting
  commandIds: string[]
  events: MeetingJournalEvent[]
  outbox: MeetingOutboxEntry[]
  checksum: string
}

export type QuarantineRecord = {
  path: string
  reason: string
  preserved: string
}

function checksum(payload: string): string {
  return createHash('sha256').update(payload).digest('hex')
}

function atomicWrite(path: string, body: string): void {
  const tmp = `${path}.tmp-${process.pid}`
  const fd = openSync(tmp, 'w')
  try {
    writeFileSync(fd, body)
  } finally {
    closeSync(fd)
  }
  renameSync(tmp, path)
}

export class MeetingJournal {
  readonly lockPath: string
  private lockHeld = false
  lastQuarantine: QuarantineRecord | null = null

  constructor(readonly rootDir: string) {
    mkdirSync(rootDir, { recursive: true })
    this.lockPath = join(rootDir, 'meetings.lock')
  }

  acquireWriter(): void {
    if (existsSync(this.lockPath)) {
      throw new Error('meeting journal already has a writer')
    }
    writeFileSync(this.lockPath, String(process.pid))
    this.lockHeld = true
  }

  releaseWriter(): void {
    if (this.lockHeld && existsSync(this.lockPath)) unlinkSync(this.lockPath)
    this.lockHeld = false
  }

  meetingDir(meetingId: string): string {
    return join(this.rootDir, 'meetings', meetingId)
  }

  snapshotPath(meetingId: string): string {
    return join(this.meetingDir(meetingId), 'snapshot.json')
  }

  journalPath(meetingId: string): string {
    return join(this.meetingDir(meetingId), 'journal.jsonl')
  }

  quarantineDir(meetingId: string): string {
    return join(this.meetingDir(meetingId), 'quarantine')
  }

  read(meetingId: string): JournalSnapshot {
    const snapPath = this.snapshotPath(meetingId)
    const journalPath = this.journalPath(meetingId)
    if (!existsSync(snapPath) && !existsSync(journalPath)) {
      throw new Error(`meeting ${meetingId} not found`)
    }
    if (!existsSync(journalPath)) {
      return JSON.parse(readFileSync(snapPath, 'utf8')) as JournalSnapshot
    }
    const snapshot = this.emptySnapshot(meetingId)
    const raw = readFileSync(journalPath, 'utf8')
    const lines = raw.split('\n').filter((line) => line.trim().length > 0)
    const good: string[] = []
    for (const line of lines) {
      try {
        const record = JSON.parse(line) as MeetingCommitCommand & { checksum?: string }
        this.applyCommand(snapshot, record, { persist: false })
        good.push(line)
      } catch {
        mkdirSync(this.quarantineDir(meetingId), { recursive: true })
        const dest = join(this.quarantineDir(meetingId), `tail-${Date.now()}.jsonl`)
        copyFileSync(journalPath, dest)
        this.lastQuarantine = { path: dest, reason: 'corrupt-tail', preserved: raw }
        atomicWrite(journalPath, good.length ? `${good.join('\n')}\n` : '')
        break
      }
    }
    return snapshot
  }

  commit(input: MeetingCommitCommand): MeetingCommitResult {
    if (!this.lockHeld) this.acquireWriter()
    mkdirSync(this.meetingDir(input.meetingId), { recursive: true })
    let snapshot: JournalSnapshot
    try {
      snapshot = this.read(input.meetingId)
    } catch {
      snapshot = this.emptySnapshot(input.meetingId)
    }
    if (snapshot.commandIds.includes(input.commandId)) {
      return { revision: snapshot.meeting.revision, duplicate: true }
    }
    if (input.expectedRevision !== snapshot.meeting.revision) {
      throw new Error(`stale CAS expected ${input.expectedRevision} have ${snapshot.meeting.revision}`)
    }
    for (const event of input.events) {
      if (event.type === 'meeting.created') assertWritableSchema(event.meeting)
    }
    this.applyCommand(snapshot, input, { persist: true })
    return { revision: snapshot.meeting.revision, duplicate: false }
  }

  list(): Meeting[] {
    const dir = join(this.rootDir, 'meetings')
    if (!existsSync(dir)) return []
    const items: Meeting[] = []
    for (const meetingId of readdirSync(dir)) {
      try {
        items.push(this.read(meetingId).meeting)
      } catch {
        continue
      }
    }
    return items
  }

  pending(limit: number): MeetingOutboxEntry[] {
    const dir = join(this.rootDir, 'meetings')
    if (!existsSync(dir)) return []
    const out: MeetingOutboxEntry[] = []
    for (const meetingId of readdirSync(dir)) {
      try {
        const snap = this.read(meetingId)
        for (const entry of snap.outbox) {
          out.push(entry)
          if (out.length >= limit) return out
        }
      } catch {
        continue
      }
    }
    return out
  }

  private emptySnapshot(meetingId: string, workspaceId = 'unknown'): JournalSnapshot {
    const meeting = emptyMeeting({ workspaceId, meetingId, now: 0 })
    return { schemaVersion: 1, meeting, commandIds: [], events: [], outbox: [], checksum: '' }
  }

  private applyCommand(snapshot: JournalSnapshot, input: MeetingCommitCommand, opts: { persist: boolean }): void {
    for (const event of input.events) {
      snapshot.events.push(event)
      if (event.type === 'meeting.created') snapshot.meeting = { ...event.meeting }
      if (event.type === 'meeting.status') snapshot.meeting.status = event.status
    }
    snapshot.outbox.push(...input.outboxEntries)
    snapshot.commandIds.push(input.commandId)
    snapshot.meeting.revision += 1
    snapshot.meeting.updatedAt = snapshot.meeting.updatedAt || 0
    const encoded = JSON.stringify({ ...input, checksum: checksum(JSON.stringify(input)) })
    snapshot.checksum = checksum(JSON.stringify({ meeting: snapshot.meeting, commandIds: snapshot.commandIds }))
    if (!opts.persist) return
    const journalPath = this.journalPath(input.meetingId)
    const existing = existsSync(journalPath) ? readFileSync(journalPath, 'utf8') : ''
    atomicWrite(journalPath, `${existing}${encoded}\n`)
    atomicWrite(this.snapshotPath(input.meetingId), JSON.stringify(snapshot, null, 2))
  }
}
