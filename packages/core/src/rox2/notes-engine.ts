/**
 * Native Notes engine (ROX-AUD-031 / #334).
 *
 * Local markdown + sidecar revisions. SiYuan is not required. Conation is
 * an adapter, not this store. Saves require the current `expectedRevision`
 * token: callers must pass it, and a stale token conflicts (no silent
 * overwrite). Import validates head extra/sidecar against the tip before
 * commit; failure restores the prior vault snapshot. `list()` seed restores
 * heads from the tip and keeps the revision chain.
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
  expectedRevision: string
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
const NOTE_REVISION_LOG = Symbol.for('rox.notes.revisionLog')

export function contentHash(markdown: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < markdown.length; i++) {
    hash ^= markdown.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return `${markdown.length.toString(16)}-${(hash >>> 0).toString(16).padStart(8, '0')}`
}

function stableStringify(value: unknown): string {
  if (value === undefined) return 'null'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const keys = Object.keys(value as Record<string, unknown>).sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`).join(',')}}`
}

function revisionId(markdown: string, sidecar: NoteSidecar): string {
  return contentHash(`${markdown}\0${stableStringify({
    title: sidecar.title,
    blocks: sidecar.blocks.map((block) => ({ id: block.id, text: block.text })),
    attachments: sidecar.attachments,
    wikilinks: sidecar.wikilinks,
    extra: sidecar.extra,
  })}`)
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

function allocateBlockId(base: string, used: Set<string>): string {
  if (!used.has(base)) return base
  let suffix = 2
  while (used.has(`${base}_${suffix}`)) suffix += 1
  return `${base}_${suffix}`
}

function parseUnlabeledBlocks(markdown: string, used: Set<string>): NoteBlock[] {
  return markdown
    .split(/\n\n+/)
    .map((text) => text.trim())
    .filter(Boolean)
    .map((text) => {
      const id = allocateBlockId(`b_${contentHash(text)}`, used)
      used.add(id)
      return { id, text }
    })
}

export function parseBlocks(markdown: string): NoteBlock[] {
  const marked = [...markdown.matchAll(BLOCK_RE)]
  if (marked.length === 0) return parseUnlabeledBlocks(markdown, new Set())
  const used = new Set(marked.map((match) => match[1]!))
  const blocks: NoteBlock[] = []
  const firstIndex = marked[0]?.index ?? 0
  if (firstIndex > 0) {
    blocks.push(...parseUnlabeledBlocks(markdown.slice(0, firstIndex), used))
  }
  for (const [index, match] of marked.entries()) {
    const start = (match.index ?? 0) + match[0].length
    const end = marked[index + 1]?.index ?? markdown.length
    blocks.push({ id: match[1]!, text: markdown.slice(start, end).trim() })
  }
  return blocks
}

function stampBlockMarkers(markdown: string): { markdown: string; blocks: NoteBlock[] } {
  const blocks = parseBlocks(markdown)
  if (blocks.length === 0) return { markdown, blocks }
  return {
    markdown: blocks.map((block) => `<!-- block:${block.id} -->\n${block.text}`).join('\n\n'),
    blocks,
  }
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

function sidecarFromNote(note: NativeNote): NoteSidecar {
  return {
    title: note.title,
    blocks: note.blocks.map((block) => ({ id: block.id, text: block.text })),
    attachments: [...note.attachments],
    wikilinks: [...note.wikilinks],
    extra: cloneJson(note.extra),
  }
}

function sidecarFingerprint(sidecar: NoteSidecar): string {
  return stableStringify({
    title: sidecar.title,
    blocks: sidecar.blocks.map((block) => ({ id: block.id, text: block.text })),
    attachments: sidecar.attachments,
    wikilinks: sidecar.wikilinks,
    extra: sidecar.extra,
  })
}

function tipRevisionFromNote(note: NativeNote): NoteRevision {
  return {
    id: note.revision,
    parentId: null,
    markdown: note.markdown,
    sidecar: sidecarFromNote(note),
    createdAt: note.updatedAt,
  }
}

function attachRevisionLog(note: NativeNote, log: readonly NoteRevision[]): NativeNote {
  const copy = cloneNote(note)
  Object.defineProperty(copy, NOTE_REVISION_LOG, {
    value: log.map(cloneRevision),
    enumerable: false,
  })
  return copy
}

function revisionLogOf(note: NativeNote): NoteRevision[] | undefined {
  const value = (note as unknown as Record<symbol, unknown>)[NOTE_REVISION_LOG]
  if (!Array.isArray(value) || value.length === 0) return undefined
  return value as NoteRevision[]
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
    if (sidecarFingerprint(tip.sidecar) !== sidecarFingerprint(sidecarFromNote(note))) {
      throw new Error(`import: head extra/sidecar does not match tip for ${note.noteId}`)
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

/** Duck-type NativeNotesEngine vs NotesRepository (`put`/`get` Map). */
export function isNativeNotesEngine(value: unknown): value is NativeNotesEngine {
  if (value === null || typeof value !== 'object') return false
  const notes = value as Record<string, unknown>
  return (
    typeof notes.create === 'function' &&
    typeof notes.read === 'function' &&
    typeof notes.save === 'function' &&
    typeof notes.list === 'function' &&
    typeof notes.revisions === 'function'
  )
}

export function createNativeNotesEngine(seed: readonly NativeNote[] = []): NativeNotesEngine {
  const heads = new Map<string, NativeNote>()
  const history = new Map<string, NoteRevision[]>()

  const writeHead = (noteId: string, markdown: string, parentId: string | null, extra: Record<string, unknown>, now: number): NativeNote => {
    const stamped = stampBlockMarkers(markdown)
    const sidecar: NoteSidecar = {
      title: titleFromMarkdown(stamped.markdown, noteId),
      blocks: stamped.blocks,
      attachments: [...(extra.attachments as string[] | undefined ?? [])],
      wikilinks: extractWikilinks(stamped.markdown),
      extra: { ...extra },
    }
    const revision: NoteRevision = {
      id: revisionId(stamped.markdown, sidecar),
      parentId,
      markdown: stamped.markdown,
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
    heads.set(note.noteId, cloneNote(note))
    const log = revisionLogOf(note)
    history.set(note.noteId, log ? log.map(cloneRevision) : [tipRevisionFromNote(note)])
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
      if (input.expectedRevision == null || input.expectedRevision === '' || input.expectedRevision !== current.revision) {
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
      return [...heads.values()].map((note) => attachRevisionLog(note, history.get(note.noteId) ?? []))
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
