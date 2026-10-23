/**
 * Note version history for Docs/Notes.
 *
 * Primary source: durable MarkdownCommitStore journals under
 * `.rox-docs/commits/` (written by saveNote / content.commit). Each committed
 * journal already carries content, author, time and byte size — we list and
 * read those, never mutate them.
 *
 * Secondary source: notes-root `.rox/revisions/<note>.json` snapshots recorded on native
 * journal saves that do not write a MarkdownCommitStore journal, so history
 * stays available on both save paths. Snapshots are append-only; restore
 * creates a NEW save (new journal / snapshot), never rewrites an old one.
 * Identical-byte restores keep the original snapshot and append a distinct
 * tip event keyed by operationId.
 */

import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rename, writeFile, lstat } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'

export type NoteHistoryEntry = {
  revisionId: string
  operationId: string
  previousRevision: string | null
  committedAt: string
  actorPrincipalId: string | null
  byteSize: number
}

export type NoteHistoryRevision = NoteHistoryEntry & {
  content: string
}

type SidecarRevision = NoteHistoryRevision & { schemaVersion: 1 }
type SidecarFile = { schemaVersion: 1; noteId: string; revisions: SidecarRevision[] }

const REVISIONS_DIR = 'revisions'
const COMMITS_ROOT = join('.rox-docs', 'commits')

const digest = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex')
const isMissing = (error: unknown): boolean => (error as NodeJS.ErrnoException)?.code === 'ENOENT'

function encodeNoteFileName(noteId: string): string {
  return Buffer.from(noteId, 'utf8').toString('base64url')
}

function sidecarPath(notesRoot: string, noteId: string): string {
  // Workspace-relative meta dir (same pattern as entity-links / contacts stores).
  const dir = join(notesRoot, '.rox', REVISIONS_DIR)
  return join(dir, `${encodeNoteFileName(noteId)}.json`)
}

async function assertSafeMetaPath(notesRoot: string, candidate: string): Promise<void> {
  const root = resolve(notesRoot)
  const path = resolve(candidate)
  if (!path.startsWith(root + sep) && path !== root) throw new Error('Invalid note revision path')
  let cursor = root
  for (const segment of relative(root, path).split(sep).filter(Boolean)) {
    cursor = join(cursor, segment)
    try {
      const info = await lstat(cursor)
      if (info.isSymbolicLink()) throw new Error('Invalid note revision path')
    } catch (error) {
      if (isMissing(error)) return
      throw error
    }
  }
}

function byteSizeOf(content: string): number {
  return Buffer.byteLength(content, 'utf8')
}

function assertSafeNoteId(noteId: string): void {
  if (!noteId || noteId.includes('\0') || noteId.includes('\\')
    || noteId.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('Invalid note ID')
  }
}

async function readSidecar(notesRoot: string, noteId: string): Promise<SidecarFile | null> {
  const path = sidecarPath(notesRoot, noteId)
  try {
    await assertSafeMetaPath(notesRoot, path)
    const raw = JSON.parse(await readFile(path, 'utf8')) as SidecarFile
    if (raw?.schemaVersion !== 1 || raw.noteId !== noteId || !Array.isArray(raw.revisions)) return null
    return raw
  } catch (error) {
    if (isMissing(error)) return null
    throw error
  }
}

