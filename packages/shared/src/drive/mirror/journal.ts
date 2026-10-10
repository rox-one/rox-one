/**
 * ROX Drive (R13 mirror) — durable, atomically-rewritten mirror journal.
 *
 * State lives at `<stateDir>/<mirrorId>.json` as a `MirrorJournalRecord`. Every
 * mutation rewrites the whole record through a same-directory temp file +
 * rename, so a crash never leaves a half-written journal. A corrupt or
 * wrong-version file is treated as an empty journal (one warning, no throw):
 * losing the journal costs a re-upload, never a crash loop.
 *
 * The journal carries file paths and hashes only — never file bytes or
 * secrets, so a warning line is safe to log.
 */
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  MirrorJournal,
  MirrorJournalOptions,
  MirrorJournalRecord,
  MirrorRecordEntry,
} from './types'

/** On-disk schema marker; a mismatch resets to an empty journal. */
export const MIRROR_JOURNAL_STATE_VERSION = 1

/** Mirror ids become file names, so anything path-like is rejected up front. */
const SAFE_MIRROR_ID = /^[A-Za-z0-9_-]+$/

function emptyRecord(): MirrorJournalRecord {
  return { version: MIRROR_JOURNAL_STATE_VERSION, entries: {}, tombstones: [] }
}

function cloneRecord(record: MirrorJournalRecord): MirrorJournalRecord {
  const entries: Record<string, MirrorRecordEntry> = {}
  for (const [path, entry] of Object.entries(record.entries)) {
    entries[path] = { sha256: entry.sha256, sizeBytes: entry.sizeBytes, committedAtMs: entry.committedAtMs }
  }
  return { version: record.version, entries, tombstones: [...record.tombstones] }
}

/** Parse a journal file; any structural problem degrades to an empty journal. */
function parseRecord(raw: string, file: string): MirrorJournalRecord {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    console.warn(`[drive-mirror] journal is not valid JSON, starting empty: ${file}`)
    return emptyRecord()
  }
  const record = parsed as Partial<MirrorJournalRecord> | null
  if (
    !record
    || record.version !== MIRROR_JOURNAL_STATE_VERSION
    || typeof record.entries !== 'object'
    || record.entries === null
    || !Array.isArray(record.tombstones)
  ) {
    console.warn(`[drive-mirror] journal has an unsupported shape, starting empty: ${file}`)
    return emptyRecord()
  }
  const entries: Record<string, MirrorRecordEntry> = {}
  for (const [path, value] of Object.entries(record.entries)) {
    const entry = value as Partial<MirrorRecordEntry> | undefined
    if (
      !entry
      || typeof entry.sha256 !== 'string'
      || typeof entry.sizeBytes !== 'number'
      || typeof entry.committedAtMs !== 'number'
    ) {
      continue
    }
    entries[path] = { sha256: entry.sha256, sizeBytes: entry.sizeBytes, committedAtMs: entry.committedAtMs }
  }
  return {
    version: MIRROR_JOURNAL_STATE_VERSION,
    entries,
    tombstones: record.tombstones.filter((path): path is string => typeof path === 'string'),
  }
}

export function createMirrorJournal(options: MirrorJournalOptions): MirrorJournal {
  const { stateDir, mirrorId } = options
  if (!SAFE_MIRROR_ID.test(mirrorId)) {
    throw new Error(`Unsafe mirror id: ${JSON.stringify(mirrorId)}`)
  }
  const now = options.now ?? Date.now
  const file = join(stateDir, `${mirrorId}.json`)
  const tmp = join(stateDir, `.${mirrorId}.json.tmp`)

  let cache: MirrorJournalRecord | null = null
  // Serialize all writes: two concurrent commits must not interleave temp/rename.
  let chain: Promise<void> = Promise.resolve()

  function readFromDisk(): MirrorJournalRecord {
    if (!existsSync(file)) return emptyRecord()
    try {
      return parseRecord(readFileSync(file, 'utf8'), file)
    } catch (error) {
      console.warn(`[drive-mirror] journal is unreadable, starting empty: ${file}: ${String(error)}`)
      return emptyRecord()
    }
  }

  function current(): MirrorJournalRecord {
    if (!cache) cache = readFromDisk()
    return cache
  }

  async function write(record: MirrorJournalRecord): Promise<void> {
    await mkdir(stateDir, { recursive: true })
    await writeFile(tmp, JSON.stringify(record), { encoding: 'utf8', mode: 0o600 })
    await rename(tmp, file)
  }

  function mutate(mutator: (record: MirrorJournalRecord) => void): Promise<void> {
    const next = chain.then(async () => {
      const record = current()
      mutator(record)
      await write(record)
    })
    // Keep the chain alive even if this write fails; callers still see the rejection.
    chain = next.catch(() => {})
    return next
  }

  return {
    async load(): Promise<MirrorJournalRecord> {
      return cloneRecord(current())
    },

    commit(entry): Promise<void> {
      return mutate(record => {
        record.entries[entry.relativePath] = {
          sha256: entry.sha256,
          sizeBytes: entry.sizeBytes,
          committedAtMs: now(),
        }
        // A path that reappears is live again: drop it from the tombstone set.
        if (record.tombstones.includes(entry.relativePath)) {
          record.tombstones = record.tombstones.filter(path => path !== entry.relativePath)
        }
      })
    },

    addTombstones(paths): Promise<void> {
      return mutate(record => {
        for (const path of paths) {
          delete record.entries[path]
          if (!record.tombstones.includes(path)) record.tombstones.push(path)
        }
      })
    },
  }
}