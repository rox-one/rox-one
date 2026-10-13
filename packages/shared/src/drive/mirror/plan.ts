/**
 * ROX Drive (R13 mirror) — incremental diff between a catalog snapshot and the
 * journal. Pure: it neither reads the filesystem nor mutates its inputs.
 *
 * Classification:
 *  - `unchanged` — a journal record with a matching `sha256`; without a hash on
 *    the source entry it degrades to a size comparison (the frozen
 *    `MirrorRecordEntry` records no mtime, so size+mtime is not available).
 *  - `changed`   — record present but the content differs.
 *  - `add`       — no record for the path.
 *  - `tombstones`— journal records absent from the catalog (deleted on disk).
 *
 * Every bucket is sorted by `relativePath`, so a diff over the same inputs is
 * byte-for-byte reproducible.
 */
import type { MirrorJournalRecord, MirrorPlan, MirrorSourceEntry } from './types'

function byRelativePath(a: MirrorSourceEntry, b: MirrorSourceEntry): number {
  if (a.relativePath < b.relativePath) return -1
  if (a.relativePath > b.relativePath) return 1
  return 0
}

function isUnchanged(entry: MirrorSourceEntry, record: { sha256: string; sizeBytes: number }): boolean {
  if (entry.sha256 !== undefined) return record.sha256 === entry.sha256
  // No hash on the scan: the journal has no mtime, so size is the only signal.
  return record.sizeBytes === entry.sizeBytes
}

export function planMirrorDiff(
  entries: readonly MirrorSourceEntry[],
  journal: MirrorJournalRecord,
): MirrorPlan {
  const add: MirrorSourceEntry[] = []
  const changed: MirrorSourceEntry[] = []
  const unchanged: MirrorSourceEntry[] = []
  const present = new Set<string>()

  for (const entry of entries) {
    if (present.has(entry.relativePath)) continue
    present.add(entry.relativePath)
    const record = journal.entries[entry.relativePath]
    if (!record) {
      add.push({ ...entry })
    } else if (isUnchanged(entry, record)) {
      unchanged.push({ ...entry })
    } else {
      changed.push({ ...entry })
    }
  }

  add.sort(byRelativePath)
  changed.sort(byRelativePath)
  unchanged.sort(byRelativePath)
  // A path is a tombstone when the journal knows it (a committed entry or an
  // earlier tombstone) but the catalog no longer has it — i.e. it was deleted.
  const known = new Set<string>([...Object.keys(journal.entries), ...journal.tombstones])
  const tombstones = [...known].filter(path => !present.has(path)).sort()

  return { add, changed, unchanged, tombstones }
}