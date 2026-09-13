/**
 * Native Notes engine (ROX-AUD-031 / #334).
 *
 * Local markdown + sidecar revisions. SiYuan is not required. Conation is
 * an adapter, not this store. Concurrent saves without the current revision
 * are rejected (no silent overwrite).
 */

import { formatRox2EntityId } from './platform-contract.ts'

export const NOTES_ENGINE_SCHEMA_VERSION = 1
export const NOTES_SIDECAR_DIR = '.rox-notes-engine'

export type NoteBlock = {
  id: string
  text: string
}

export type NoteSidecar = {
  title: string
  blocks: readonly NoteBlock[]
  attachments: readonly string[]
  wikilinks: readonly string[]
  extra: Record<string, unknown>
}

export type NoteRevision = {
  id: string
  parentId: string | null
  markdown: string
  sidecar: NoteSidecar
  createdAt: number
}

export type NativeNote = {
  entityId: string
  noteId: string
  title: string
  markdown: string
  revision: string
  blocks: readonly NoteBlock[]
  attachments: readonly string[]
  wikilinks: readonly string[]
  extra: Record<string, unknown>
  updatedAt: number
}

export type NoteSaveInput = {
  noteId: string
  markdown: string
  expectedRevision?: string
  extra?: Record<string, unknown>
  now?: number
}

export type NoteSaveResult =
  | { status: 'ok'; note: NativeNote }
  | { status: 'conflict'; currentRevision: string; note: NativeNote }
  | { status: 'not_found' }

export type NotesEngineExport = {
  notes: NativeNote[]
  revisions: Record<string, NoteRevision[]>
  count: number
  hash: string
}

