/**
 * Note version history for Docs/Notes.
 *
 * Primary source: durable MarkdownCommitStore journals under
 * `.rox-docs/commits/` (written by saveNote / content.commit). Each committed
 * journal already carries content, author, time and byte size — we list and
 * read those, never mutate them.
 *
 * Secondary source: `.rox/revisions/<note>.json` snapshots recorded on native
 * journal saves that do not write a MarkdownCommitStore journal, so history
 * stays available on both save paths. Snapshots are append-only; restore
 * creates a NEW save (new journal / snapshot), never rewrites an old one.
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

const ROX_META = '.rox'
const REVISIONS_DIR = 'revisions'
const COMMITS_ROOT = join('.rox-docs', 'commits')

const digest = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex')
const isMissing = (error: unknown): boolean => (error as NodeJS.ErrnoException)?.code === 'ENOENT'

function encodeNoteFileName(noteId: string): string {
  return Buffer.from(noteId, 'utf8').toString('base64url')
}

function sidecarPath(notesRoot: string, noteId: string): string {
  return join(notesRoot, ROX_META, REVISIONS_DIR, `${encodeNoteFileName(noteId)}.json`)
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

function entryKey(entry: NoteHistoryEntry): string {
  return entry.revisionId
}

function sortNewestFirst(entries: NoteHistoryEntry[]): NoteHistoryEntry[] {
  return [...entries].sort((a, b) => {
    const byTime = b.committedAt.localeCompare(a.committedAt)
    if (byTime !== 0) return byTime
    return b.revisionId.localeCompare(a.revisionId)
  })
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
  await mkdir(join(notesRoot, ROX_META, REVISIONS_DIR), { recursive: true })
  await assertSafeMetaPath(notesRoot, path)
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tmp, `${JSON.stringify(file, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  await rename(tmp, path)
}

/** Record a durable history snapshot after a successful save (append-only, deduped by revisionId). */
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
  if (!input.noteId || input.noteId.includes('\0') || input.noteId.includes('\\')
    || input.noteId.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('Invalid note ID')
  }
  if (!input.revisionId || !input.operationId) throw new Error('revisionId and operationId are required')
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
  const revisions = existing?.revisions.filter(item => item.revisionId !== entry.revisionId) ?? []
  revisions.push(entry)
  // Cap retained snapshots to keep vault size bounded (immutable history, drop oldest).
  const MAX = 200
  const kept = revisions.length > MAX ? revisions.slice(revisions.length - MAX) : revisions
  await writeSidecarAtomic(notesRoot, { schemaVersion: 1, noteId: input.noteId, revisions: kept })
  const { content: _c, schemaVersion: _s, ...summary } = entry
  return summary
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

async function readCommittedJournals(notesRoot: string, workspaceId: string, noteId: string): Promise<NoteHistoryRevision[]> {
  const stateRoot = join(notesRoot, COMMITS_ROOT)
  const directory = join(stateRoot, digest(`${workspaceId}\0${noteId}`))
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
      if (value.phase !== 'committed') continue
      const content = value.command?.content
      const revisionId = value.receipt?.revision
      const operationId = value.receipt?.operationId ?? value.command?.operationId
      const committedAt = value.receipt?.committedAt
      if (typeof content !== 'string' || typeof revisionId !== 'string' || typeof operationId !== 'string' || typeof committedAt !== 'string') continue
      if (value.receipt?.noteId && value.receipt.noteId !== noteId) continue
      if (value.command?.noteId && value.command.noteId !== noteId) continue
      out.push({
        revisionId,
        operationId,
        previousRevision: typeof value.receipt?.previousRevision === 'string' ? value.receipt.previousRevision : null,
        committedAt,
        actorPrincipalId: typeof value.receipt?.actorPrincipalId === 'string' ? value.receipt.actorPrincipalId : null,
        byteSize: byteSizeOf(content),
        content,
      })
    } catch {
      // Corrupt journal: skip; history remains best-effort over durable commits.
    }
  }
  return out
}

async function readNativeWriteJournals(notesRoot: string, workspaceId: string, noteId: string): Promise<NoteHistoryRevision[]> {
  const stateRoot = join(notesRoot, COMMITS_ROOT)
  const directory = join(stateRoot, digest(`native\0${workspaceId}`))
  let names: string[]
  try {
    names = await readdir(directory)
  } catch (error) {
    if (isMissing(error)) return []
    throw error
  }
  const out: NoteHistoryRevision[] = []
  for (const name of names) {
    if (!/^native-[a-f0-9]{64}\.json$/.test(name)) continue
    try {
      const value = JSON.parse(await readFile(join(directory, name), 'utf8')) as {
        phase?: string
        command?: { changes?: Array<{ kind?: string; noteId?: string; content?: string; expectedRevision?: string | null }> }
        receipt?: { operationId?: string; committedAt?: string; actorPrincipalId?: string }
      }
      if (value.phase !== 'committed' || !Array.isArray(value.command?.changes)) continue
      const operationId = value.receipt?.operationId
      const committedAt = value.receipt?.committedAt
      if (typeof operationId !== 'string' || typeof committedAt !== 'string') continue
      for (const change of value.command!.changes!) {
        if (change.kind !== 'write' || change.noteId !== noteId || typeof change.content !== 'string') continue
        const revisionId = `sha256:${digest(change.content)}`
        out.push({
          revisionId,
          operationId,
          previousRevision: typeof change.expectedRevision === 'string' ? change.expectedRevision : null,
          committedAt,
          actorPrincipalId: typeof value.receipt?.actorPrincipalId === 'string' ? value.receipt.actorPrincipalId : null,
          byteSize: byteSizeOf(change.content),
          content: change.content,
        })
      }
    } catch {
      // skip corrupt
    }
  }
  return out
}

/** List version history for a note (newest first). Bodies are omitted. */
export async function listNoteRevisions(
  notesRoot: string,
  workspaceId: string,
  noteId: string,
): Promise<NoteHistoryEntry[]> {
  if (!noteId || noteId.includes('\0') || noteId.includes('\\')
    || noteId.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('Invalid note ID')
  }
  const fromJournals = await readCommittedJournals(notesRoot, workspaceId, noteId)
  const fromNative = await readNativeWriteJournals(notesRoot, workspaceId, noteId)
  const fromSidecar = (await readSidecar(notesRoot, noteId))?.revisions ?? []
  const byId = new Map<string, NoteHistoryRevision>()
  for (const entry of [...fromJournals, ...fromNative, ...fromSidecar]) {
    const prev = byId.get(entryKey(entry))
    if (!prev || entry.committedAt > prev.committedAt) byId.set(entryKey(entry), entry)
  }
  const sorted = [...byId.values()].sort((a, b) => {
    const byTime = b.committedAt.localeCompare(a.committedAt)
    if (byTime !== 0) return byTime
    return b.revisionId.localeCompare(a.revisionId)
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

/** Load one historical body by revisionId. */
export async function getNoteRevision(
  notesRoot: string,
  workspaceId: string,
  noteId: string,
  revisionId: string,
): Promise<NoteHistoryRevision | null> {
  if (!revisionId) return null
  const fromJournals = await readCommittedJournals(notesRoot, workspaceId, noteId)
  const fromNative = await readNativeWriteJournals(notesRoot, workspaceId, noteId)
  const fromSidecar = (await readSidecar(notesRoot, noteId))?.revisions ?? []
  for (const entry of [...fromJournals, ...fromNative, ...fromSidecar]) {
    if (entry.revisionId === revisionId) return entry
  }
  return null
}
