/**
 * Meeting note persist — durable NativeNote KV next to personal-tasks.
 * NativeNotesEngine stays the in-memory engine; this is the disk seam.
 * Revision is the engine hash, never an invented `'1'`.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { NativeNote } from '@craft-agent/core/rox2'

const NOTE_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/

export type PersistedMeetingNote = {
  note: NativeNote
  revision: string
}

type PersistFile = {
  id: string
  revision: string
  note: NativeNote
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && Array.isArray(value) === false
}

function isNativeNote(value: unknown, id: string): value is NativeNote {
  if (!isPlainRecord(value)) return false
  if (typeof value.noteId !== 'string' || value.noteId !== id) return false
  if (typeof value.entityId !== 'string' || value.entityId !== `note:${id}`) return false
  if (typeof value.markdown !== 'string') return false
  if (typeof value.revision !== 'string' || value.revision.length === 0) return false
  if (typeof value.title !== 'string') return false
  if (!Array.isArray(value.blocks) || !Array.isArray(value.attachments) || !Array.isArray(value.wikilinks)) return false
  if (!isPlainRecord(value.extra)) return false
  if (typeof value.updatedAt !== 'number') return false
  return true
}

function cloneNote(note: NativeNote): NativeNote {
  return JSON.parse(JSON.stringify(note)) as NativeNote
}

export function parseMeetingNotePersistFile(content: string): PersistFile | null {
  try {
    const parsed: unknown = JSON.parse(content)
    if (!isPlainRecord(parsed)) return null
    if (typeof parsed.id !== 'string' || !NOTE_ID_RE.test(parsed.id)) return null
    if (typeof parsed.revision !== 'string' || parsed.revision.length === 0) return null
    if (!isNativeNote(parsed.note, parsed.id) || parsed.note.revision !== parsed.revision) return null
    return { id: parsed.id, revision: parsed.revision, note: parsed.note }
  } catch {
    return null
  }
}

export class MeetingNotePersistStore {
  readonly dir: string

  constructor(rootDir: string) {
    this.dir = join(rootDir, 'meeting-notes')
    this.cleanupOrphanTmp()
  }

  put(note: NativeNote): PersistedMeetingNote {
    if (!NOTE_ID_RE.test(note.noteId)) {
      throw new TypeError(`Invalid meeting-note id (refused for path safety): ${JSON.stringify(note.noteId)}`)
    }
    const stored = cloneNote(note)
    const existing = this.readRecord(note.noteId)
    if (existing && JSON.stringify(existing.note) === JSON.stringify(stored)) {
      return { note: existing.note, revision: existing.revision }
    }
    const record: PersistFile = { id: note.noteId, revision: stored.revision, note: stored }
    this.writeRecord(record)
    return { note: stored, revision: stored.revision }
  }

  get(id: string): PersistedMeetingNote | null {
    const record = this.readRecord(id)
    if (!record) return null
    return { note: record.note, revision: record.revision }
  }

  list(): NativeNote[] {
    return this.readAll().map((record) => record.note)
  }

  private readRecord(id: string): PersistFile | null {
    if (!NOTE_ID_RE.test(id)) return null
    const path = this.recordPath(id)
    if (!existsSync(path)) return null
    return parseMeetingNotePersistFile(readFileSync(path, 'utf8'))
  }

  private readAll(): PersistFile[] {
    let names: string[]
    try {
      names = readdirSync(this.dir).sort()
    } catch {
      return []
    }
    const records: PersistFile[] = []
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      const parsed = parseMeetingNotePersistFile(readFileSync(join(this.dir, name), 'utf8'))
      if (parsed) records.push(parsed)
    }
    return records
  }

  private writeRecord(record: PersistFile): void {
    mkdirSync(this.dir, { recursive: true })
    const tmp = join(this.dir, `.${Date.now()}-${process.pid}.${record.id}.tmp`)
    writeFileSync(tmp, `${JSON.stringify(record)}\n`)
    renameSync(tmp, this.recordPath(record.id))
  }

  private recordPath(id: string): string {
    return join(this.dir, `${id}.json`)
  }

  private cleanupOrphanTmp(): void {
    try {
      if (!existsSync(this.dir)) return
      for (const entry of readdirSync(this.dir)) {
        if (!entry.endsWith('.tmp')) continue
        try { unlinkSync(join(this.dir, entry)) } catch { /* best effort */ }
      }
    } catch { /* best effort */ }
  }
}