const BLOCK_RE = /<!--\s*block:([A-Za-z0-9_-]+)\s*-->/g
const WIKI_RE = /\[\[([^\]|#]+)(#[^\]|]*)?(\|[^\]]*)?\]\]/g

export function contentHash(markdown: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < markdown.length; i++) {
    hash ^= markdown.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return `${markdown.length.toString(16)}-${(hash >>> 0).toString(16).padStart(8, '0')}`
}

export function extractWikilinks(markdown: string): string[] {
  const links: string[] = []
  const seen = new Set<string>()
  WIKI_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = WIKI_RE.exec(markdown))) {
    const target = match[1]?.trim()
    if (!target) continue
    const key = target.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    links.push(target)
  }
  return links
}

export function parseBlocks(markdown: string): NoteBlock[] {
  const marked = [...markdown.matchAll(BLOCK_RE)]
  if (marked.length === 0) {
    const seen = new Map<string, number>()
    return markdown
      .split(/\n\n+/)
      .map((text) => text.trim())
      .filter(Boolean)
      .map((text) => {
        const base = `b_${contentHash(text)}`
        const count = (seen.get(base) ?? 0) + 1
        seen.set(base, count)
        return { id: count === 1 ? base : `${base}_${count}`, text }
      })
  }
  return marked.map((match, index) => {
    const start = (match.index ?? 0) + match[0].length
    const end = marked[index + 1]?.index ?? markdown.length
    return { id: match[1]!, text: markdown.slice(start, end).trim() }
  })
}

export function rewriteWikilinks(markdown: string, fromTitle: string, toTitle: string): string {
  const needle = fromTitle.trim().toLowerCase()
  return markdown.replace(WIKI_RE, (full, target: string, heading = '', alias = '') => {
    if (target.trim().toLowerCase() !== needle) return full
    return `[[${toTitle}${heading}${alias}]]`
  })
}

function titleFromMarkdown(markdown: string, fallback: string): string {
  const heading = markdown.match(/^#\s+(.+)$/m)
  return heading?.[1]?.trim() || fallback
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function cloneNote(note: NativeNote): NativeNote {
  return {
    entityId: note.entityId,
    noteId: note.noteId,
    title: note.title,
    markdown: note.markdown,
    revision: note.revision,
    blocks: note.blocks.map((block) => ({ id: block.id, text: block.text })),
    attachments: [...note.attachments],
    wikilinks: [...note.wikilinks],
    extra: cloneJson(note.extra),
    updatedAt: note.updatedAt,
  }
}

function cloneRevision(revision: NoteRevision): NoteRevision {
  return {
    id: revision.id,
    parentId: revision.parentId,
    markdown: revision.markdown,
    sidecar: {
      title: revision.sidecar.title,
      blocks: revision.sidecar.blocks.map((block) => ({ id: block.id, text: block.text })),
      attachments: [...revision.sidecar.attachments],
      wikilinks: [...revision.sidecar.wikilinks],
      extra: cloneJson(revision.sidecar.extra),
    },
    createdAt: revision.createdAt,
  }
}

function snapshotVault(
  heads: Map<string, NativeNote>,
  history: Map<string, NoteRevision[]>,
): { heads: Map<string, NativeNote>; history: Map<string, NoteRevision[]> } {
  return {
    heads: new Map(heads),
    history: new Map([...history.entries()].map(([id, log]) => [id, log.slice()])),
  }
}

function restoreVault(
  liveHeads: Map<string, NativeNote>,
  liveHistory: Map<string, NoteRevision[]>,
  snapshot: { heads: Map<string, NativeNote>; history: Map<string, NoteRevision[]> },
): void {
  liveHeads.clear()
  liveHistory.clear()
  for (const [id, note] of snapshot.heads) liveHeads.set(id, note)
  for (const [id, log] of snapshot.history) liveHistory.set(id, log)
}

function isNote(value: unknown): value is NativeNote {
  if (typeof value !== 'object' || value === null) return false
  const note = value as NativeNote
  return typeof note.noteId === 'string' && note.noteId.length > 0
    && typeof note.markdown === 'string'
    && typeof note.revision === 'string' && note.revision.length > 0
    && typeof note.title === 'string'
    && Array.isArray(note.blocks)
    && Array.isArray(note.attachments)
    && Array.isArray(note.wikilinks)
    && typeof note.extra === 'object' && note.extra !== null
    && typeof note.updatedAt === 'number'
}

function isRevision(value: unknown): value is NoteRevision {
  if (typeof value !== 'object' || value === null) return false
  const revision = value as NoteRevision
  return typeof revision.id === 'string' && revision.id.length > 0
    && (revision.parentId === null || typeof revision.parentId === 'string')
    && typeof revision.markdown === 'string'
    && typeof revision.sidecar === 'object' && revision.sidecar !== null
    && typeof revision.createdAt === 'number'
}

function validateImportBundle(bundle: NotesEngineExport): void {
  if (!Array.isArray(bundle.notes)) throw new Error('import: notes must be an array')
  if (typeof bundle.revisions !== 'object' || bundle.revisions === null || Array.isArray(bundle.revisions)) {
    throw new Error('import: revisions must be an object')
  }
  for (const note of bundle.notes) {
    if (!isNote(note)) throw new Error('import: invalid note')
    const log = bundle.revisions[note.noteId]
    if (!Array.isArray(log) || log.length === 0) {
      throw new Error(`import: missing revisions for ${note.noteId}`)
    }
    for (const [index, revision] of log.entries()) {
      if (!isRevision(revision)) throw new Error(`import: invalid revision for ${note.noteId}`)
      if (index === 0 && revision.parentId !== null) {
        throw new Error(`import: root parentId must be null for ${note.noteId}`)
      }
      if (index > 0 && revision.parentId !== log[index - 1]?.id) {
        throw new Error(`import: broken parent chain for ${note.noteId}`)
      }
    }
    const tip = log[log.length - 1]!
    if (tip.id !== note.revision) {
      throw new Error(`import: head ${note.noteId} does not match tip`)
    }
    if (tip.markdown !== note.markdown) {
      throw new Error(`import: head markdown does not match tip for ${note.noteId}`)
    }
  }
}

function stageImport(bundle: NotesEngineExport): {
  heads: Map<string, NativeNote>
  history: Map<string, NoteRevision[]>
} {
  validateImportBundle(bundle)
  const heads = new Map<string, NativeNote>()
  const history = new Map<string, NoteRevision[]>()
  for (const [noteId, log] of Object.entries(bundle.revisions)) {
    if (!Array.isArray(log)) throw new Error(`import: revisions for ${noteId} must be an array`)
    history.set(noteId, log.map(cloneRevision))
  }
  for (const note of bundle.notes) {
    heads.set(note.noteId, cloneNote(note))
  }
  return { heads, history }
}

function toNativeNote(noteId: string, revision: NoteRevision): NativeNote {
  return {
    entityId: formatRox2EntityId('note', noteId),
    noteId,
    title: revision.sidecar.title,
    markdown: revision.markdown,
    revision: revision.id,
    blocks: revision.sidecar.blocks,
    attachments: revision.sidecar.attachments,
    wikilinks: revision.sidecar.wikilinks,
    extra: revision.sidecar.extra,
    updatedAt: revision.createdAt,
  }
}

export type NativeNotesEngine = {
  create(noteId: string, markdown: string, extra?: Record<string, unknown>, now?: number): NativeNote
  read(noteId: string): NativeNote | null
  save(input: NoteSaveInput): NoteSaveResult
  rename(noteId: string, nextTitle: string): NativeNote | null
  search(query: string): NativeNote[]
  list(): NativeNote[]
  revisions(noteId: string): NoteRevision[]
  exportVault(): NotesEngineExport
  importVault(bundle: NotesEngineExport): { restored: number; hash: string }
}

export function createNativeNotesEngine(seed: readonly NativeNote[] = []): NativeNotesEngine {
  const heads = new Map<string, NativeNote>()
  const history = new Map<string, NoteRevision[]>()

  const writeHead = (noteId: string, markdown: string, parentId: string | null, extra: Record<string, unknown>, now: number): NativeNote => {
    const sidecar: NoteSidecar = {
      title: titleFromMarkdown(markdown, noteId),
      blocks: parseBlocks(markdown),
      attachments: [...(extra.attachments as string[] | undefined ?? [])],
      wikilinks: extractWikilinks(markdown),
      extra: { ...extra },
    }
    const revision: NoteRevision = {
      id: contentHash(markdown),
      parentId,
      markdown,
      sidecar,
      createdAt: now,
    }
    const note = toNativeNote(noteId, revision)
    heads.set(noteId, note)
    const log = history.get(noteId) ?? []
    history.set(noteId, [...log, revision])
    return note
  }

  for (const note of seed) {
    writeHead(note.noteId, note.markdown, null, note.extra, note.updatedAt)
  }

  return {
    create(noteId, markdown, extra = {}, now = Date.now()) {
      if (heads.has(noteId)) throw new Error(`note already exists: ${noteId}`)
      return writeHead(noteId, markdown, null, extra, now)
    },
    read(noteId) {
      return heads.get(noteId) ?? null
    },
    save(input) {
      const current = heads.get(input.noteId)
      if (!current) return { status: 'not_found' }
      if (input.expectedRevision != null && input.expectedRevision !== current.revision) {
        return { status: 'conflict', currentRevision: current.revision, note: current }
      }
      const note = writeHead(
        input.noteId,
        input.markdown,
        current.revision,
        { ...current.extra, ...input.extra },
        input.now ?? Date.now(),
      )
      return { status: 'ok', note }
    },
    rename(noteId, nextTitle) {
      const current = heads.get(noteId)
      if (!current) return null
      const previousTitle = current.title
      let markdown = current.markdown.replace(/^#\s+.+$/m, `# ${nextTitle}`)
      if (markdown === current.markdown) markdown = `# ${nextTitle}\n\n${current.markdown}`
      for (const [id, note] of heads) {
        if (id === noteId) continue
        const rewritten = rewriteWikilinks(note.markdown, previousTitle, nextTitle)
        if (rewritten !== note.markdown) {
          writeHead(id, rewritten, note.revision, note.extra, note.updatedAt)
        }
      }
      return writeHead(noteId, markdown, current.revision, current.extra, current.updatedAt)
    },
    search(query) {
      const needle = query.trim().toLowerCase()
      if (!needle) return this.list()
      return this.list().filter((note) =>
        note.title.toLowerCase().includes(needle) || note.markdown.toLowerCase().includes(needle),
      )
    },
    list() {
      return [...heads.values()]
    },
    revisions(noteId) {
      return history.get(noteId) ?? []
    },
    exportVault() {
      const notes = this.list()
      const revisions: Record<string, NoteRevision[]> = {}
      for (const [id, log] of history) revisions[id] = log
      const payload = JSON.stringify({ notes, revisions })
      return {
        notes,
        revisions,
        count: notes.length,
        hash: contentHash(payload),
      }
    },
    importVault(bundle) {
      const snapshot = snapshotVault(heads, history)
      try {
        const staged = stageImport(bundle)
        heads.clear()
        history.clear()
        for (const [id, note] of staged.heads) heads.set(id, note)
        for (const [id, log] of staged.history) history.set(id, log)
        const exported = this.exportVault()
        return { restored: exported.count, hash: exported.hash }
      } catch (error) {
        restoreVault(heads, history, snapshot)
        throw error
      }
    },
  }
}

export function migrateNotesVault(engine: NativeNotesEngine): {
  backup: NotesEngineExport
  count: number
  hash: string
} {
  const backup = engine.exportVault()
  return { backup, count: backup.count, hash: backup.hash }
}