async function writeSidecarAtomic(notesRoot: string, file: SidecarFile): Promise<void> {
  const path = sidecarPath(notesRoot, file.noteId)
  await mkdir(join(notesRoot, '.rox', REVISIONS_DIR), { recursive: true })
  await assertSafeMetaPath(notesRoot, path)
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tmp, `${JSON.stringify(file, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  await rename(tmp, path)
}

/** Serialize sidecar RMW per noteId so concurrent restores/saves cannot clobber peers. */
const sidecarLocks = new Map<string, Promise<unknown>>()

async function withSidecarLock<T>(noteId: string, fn: () => Promise<T>): Promise<T> {
  const previous = sidecarLocks.get(noteId) ?? Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const tail = previous.then(() => gate, () => gate)
  sidecarLocks.set(noteId, tail)
  await previous.then(() => undefined, () => undefined)
  try {
    return await fn()
  } finally {
    release()
    if (sidecarLocks.get(noteId) === tail) sidecarLocks.delete(noteId)
  }
}

/**
 * Record a durable history snapshot after a successful save.
 * Append-only by operationId: identical-byte restores keep the original
 * snapshot metadata and add a distinct tip event.
 */
export async function recordNoteRevision(
  notesRoot: string,
  input: {
    noteId: string
    content: string
    revisionId: string
    operationId: string
    previousRevision?: string | null
    committedAt?: string
    actorPrincipalId?: string | null
  },
): Promise<NoteHistoryEntry> {
  assertSafeNoteId(input.noteId)
  if (!input.revisionId || !input.operationId) throw new Error('revisionId and operationId are required')
  return withSidecarLock(input.noteId, async () => {
    const entry: SidecarRevision = {
      schemaVersion: 1,
      revisionId: input.revisionId,
      operationId: input.operationId,
      previousRevision: input.previousRevision ?? null,
      committedAt: input.committedAt ?? new Date().toISOString(),
      actorPrincipalId: input.actorPrincipalId ?? null,
      byteSize: byteSizeOf(input.content),
      content: input.content,
    }
    const existing = await readSidecar(notesRoot, input.noteId)
    // Idempotent only for the same operationId; never overwrite another tip event.
    const revisions = existing?.revisions.filter(item => item.operationId !== entry.operationId) ?? []
    revisions.push(entry)
    const MAX = 200
    const kept = revisions.length > MAX ? revisions.slice(revisions.length - MAX) : revisions
    await writeSidecarAtomic(notesRoot, { schemaVersion: 1, noteId: input.noteId, revisions: kept })
    const { content: _c, schemaVersion: _s, ...summary } = entry
    return summary
  })
}

type JournalLike = {
  phase: string
  command?: { noteId?: string; content?: string; operationId?: string; expectedRevision?: string }
  receipt?: {
    revision?: string
    previousRevision?: string
    committedAt?: string
    actorPrincipalId?: string
    operationId?: string
    noteId?: string
  }
}

function journalToRevision(value: JournalLike, noteId: string): NoteHistoryRevision | null {
  if (value.phase !== 'committed') return null
  const content = value.command?.content
  const revisionId = value.receipt?.revision
  const operationId = value.receipt?.operationId ?? value.command?.operationId
  const committedAt = value.receipt?.committedAt
  if (typeof content !== 'string' || typeof revisionId !== 'string' || typeof operationId !== 'string' || typeof committedAt !== 'string') return null
  if (value.receipt?.noteId && value.receipt.noteId !== noteId) return null
  if (value.command?.noteId && value.command.noteId !== noteId) return null
  return {
    revisionId,
    operationId,
    previousRevision: typeof value.receipt?.previousRevision === 'string' ? value.receipt.previousRevision : null,
    committedAt,
    actorPrincipalId: typeof value.receipt?.actorPrincipalId === 'string' ? value.receipt.actorPrincipalId : null,
    byteSize: byteSizeOf(content),
    content,
  }
}

async function listCommittedJournals(notesRoot: string, workspaceId: string, noteId: string): Promise<NoteHistoryRevision[]> {
  const directory = join(notesRoot, COMMITS_ROOT, digest(`${workspaceId}\0${noteId}`))
  let names: string[]
  try {
    names = await readdir(directory)
  } catch (error) {
    if (isMissing(error)) return []
    throw error
  }
  const out: NoteHistoryRevision[] = []
  for (const name of names) {
    if (!/^[a-f0-9]{64}\.json$/.test(name)) continue
    try {
      const value = JSON.parse(await readFile(join(directory, name), 'utf8')) as JournalLike
      const entry = journalToRevision(value, noteId)
      if (entry) out.push(entry)
    } catch {
      // Corrupt journal: skip.
    }
  }
  return out
}

async function findInCommittedJournals(
  notesRoot: string,
  workspaceId: string,
  noteId: string,
  revisionId: string,
): Promise<NoteHistoryRevision | null> {
  const directory = join(notesRoot, COMMITS_ROOT, digest(`${workspaceId}\0${noteId}`))
  let names: string[]
  try {
    names = await readdir(directory)
  } catch (error) {
    if (isMissing(error)) return null
    throw error
  }
  for (const name of names) {
    if (!/^[a-f0-9]{64}\.json$/.test(name)) continue
    try {
      const value = JSON.parse(await readFile(join(directory, name), 'utf8')) as JournalLike
      const entry = journalToRevision(value, noteId)
      if (entry?.revisionId === revisionId) return entry
    } catch {
      // skip corrupt
    }
  }
  return null
}

type NativeJournalFile = {
  phase?: string
  command?: { changes?: Array<{ kind?: string; noteId?: string; content?: string; expectedRevision?: string | null }> }
  receipt?: { operationId?: string; committedAt?: string; actorPrincipalId?: string }
}

/** Scan workspace-wide native journals for one noteId. Early-filters by noteId string before JSON.parse. */
async function collectNativeWriteJournals(
  notesRoot: string,
  workspaceId: string,
  noteId: string,
  revisionId?: string,
): Promise<NoteHistoryRevision[]> {
  const directory = join(notesRoot, COMMITS_ROOT, digest(`native\0${workspaceId}`))
  let names: string[]
  try {
    names = await readdir(directory)
  } catch (error) {
    if (isMissing(error)) return []
    throw error
  }
  const out: NoteHistoryRevision[] = []
  // noteId appears as a JSON string in command.changes[].noteId — reject files that cannot match.
  const noteNeedle = JSON.stringify(noteId)
  for (const name of names) {
    if (!/^native-[a-f0-9]{64}\.json$/.test(name)) continue
    try {
      const raw = await readFile(join(directory, name), 'utf8')
      if (!raw.includes(noteNeedle)) continue
      const value = JSON.parse(raw) as NativeJournalFile
      if (value.phase !== 'committed' || !Array.isArray(value.command?.changes)) continue
      const operationId = value.receipt?.operationId
      const committedAt = value.receipt?.committedAt
      if (typeof operationId !== 'string' || typeof committedAt !== 'string') continue
      for (const change of value.command!.changes!) {
        if (change.kind !== 'write' || change.noteId !== noteId || typeof change.content !== 'string') continue
        const id = `sha256:${digest(change.content)}`
        if (revisionId !== undefined && id !== revisionId) continue
        out.push({
          revisionId: id,
          operationId,
          previousRevision: typeof change.expectedRevision === 'string' ? change.expectedRevision : null,
          committedAt,
          actorPrincipalId: typeof value.receipt?.actorPrincipalId === 'string' ? value.receipt.actorPrincipalId : null,
          byteSize: byteSizeOf(change.content),
          content: change.content,
        })
        if (revisionId !== undefined) return out
      }
    } catch {
      // skip corrupt
    }
  }
  return out
}

async function listNativeWriteJournals(notesRoot: string, workspaceId: string, noteId: string): Promise<NoteHistoryRevision[]> {
  return collectNativeWriteJournals(notesRoot, workspaceId, noteId)
}

async function findInNativeWriteJournals(
  notesRoot: string,
  workspaceId: string,
  noteId: string,
  revisionId: string,
): Promise<NoteHistoryRevision | null> {
  const hits = await collectNativeWriteJournals(notesRoot, workspaceId, noteId, revisionId)
  return hits[0] ?? null
}

/** List version history for a note (newest first). Bodies are omitted. */
export async function listNoteRevisions(
  notesRoot: string,
  workspaceId: string,
  noteId: string,
): Promise<NoteHistoryEntry[]> {
  assertSafeNoteId(noteId)
  const fromJournals = await listCommittedJournals(notesRoot, workspaceId, noteId)
  const fromSidecar = (await readSidecar(notesRoot, noteId))?.revisions ?? []
  // Always merge native tips (early-filtered). Sidecar alone is not full coverage of pre-sidecar native history.
  const fromNative = await listNativeWriteJournals(notesRoot, workspaceId, noteId)
  // Distinct tip events are keyed by operationId so identical-byte restores stay listed.
  const byOp = new Map<string, NoteHistoryRevision>()
  for (const entry of [...fromJournals, ...fromNative, ...fromSidecar]) {
    const prev = byOp.get(entry.operationId)
    if (!prev || entry.committedAt > prev.committedAt) byOp.set(entry.operationId, entry)
  }
  const sorted = [...byOp.values()].sort((a, b) => {
    const byTime = b.committedAt.localeCompare(a.committedAt)
    if (byTime !== 0) return byTime
    return b.operationId.localeCompare(a.operationId)
  })
  return sorted.map((entry): NoteHistoryEntry => ({
    revisionId: entry.revisionId,
    operationId: entry.operationId,
    previousRevision: entry.previousRevision,
    committedAt: entry.committedAt,
    actorPrincipalId: entry.actorPrincipalId,
    byteSize: entry.byteSize,
  }))
}

/** Load one historical body by revisionId. Stops at the first hit. */
export async function getNoteRevision(
  notesRoot: string,
  workspaceId: string,
  noteId: string,
  revisionId: string,
): Promise<NoteHistoryRevision | null> {
  if (!revisionId) return null
  assertSafeNoteId(noteId)
  const sidecar = await readSidecar(notesRoot, noteId)
  const fromSidecar = sidecar?.revisions.find(entry => entry.revisionId === revisionId)
  if (fromSidecar) {
    const { schemaVersion: _s, ...entry } = fromSidecar
    return entry
  }
  const fromJournal = await findInCommittedJournals(notesRoot, workspaceId, noteId, revisionId)
  if (fromJournal) return fromJournal
  return findInNativeWriteJournals(notesRoot, workspaceId, noteId, revisionId)
}
