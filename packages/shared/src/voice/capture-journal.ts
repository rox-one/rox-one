import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface JournalChunk {
  index: number
  bytes: number
  sha256: string
  sampleRate: number
  channels: number
}

export interface CaptureJournal {
  recordingId: string
  createdAt: number
  sampleRate: number
  channels: number
  mimeType: string
  chunks: JournalChunk[]
  finalized: boolean
  recovered: boolean
}

export function journalDir(root: string, recordingId: string): string {
  return join(root, 'voice', 'recordings', recordingId)
}

export function journalPath(root: string, recordingId: string): string {
  return join(journalDir(root, recordingId), 'journal.json')
}

export function openJournal(root: string, recordingId: string, meta: { sampleRate: number; channels: number; mimeType: string }, now = Date.now()): CaptureJournal {
  mkdirSync(journalDir(root, recordingId), { recursive: true })
  const journal: CaptureJournal = {
    recordingId,
    createdAt: now,
    sampleRate: meta.sampleRate,
    channels: meta.channels,
    mimeType: meta.mimeType,
    chunks: [],
    finalized: false,
    recovered: false,
  }
  persist(root, journal)
  return journal
}

export function appendChunk(root: string, journal: CaptureJournal, bytes: Uint8Array): CaptureJournal {
  const index = journal.chunks.length
  const sha256 = createHash('sha256').update(Buffer.from(bytes)).digest('hex')
  const dest = join(journalDir(root, journal.recordingId), `chunk-${String(index).padStart(6, '0')}.bin`)
  writeFileSync(dest, bytes)
  journal.chunks.push({
    index,
    bytes: bytes.byteLength,
    sha256,
    sampleRate: journal.sampleRate,
    channels: journal.channels,
  })
  persist(root, journal)
  return journal
}

export function finalizeJournal(root: string, journal: CaptureJournal, original: Uint8Array): CaptureJournal {
  const dest = join(journalDir(root, journal.recordingId), 'original.bin')
  writeFileSync(dest, original)
  journal.finalized = true
  persist(root, journal)
  return journal
}

export function recoverJournals(root: string): CaptureJournal[] {
  const recordings = join(root, 'voice', 'recordings')
  if (!existsSync(recordings)) return []
  return readdirSync(recordings).flatMap((id) => {
    const path = journalPath(root, id)
    if (!existsSync(path)) return []
    try {
      const journal = JSON.parse(readFileSync(path, 'utf8')) as CaptureJournal
      if (!journal.finalized) journal.recovered = true
      persist(root, journal)
      return [journal]
    } catch {
      return []
    }
  })
}

function persist(root: string, journal: CaptureJournal): void {
  writeFileSync(journalPath(root, journal.recordingId), `${JSON.stringify(journal, null, 2)}\n`)
}
