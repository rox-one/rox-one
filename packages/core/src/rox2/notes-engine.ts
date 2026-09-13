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
    return markdown
      .split(/\n\n+/)
      .map((text) => text.trim())
      .filter(Boolean)
      .map((text, index) => ({ id: `b_${index + 1}`, text }))
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
      heads.clear()
      history.clear()
      for (const note of bundle.notes) {
        writeHead(note.noteId, note.markdown, null, note.extra, note.updatedAt)
      }
      const exported = this.exportVault()
      return { restored: exported.count, hash: exported.hash }
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
