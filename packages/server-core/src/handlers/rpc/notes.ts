import { lstat, mkdir, open, readdir, readFile, realpath, rename, rm, stat, unlink, writeFile } from 'fs/promises'
import { constants, existsSync } from 'fs'
import { basename, dirname, extname, join, relative, resolve, sep } from 'path'
import { randomUUID } from 'crypto'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import { getDefaultWorkspacesDir } from '@craft-agent/shared/workspaces'
import { loadWorkspaceConfig } from '@craft-agent/shared/workspaces'
import matter from 'gray-matter'
import yaml from 'js-yaml'
import { RPC_CHANNELS, type CreateNoteCommentInput, type FileAttachment, type NoteAsset, type NoteAssetRenameResult, type NoteBacklink, type NoteChangedPayload, type NoteCommentAnchor, type NoteCommentThread, type NoteDocument, type NoteLink, type NoteRenameImpact, type NoteSummary, type UpdateNoteCommentInput } from '@craft-agent/shared/protocol'
import { pushTyped, type RpcServer } from '@craft-agent/server-core/transport'
import { sanitizeFilename } from '@craft-agent/server-core/handlers'
import type { HandlerDeps } from '../handler-deps'
import { awardXpSafe } from '@craft-agent/shared/gamification'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.notes.LIST,
  RPC_CHANNELS.notes.READ,
  RPC_CHANNELS.notes.SAVE,
  RPC_CHANNELS.notes.CREATE,
  RPC_CHANNELS.notes.RENAME,
  RPC_CHANNELS.notes.DELETE,
  RPC_CHANNELS.notes.RENAME_FOLDER,
  RPC_CHANNELS.notes.DELETE_FOLDER,
  RPC_CHANNELS.notes.SEARCH,
  RPC_CHANNELS.notes.GET_BACKLINKS,
  RPC_CHANNELS.notes.LIST_COMMENTS,
  RPC_CHANNELS.notes.CREATE_COMMENT,
  RPC_CHANNELS.notes.UPDATE_COMMENT,
  RPC_CHANNELS.notes.DELETE_COMMENT,
  RPC_CHANNELS.notes.GET_RENAME_IMPACT,
  RPC_CHANNELS.notes.GET_DAILY_NOTE,
  RPC_CHANNELS.notes.IMPORT_ASSET,
  RPC_CHANNELS.notes.LIST_ASSETS,
  RPC_CHANNELS.notes.DELETE_ASSET,
  RPC_CHANNELS.notes.RENAME_ASSET,
  RPC_CHANNELS.notes.UPDATE_PROPERTIES,
  RPC_CHANNELS.notes.WATCH,
  RPC_CHANNELS.notes.UNWATCH,
] as const

const NOTES_DIR = 'notes'
const ASSETS_DIR = 'assets'
const DAILY_DIR = 'daily'
const TEMPLATES_DIR = 'templates'
const PROJECTS_DIR = 'projects'
const ROX_META_DIR = '.rox'
const COMMENTS_DIR = 'comments'
const DAILY_TEMPLATE_FILE = 'daily.md'
const RESERVED_WIKI_TARGET_SEGMENTS = new Set([ASSETS_DIR, TEMPLATES_DIR])
const FORBIDDEN_WIKI_TARGET_CHARS_RE = /[\x00-\x1f\x7f<>:"|?*[\]#]/

type ParsedNote = {
  properties: Record<string, unknown>
  body: string
  tags: string[]
  links: NoteLink[]
  assetRefs: string[]
}

type ClientNotesWatchState = {
  watcher: import('fs').FSWatcher
  workspaceId: string
  debounceTimer: ReturnType<typeof setTimeout> | null
}

const clientNotesWatches = new Map<string, ClientNotesWatchState>()
// noteFilePath → mtime recorded immediately after our own writeFile()
// If watcher fires and stat() mtime matches, it's our own write — suppress it.
const lastInternalMtime = new Map<string, number>()
const noteCommentLocks = new Map<string, Promise<void>>()

export function cleanupNotesWatchForClient(clientId: string): void {
  const state = clientNotesWatches.get(clientId)
  if (!state) return

  if (state.debounceTimer) {
    clearTimeout(state.debounceTimer)
    state.debounceTimer = null
  }
  state.watcher.close()
  clientNotesWatches.delete(clientId)
}

function getWorkspaceRoot(workspaceId: string): string {
  const workspace = getWorkspaceByNameOrId(workspaceId)
  if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
  return workspace.rootPath
}

function getWorkspaceNotesRoot(workspaceId: string): string {
  const workspace = getWorkspaceByNameOrId(workspaceId)
  if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
  // Custom notesPath takes priority; fallback to isolated app-data directory
  const config = loadWorkspaceConfig(workspace.rootPath)
  if (config?.notesPath) return config.notesPath
  return join(getDefaultWorkspacesDir(), workspaceId, NOTES_DIR)
}

function getNotesRoot(workspaceRoot: string): string {
  return join(workspaceRoot, NOTES_DIR)
}

function toSlashPath(path: string): string {
  return path.split(sep).join('/')
}

function stripMdExtension(path: string): string {
  return path.toLowerCase().endsWith('.md') ? path.slice(0, -3) : path
}

function isErrnoException(error: unknown, code: string): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as NodeJS.ErrnoException).code === code
}

function noteIdFromRelativePath(relativePath: string): string {
  return stripMdExtension(toSlashPath(relativePath))
}

function assertSafeNoteId(noteId: string): string {
  if (!noteId || noteId.startsWith('/') || noteId.includes('\\') || noteId.split('/').some(part => part === '..' || part === '')) {
    throw new Error('Invalid note id')
  }
  return stripMdExtension(noteId).replace(/^\/+/, '')
}

function notePathFromId(notesRoot: string, noteId: string): string {
  const safeId = assertSafeNoteId(noteId)
  const resolved = resolve(notesRoot, `${safeId}.md`)
  const normalizedRoot = resolve(notesRoot)
  if (resolved !== normalizedRoot && !resolved.startsWith(`${normalizedRoot}${sep}`)) {
    throw new Error('Invalid note path')
  }
  return resolved
}

function titleFromId(noteId: string): string {
  return basename(noteId)
}

function safeNoteFilename(title: string): string {
  const safe = sanitizeFilename(title.trim() || 'Untitled').replace(/\.md$/i, '')
  return `${safe || 'Untitled'}.md`
}

async function ensureNotesDirs(notesRoot: string): Promise<void> {
  await mkdir(join(notesRoot, ASSETS_DIR), { recursive: true })
  await mkdir(join(notesRoot, DAILY_DIR), { recursive: true })
  await mkdir(join(notesRoot, TEMPLATES_DIR), { recursive: true })
  await mkdir(join(notesRoot, PROJECTS_DIR), { recursive: true })
}

type NoteCommentsFile = {
  schemaVersion: 1
  noteId: string
  comments: NoteCommentThread[]
}

function noteCommentsDir(notesRoot: string): string {
  return join(notesRoot, ROX_META_DIR, COMMENTS_DIR)
}

function noteCommentsPath(notesRoot: string, noteId: string): string {
  const safeId = assertSafeNoteId(noteId)
  const encoded = Buffer.from(safeId, 'utf8').toString('base64url')
  return join(noteCommentsDir(notesRoot), `${encoded}.json`)
}

async function ensureNoteCommentsDir(notesRoot: string): Promise<void> {
  await ensureSafeNoteDirectory(notesRoot, noteCommentsDir(notesRoot))
}

function noteCommentLockKey(notesRoot: string, noteId: string): string {
  return `${resolve(notesRoot)}:${assertSafeNoteId(noteId)}`
}

async function withNoteCommentsLock<T>(notesRoot: string, noteId: string, fn: () => Promise<T>): Promise<T> {
  const key = noteCommentLockKey(notesRoot, noteId)
  const previous = noteCommentLocks.get(key) ?? Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>(resolveGate => { release = resolveGate })
  const next = previous.catch(() => {}).then(() => gate)
  noteCommentLocks.set(key, next)

  await previous.catch(() => {})
  try {
    return await fn()
  } finally {
    release()
    if (noteCommentLocks.get(key) === next) {
      noteCommentLocks.delete(key)
    }
  }
}

function isSymlinkError(error: unknown): boolean {
  return isErrnoException(error, 'ELOOP') || isErrnoException(error, 'EINVAL')
}

async function assertSafeNoteCommentsFilePath(notesRoot: string, noteId: string): Promise<string> {
  await ensureNoteCommentsDir(notesRoot)
  const filePath = noteCommentsPath(notesRoot, noteId)
  const commentsDir = noteCommentsDir(notesRoot)
  const rootReal = await realpath(notesRoot)
  const commentsDirReal = await realpath(commentsDir)
  if (!isInsidePath(rootReal, commentsDirReal)) throw new Error('Invalid note comments path')

  try {
    const info = await lstat(filePath)
    if (info.isSymbolicLink()) throw new Error('Invalid note comments path')
  } catch (error) {
    if (!isErrnoException(error, 'ENOENT')) throw error
  }

  return filePath
}

async function readFileNoFollow(filePath: string): Promise<string> {
  let handle: Awaited<ReturnType<typeof open>> | null = null
  try {
    handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW)
    return await handle.readFile('utf-8')
  } catch (error) {
    if (isSymlinkError(error)) throw new Error('Invalid note comments path')
    throw error
  } finally {
    await handle?.close()
  }
}

async function writeAtomicFileNoFollow(notesRoot: string, filePath: string, content: string): Promise<void> {
  const dir = dirname(filePath)
  await ensureSafeNoteDirectory(notesRoot, dir)
  const tmpPath = join(dir, `.${basename(filePath)}.${process.pid}.${randomUUID()}.tmp`)
  let didWriteTmp = false

  try {
    if (!(await writeNewNoteFile(tmpPath, content))) {
      throw new Error('Could not create temporary note comments file')
    }
    didWriteTmp = true

    try {
      const info = await lstat(filePath)
      if (info.isSymbolicLink()) throw new Error('Invalid note comments path')
    } catch (error) {
      if (!isErrnoException(error, 'ENOENT')) throw error
    }

    await rename(tmpPath, filePath)
    didWriteTmp = false
  } finally {
    if (didWriteTmp) await rm(tmpPath, { force: true })
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function cleanCommentText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string') throw new Error(`Invalid ${field}`)
  const clean = value.trim()
  if (!clean) throw new Error(`Invalid ${field}`)
  return clean.slice(0, maxLength)
}

function sanitizeCommentAnchor(anchor: unknown): NoteCommentAnchor {
  if (!isRecord(anchor) || !Array.isArray(anchor.selectors)) throw new Error('Invalid comment anchor')

  const selectedText = cleanCommentText(anchor.selectedText, 'comment anchor', 4_000)
  const selectors: NoteCommentAnchor['selectors'] = []

  for (const selector of anchor.selectors) {
    if (!isRecord(selector) || typeof selector.type !== 'string') continue

    if (selector.type === 'TextPositionSelector' || selector.type === 'text-position') {
      const start = Number(selector.start)
      const end = Number(selector.end)
      if (Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end > start) {
        selectors.push({ type: 'text-position', start: Math.floor(start), end: Math.floor(end) })
      }
      continue
    }

    if (selector.type === 'TextQuoteSelector' || selector.type === 'text-quote') {
      const exact = typeof selector.exact === 'string' ? selector.exact.slice(0, 4_000) : selectedText
      if (!exact.trim()) continue
      selectors.push({
        type: 'text-quote',
        exact,
        prefix: typeof selector.prefix === 'string' ? selector.prefix.slice(-120) : undefined,
        suffix: typeof selector.suffix === 'string' ? selector.suffix.slice(0, 120) : undefined,
      })
    }
  }

  const hasPosition = selectors.some(selector => selector.type === 'text-position')
  const hasQuote = selectors.some(selector => selector.type === 'text-quote')
  if (!hasPosition || !hasQuote) throw new Error('Invalid comment anchor')

  return { selectedText, selectors }
}

function normalizeComment(comment: unknown, fallbackNoteId: string): NoteCommentThread | null {
  if (!isRecord(comment)) return null

  try {
    const id = cleanCommentText(comment.id, 'comment id', 140)
    const body = cleanCommentText(comment.body, 'comment body', 20_000)
    const anchor = sanitizeCommentAnchor(comment.anchor)
    const noteId = typeof comment.noteId === 'string' && comment.noteId.trim()
      ? assertSafeNoteId(comment.noteId)
      : fallbackNoteId
    const createdAt = Number(comment.createdAt)
    const updatedAt = Number(comment.updatedAt)
    const resolvedAt = Number(comment.resolvedAt)

    return {
      id,
      noteId,
      author: typeof comment.author === 'string' && comment.author.trim() ? comment.author.trim().slice(0, 80) : 'Вы',
      body,
      anchor,
      createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
      updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now(),
      resolvedAt: Number.isFinite(resolvedAt) ? resolvedAt : undefined,
    }
  } catch {
    return null
  }
}

async function readNoteCommentsFile(notesRoot: string, noteId: string): Promise<NoteCommentsFile> {
  const safeNoteId = assertSafeNoteId(noteId)
  const filePath = await assertSafeNoteCommentsFilePath(notesRoot, safeNoteId)
  let raw = ''
  try {
    raw = await readFileNoFollow(filePath)
  } catch (error) {
    if (isErrnoException(error, 'ENOENT')) return { schemaVersion: 1, noteId: safeNoteId, comments: [] }
    throw error
  }

  const parsed = JSON.parse(raw) as unknown
  const sourceComments = isRecord(parsed) && Array.isArray(parsed.comments) ? parsed.comments : []
  const comments = sourceComments
    .map(comment => normalizeComment(comment, safeNoteId))
    .filter((comment): comment is NoteCommentThread => Boolean(comment))
    .map(comment => ({ ...comment, noteId: safeNoteId }))

  return { schemaVersion: 1, noteId: safeNoteId, comments }
}

async function writeNoteCommentsFile(notesRoot: string, noteId: string, comments: NoteCommentThread[]): Promise<void> {
  const safeNoteId = assertSafeNoteId(noteId)
  const filePath = await assertSafeNoteCommentsFilePath(notesRoot, safeNoteId)
  const payload: NoteCommentsFile = {
    schemaVersion: 1,
    noteId: safeNoteId,
    comments: comments.map(comment => ({ ...comment, noteId: safeNoteId })),
  }
  await writeAtomicFileNoFollow(notesRoot, filePath, `${JSON.stringify(payload, null, 2)}\n`)
}

export async function listNoteCommentsForRoot(notesRoot: string, noteId: string): Promise<NoteCommentThread[]> {
  await ensureNotesDirs(notesRoot)
  const file = await readNoteCommentsFile(notesRoot, noteId)
  return file.comments
}

export async function createNoteCommentForRoot(notesRoot: string, input: CreateNoteCommentInput): Promise<NoteCommentThread> {
  const safeNoteId = assertSafeNoteId(input.noteId)
  return withNoteCommentsLock(notesRoot, safeNoteId, async () => {
    await ensureNotesDirs(notesRoot)
    if (!existsSync(notePathFromId(notesRoot, safeNoteId))) throw new Error(`Note not found: ${safeNoteId}`)
    const file = await readNoteCommentsFile(notesRoot, safeNoteId)
    const now = Date.now()
    const comment: NoteCommentThread = {
      id: randomUUID(),
      noteId: safeNoteId,
      author: typeof input.author === 'string' && input.author.trim() ? input.author.trim().slice(0, 80) : 'Вы',
      body: cleanCommentText(input.body, 'comment body', 20_000),
      anchor: sanitizeCommentAnchor(input.anchor),
      createdAt: now,
      updatedAt: now,
    }
    await writeNoteCommentsFile(notesRoot, safeNoteId, [...file.comments, comment])
    return comment
  })
}

export async function updateNoteCommentForRoot(notesRoot: string, input: UpdateNoteCommentInput): Promise<NoteCommentThread> {
  const safeNoteId = assertSafeNoteId(input.noteId)
  return withNoteCommentsLock(notesRoot, safeNoteId, async () => {
    await ensureNotesDirs(notesRoot)
    const file = await readNoteCommentsFile(notesRoot, safeNoteId)
    const index = file.comments.findIndex(comment => comment.id === input.commentId)
    if (index === -1) throw new Error(`Comment not found: ${input.commentId}`)

    const previous = file.comments[index]
    const now = Date.now()
    const next: NoteCommentThread = {
      ...previous,
      body: typeof input.body === 'string' ? cleanCommentText(input.body, 'comment body', 20_000) : previous.body,
      updatedAt: now,
      resolvedAt: typeof input.resolved === 'boolean'
        ? input.resolved ? previous.resolvedAt ?? now : undefined
        : previous.resolvedAt,
    }
    const comments = file.comments.slice()
    comments[index] = next
    await writeNoteCommentsFile(notesRoot, safeNoteId, comments)
    return next
  })
}

export async function deleteNoteCommentForRoot(notesRoot: string, noteId: string, commentId: string): Promise<void> {
  const safeNoteId = assertSafeNoteId(noteId)
  await withNoteCommentsLock(notesRoot, safeNoteId, async () => {
    await ensureNotesDirs(notesRoot)
    const file = await readNoteCommentsFile(notesRoot, safeNoteId)
    const comments = file.comments.filter(comment => comment.id !== commentId)
    if (comments.length === file.comments.length) throw new Error(`Comment not found: ${commentId}`)
    await writeNoteCommentsFile(notesRoot, safeNoteId, comments)
  })
}

async function deleteNoteCommentsForRoot(notesRoot: string, noteId: string): Promise<void> {
  const safeNoteId = assertSafeNoteId(noteId)
  await withNoteCommentsLock(notesRoot, safeNoteId, async () => {
    const filePath = await assertSafeNoteCommentsFilePath(notesRoot, safeNoteId)
    await rm(filePath, { force: true })
  })
}

async function renameNoteCommentsForRoot(notesRoot: string, oldNoteId: string, newNoteId: string): Promise<void> {
  const oldSafeId = assertSafeNoteId(oldNoteId)
  const newSafeId = assertSafeNoteId(newNoteId)
  if (oldSafeId === newSafeId) return

  const lockIds = [oldSafeId, newSafeId].sort()
  await withNoteCommentsLock(notesRoot, lockIds[0], async () => {
    await withNoteCommentsLock(notesRoot, lockIds[1], async () => {
      const oldComments = await readNoteCommentsFile(notesRoot, oldSafeId)
      const oldPath = await assertSafeNoteCommentsFilePath(notesRoot, oldSafeId)
      if (oldComments.comments.length === 0 && !existsSync(oldPath)) return

      const newComments = await readNoteCommentsFile(notesRoot, newSafeId)
      const merged = new Map<string, NoteCommentThread>()
      for (const comment of newComments.comments) merged.set(comment.id, { ...comment, noteId: newSafeId })
      for (const comment of oldComments.comments) merged.set(comment.id, { ...comment, noteId: newSafeId })

      await writeNoteCommentsFile(notesRoot, newSafeId, Array.from(merged.values()))
      await rm(oldPath, { force: true })
    })
  })
}

function isInsidePath(root: string, candidate: string): boolean {
  const normalizedRoot = resolve(root)
  const normalizedCandidate = resolve(candidate)
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}${sep}`)
}

async function assertNoSymlinkAncestors(root: string, candidateDir: string): Promise<void> {
  const normalizedRoot = resolve(root)
  const normalizedDir = resolve(candidateDir)
  if (!isInsidePath(normalizedRoot, normalizedDir)) throw new Error('Invalid note path')

  const rootReal = await realpath(normalizedRoot)
  const relativeDir = relative(normalizedRoot, normalizedDir)
  if (!relativeDir) return

  let cursor = normalizedRoot
  for (const segment of relativeDir.split(sep).filter(Boolean)) {
    cursor = join(cursor, segment)
    let info: Awaited<ReturnType<typeof lstat>>
    try {
      info = await lstat(cursor)
    } catch (error) {
      if (isErrnoException(error, 'ENOENT')) return
      throw error
    }

    if (info.isSymbolicLink()) throw new Error('Invalid note path')
    const cursorReal = await realpath(cursor)
    if (!isInsidePath(rootReal, cursorReal)) throw new Error('Invalid note path')
  }
}

async function ensureSafeNoteDirectory(notesRoot: string, dir: string): Promise<void> {
  await mkdir(notesRoot, { recursive: true })
  await assertNoSymlinkAncestors(notesRoot, dir)
  await mkdir(dir, { recursive: true })
  const rootReal = await realpath(notesRoot)
  const dirReal = await realpath(dir)
  if (!isInsidePath(rootReal, dirReal)) throw new Error('Invalid note path')
}

async function listMarkdownFiles(dir: string, root = dir): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const files: string[] = []

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const abs = join(dir, entry.name)
    const rel = toSlashPath(relative(root, abs))
    if (entry.isDirectory()) {
      if (rel === ASSETS_DIR || rel.startsWith(`${ASSETS_DIR}/`)) continue
      if (rel === TEMPLATES_DIR || rel.startsWith(`${TEMPLATES_DIR}/`)) continue
      files.push(...await listMarkdownFiles(abs, root))
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      files.push(abs)
    }
  }

  return files
}

function parseFrontmatter(content: string): { properties: Record<string, unknown>; body: string } {
  try {
    const parsed = matter(content)
    return { properties: parsed.data as Record<string, unknown>, body: parsed.content }
  } catch {
    return { properties: {}, body: content }
  }
}

function parseCreatedAt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.getTime()
  if (typeof value === 'string') {
    if (/^\d+$/.test(value.trim())) {
      const parsedNumber = Number(value.trim())
      return Number.isFinite(parsedNumber) && parsedNumber > 0 ? parsedNumber : null
    }
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function extractTags(body: string, properties: Record<string, unknown>): string[] {
  const tags = new Set<string>()
  const fmTags = properties.tags
  if (Array.isArray(fmTags)) {
    fmTags.forEach(tag => {
      if (typeof tag === 'string' && tag.trim()) tags.add(tag.replace(/^#/, '').trim())
    })
  } else if (typeof fmTags === 'string') {
    fmTags.split(/[,\s]+/).forEach(tag => {
      if (tag.trim()) tags.add(tag.replace(/^#/, '').trim())
    })
  }

  for (const match of body.matchAll(/(^|[\s(])#([A-Za-z0-9_/-]+)/g)) {
    tags.add(match[2])
  }
  return [...tags].sort((a, b) => a.localeCompare(b))
}

function lineForIndex(content: string, index: number): number {
  return content.slice(0, index).split(/\r?\n/).length
}

function parseNoteContent(content: string): ParsedNote {
  const { properties, body } = parseFrontmatter(content)
  const links: NoteLink[] = []
  const assetRefs = new Set<string>()

  for (const match of content.matchAll(/\[\[([^\]|#]+)(#[^\]|]*)?(?:\|([^\]]+))?\]\]/g)) {
    links.push({
      target: match[1].trim(),
      ...(match[3]?.trim() ? { alias: match[3].trim() } : {}),
      line: lineForIndex(content, match.index ?? 0),
    })
  }

  for (const match of content.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
    const ref = match[1].trim()
    if (ref && !/^[a-z]+:\/\//i.test(ref)) assetRefs.add(ref)
  }

  return {
    properties,
    body,
    tags: extractTags(body, properties),
    links,
    assetRefs: [...assetRefs].sort(),
  }
}

async function summarizeNote(notesRoot: string, filePath: string): Promise<NoteSummary> {
  const [content, info] = await Promise.all([
    readFile(filePath, 'utf-8'),
    stat(filePath),
  ])
  const relativePath = toSlashPath(relative(notesRoot, filePath))
  const id = noteIdFromRelativePath(relativePath)
  const parsed = parseNoteContent(content)
  const title = typeof parsed.properties.title === 'string' && parsed.properties.title.trim()
    ? parsed.properties.title.trim()
    : titleFromId(id)
  const createdAt = parseCreatedAt(parsed.properties.createdAt) ?? info.birthtimeMs

  return {
    id,
    title,
    path: filePath,
    relativePath,
    tags: parsed.tags,
    properties: parsed.properties,
    links: parsed.links,
    assetRefs: parsed.assetRefs,
    updatedAt: info.mtimeMs,
    createdAt,
    size: info.size,
  }
}

async function listNotes(notesRoot: string): Promise<NoteSummary[]> {
  await ensureNotesDirs(notesRoot)
  const files = await listMarkdownFiles(notesRoot)
  const notes = await Promise.all(files.map(file => summarizeNote(notesRoot, file)))
  notes.sort((a, b) => b.updatedAt - a.updatedAt || a.title.localeCompare(b.title))
  return notes
}

function noteMatchesTarget(note: NoteSummary, target: string): boolean {
  const normalized = normalizeWikiTarget(target).toLowerCase()
  return normalized === note.id.toLowerCase()
    || normalized === note.title.toLowerCase()
    || normalized === titleFromId(note.id).toLowerCase()
}

async function getBacklinks(notesRoot: string, noteId: string): Promise<NoteBacklink[]> {
  await ensureNotesDirs(notesRoot)
  const notes = await listNotes(notesRoot)
  const target = notes.find(note => note.id === noteId)
  if (!target) return []

  const backlinks: NoteBacklink[] = []
  for (const note of notes) {
    if (note.id === target.id) continue
    const matchingLinks = note.links.filter(link => noteMatchesTarget(target, link.target))
    if (matchingLinks.length === 0) continue
    const content = await readFile(join(notesRoot, note.relativePath), 'utf-8')
    const lines = content.split(/\r?\n/)
    for (const link of matchingLinks) {
      backlinks.push({
        noteId: note.id,
        title: note.title,
        path: note.path,
        line: link.line,
        preview: (lines[link.line - 1] ?? '').trim(),
      })
    }
  }
  return backlinks
}

async function readNote(notesRoot: string, noteId: string): Promise<NoteDocument> {
  await ensureNotesDirs(notesRoot)
  const filePath = notePathFromId(notesRoot, noteId)
  const [summary, content, backlinks] = await Promise.all([
    summarizeNote(notesRoot, filePath),
    readFile(filePath, 'utf-8'),
    getBacklinks(notesRoot, assertSafeNoteId(noteId)),
  ])
  return { ...summary, content, backlinks }
}

function buildInitialNoteContent(title: string, createdAt = Date.now()): string {
  return stringifyNoteContent('', { title, tags: [], createdAt })
}

function stringifyNoteContent(body: string, properties: Record<string, unknown>): string {
  const frontmatter = yaml.dump(properties, {
    lineWidth: -1,
    noRefs: true,
    sortKeys: (a, b) => {
      if (a === 'title') return -1
      if (b === 'title') return 1
      if (a === 'tags') return -1
      if (b === 'tags') return 1
      return String(a).localeCompare(String(b))
    },
  }).trimEnd()
  return `---\n${frontmatter}\n---\n\n${body.replace(/^\n+/, '')}`
}

function updateFrontmatterTitle(content: string, title: string): string {
  const { properties, body } = parseFrontmatter(content)
  return stringifyNoteContent(body, { ...properties, title })
}

function updateFrontmatterProperties(content: string, nextProperties: Record<string, unknown>): string {
  const { body } = parseFrontmatter(content)
  return stringifyNoteContent(body, nextProperties)
}

async function createNote(notesRoot: string, title: string, folder?: string): Promise<NoteDocument> {
  await ensureNotesDirs(notesRoot)
  const safeFolder = folder ? assertSafeNoteId(folder) : ''
  const dir = safeFolder ? resolve(notesRoot, safeFolder) : notesRoot
  if (!isInsidePath(notesRoot, dir)) throw new Error('Invalid note folder')
  await ensureSafeNoteDirectory(notesRoot, dir)

  let filePath = join(dir, safeNoteFilename(title))
  let suffix = 2
  while (!(await writeNewNoteFile(filePath, buildInitialNoteContent(title || 'Untitled')))) {
    filePath = join(dir, `${sanitizeFilename(title || 'Untitled')}-${suffix++}.md`)
  }
  return readNote(notesRoot, noteIdFromRelativePath(relative(notesRoot, filePath)))
}

function normalizeWikiTarget(target: string): string {
  return stripMdExtension(target.trim()).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
}

function isSafeWikiTargetSegment(segment: string): boolean {
  const trimmed = segment.trim()
  if (!trimmed) return false
  if (trimmed !== segment) return false
  if (FORBIDDEN_WIKI_TARGET_CHARS_RE.test(trimmed)) return false
  if (trimmed === '.' || trimmed === '..') return false
  if (trimmed.startsWith('.')) return false
  if (RESERVED_WIKI_TARGET_SEGMENTS.has(trimmed.toLowerCase())) return false
  return sanitizeFilename(trimmed).replace(/\.md$/i, '') === trimmed
}

function targetParts(target: string): { folder?: string; title: string } | null {
  const normalized = normalizeWikiTarget(target)
  if (!normalized) return null
  const parts = normalized.split('/')
  if (parts.some(part => !isSafeWikiTargetSegment(part))) return null
  const title = parts.pop()?.trim()
  if (!title) return null
  return { folder: parts.length > 0 ? parts.join('/') : undefined, title }
}

async function writeNewNoteFile(filePath: string, content: string): Promise<boolean> {
  let handle: Awaited<ReturnType<typeof open>> | null = null
  try {
    handle = await open(filePath, 'wx')
    await handle.writeFile(content, 'utf-8')
    return true
  } catch (error) {
    if (isErrnoException(error, 'EEXIST')) return false
    throw error
  } finally {
    await handle?.close()
  }
}

type CreatedLinkedNote = {
  id: string
  filePath: string
  content: string
}

async function createLinkedNote(notesRoot: string, target: string): Promise<CreatedLinkedNote | null> {
  const parts = targetParts(target)
  if (!parts) return null

  const folder = parts.folder ? assertSafeNoteId(parts.folder) : ''
  const dir = folder ? resolve(notesRoot, folder) : notesRoot
  await ensureSafeNoteDirectory(notesRoot, dir)

  const filePath = join(dir, safeNoteFilename(parts.title))
  const content = buildInitialNoteContent(parts.title)
  const didCreate = await writeNewNoteFile(filePath, content)
  if (!didCreate) return null
  return {
    id: noteIdFromRelativePath(relative(notesRoot, filePath)),
    filePath,
    content,
  }
}

function summarizeError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim()
  if (typeof error === 'string' && error.trim()) return error.trim()
  return 'unknown error'
}

function summarizeWikiTarget(target: string): string {
  const clean = target.replace(/\s+/g, ' ').trim()
  return clean.length > 120 ? `${clean.slice(0, 117)}...` : clean
}

async function rollbackCreatedLinkedNotes(created: CreatedLinkedNote[]): Promise<void> {
  const rollbackErrors: string[] = []
  for (const linkedNote of [...created].reverse()) {
    try {
      // Do not remove a target that another writer changed after we created it.
      if (await readFile(linkedNote.filePath, 'utf-8') === linkedNote.content) {
        await unlink(linkedNote.filePath)
      }
    } catch (error) {
      if (!isErrnoException(error, 'ENOENT')) rollbackErrors.push(summarizeError(error))
    }
  }
  if (rollbackErrors.length > 0) {
    throw new Error(`Could not roll back auto-created notes: ${rollbackErrors.join('; ')}`)
  }
}

async function autoCreateLinkedNotes(notesRoot: string, sourceLinks: NoteLink[]): Promise<CreatedLinkedNote[]> {
  const existingNotes = await listNotes(notesRoot)
  const created: CreatedLinkedNote[] = []
  const seen = new Set<string>()

  for (const link of sourceLinks) {
    const normalized = normalizeWikiTarget(link.target)
    if (!normalized) continue
    const key = normalized.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    if (existingNotes.some(note => noteMatchesTarget(note, normalized))) continue

    try {
      const note = await createLinkedNote(notesRoot, normalized)
      if (!note) continue
      created.push(note)
      existingNotes.push(await summarizeNote(notesRoot, note.filePath))
    } catch (error) {
      try {
        await rollbackCreatedLinkedNotes(created)
      } catch (rollbackError) {
        throw new Error(
          `Failed to auto-create note for wikilink "${summarizeWikiTarget(normalized)}": ${summarizeError(error)}; ${summarizeError(rollbackError)}`,
        )
      }
      throw new Error(
        `Failed to auto-create note for wikilink "${summarizeWikiTarget(normalized)}": ${summarizeError(error)}`,
      )
    }
  }

  return created
}

type PreparedNoteSave = {
  commit: () => Promise<NoteDocument>
  discard: () => Promise<void>
}

async function prepareNoteSave(notesRoot: string, noteId: string, content: string): Promise<PreparedNoteSave> {
  await ensureNotesDirs(notesRoot)
  const filePath = notePathFromId(notesRoot, noteId)
  await ensureSafeNoteDirectory(notesRoot, dirname(filePath))
  try {
    const info = await lstat(filePath)
    if (info.isSymbolicLink()) throw new Error('Invalid note path')
  } catch (error) {
    if (!isErrnoException(error, 'ENOENT')) throw error
  }

  const temporaryPath = join(
    dirname(filePath),
    `.${basename(filePath)}.${process.pid}.${randomUUID()}.save.tmp`,
  )
  if (!(await writeNewNoteFile(temporaryPath, content))) {
    throw new Error('Could not prepare note save')
  }

  let committed = false
  return {
    commit: async () => {
      try {
        const info = await lstat(filePath)
        if (info.isSymbolicLink()) throw new Error('Invalid note path')
      } catch (error) {
        if (!isErrnoException(error, 'ENOENT')) throw error
      }

      await rename(temporaryPath, filePath)
      committed = true
      // Record the exact mtime of our write so the watcher can recognize it as internal
      const { mtimeMs } = await stat(filePath)
      lastInternalMtime.set(filePath, mtimeMs)
      return readNote(notesRoot, noteId)
    },
    discard: async () => {
      if (!committed) await rm(temporaryPath, { force: true })
    },
  }
}

function replaceWikiTargets(content: string, oldTargets: Set<string>, newTarget: string): { content: string; replacements: number } {
  let replacements = 0
  const next = content.replace(/\[\[([^\]|#]+)(#[^\]|]*)?(\|[^\]]*)?\]\]/g, (full, target: string, heading = '', alias = '') => {
    if (!oldTargets.has(stripMdExtension(target.trim()).toLowerCase())) return full
    replacements++
    return `[[${newTarget}${heading}${alias}]]`
  })
  return { content: next, replacements }
}

async function getRenameImpact(notesRoot: string, noteId: string, nextTitle: string): Promise<NoteRenameImpact> {
  await ensureNotesDirs(notesRoot)
  const oldPath = notePathFromId(notesRoot, noteId)
  const oldSummary = await summarizeNote(notesRoot, oldPath)
  const newPath = join(dirname(oldPath), safeNoteFilename(nextTitle))
  if (oldPath !== newPath && existsSync(newPath)) throw new Error(`A note named "${nextTitle}" already exists`)

  const newId = noteIdFromRelativePath(relative(notesRoot, newPath))
  const newTarget = titleFromId(newId)
  const oldTargets = new Set([
    oldSummary.id,
    oldSummary.title,
    titleFromId(oldSummary.id),
  ].map(value => stripMdExtension(value).toLowerCase()))

  const updatedNotes: NoteRenameImpact['updatedNotes'] = []
  const files = await listMarkdownFiles(notesRoot)
  for (const file of files) {
    const content = await readFile(file, 'utf-8')
    const result = replaceWikiTargets(content, oldTargets, newTarget)
    if (result.replacements > 0) {
      const summary = await summarizeNote(notesRoot, file)
      updatedNotes.push({
        noteId: summary.id,
        title: summary.title,
        path: file,
        replacements: result.replacements,
      })
    }
  }

  return {
    noteId: oldSummary.id,
    nextNoteId: newId,
    nextTitle,
    updatedNotes,
    totalReplacements: updatedNotes.reduce((sum, note) => sum + note.replacements, 0),
  }
}

async function renameNote(notesRoot: string, noteId: string, nextTitle: string): Promise<{ note: NoteDocument; updatedNotes: Array<{ noteId: string; path: string; replacements: number }> }> {
  await ensureNotesDirs(notesRoot)
  const oldPath = notePathFromId(notesRoot, noteId)
  const oldSummary = await summarizeNote(notesRoot, oldPath)
  const newPath = join(dirname(oldPath), safeNoteFilename(nextTitle))
  if (oldPath !== newPath && existsSync(newPath)) throw new Error(`A note named "${nextTitle}" already exists`)

  if (oldPath !== newPath) {
    await rename(oldPath, newPath)
  }

  const newId = noteIdFromRelativePath(relative(notesRoot, newPath))
  await renameNoteCommentsForRoot(notesRoot, oldSummary.id, newId)
  const newTarget = titleFromId(newId)
  const renamedContent = await readFile(newPath, 'utf-8')
  await writeFile(newPath, updateFrontmatterTitle(renamedContent, nextTitle), 'utf-8')
  const oldTargets = new Set([
    oldSummary.id,
    oldSummary.title,
    titleFromId(oldSummary.id),
  ].map(value => stripMdExtension(value).toLowerCase()))

  const updatedNotes: Array<{ noteId: string; path: string; replacements: number }> = []
  const files = await listMarkdownFiles(notesRoot)
  for (const file of files) {
    const content = await readFile(file, 'utf-8')
    const result = replaceWikiTargets(content, oldTargets, newTarget)
    if (result.replacements > 0) {
      await writeFile(file, result.content, 'utf-8')
      updatedNotes.push({
        noteId: noteIdFromRelativePath(relative(notesRoot, file)),
        path: file,
        replacements: result.replacements,
      })
    }
  }

  return { note: await readNote(notesRoot, newId), updatedNotes }
}

async function updateNoteProperties(notesRoot: string, noteId: string, properties: Record<string, unknown>): Promise<NoteDocument> {
  await ensureNotesDirs(notesRoot)
  const filePath = notePathFromId(notesRoot, noteId)
  const content = await readFile(filePath, 'utf-8')
  await writeFile(filePath, updateFrontmatterProperties(content, properties), 'utf-8')
  return readNote(notesRoot, noteId)
}

function formatDateId(date: Date): string {
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function todayDateString(): string {
  const d = new Date()
  return formatDateId(d)
}

function assertDailyDate(date?: string): string {
  const value = date?.trim() || todayDateString()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Invalid daily note date')
  return value
}

function dailyId(date?: string): string {
  return `${DAILY_DIR}/${assertDailyDate(date)}`
}

function shiftDate(date: string, deltaDays: number): string {
  const [year, month, day] = date.split('-').map(Number)
  const d = new Date(year, month - 1, day)
  d.setDate(d.getDate() + deltaDays)
  return formatDateId(d)
}

async function buildDailyNoteContent(notesRoot: string, date: string): Promise<string> {
  const templatePath = join(notesRoot, TEMPLATES_DIR, DAILY_TEMPLATE_FILE)
  const fallback = [
    '---',
    'title: "{{date}}"',
    'tags:',
    '  - daily',
    '---',
    '',
    '# {{date}}',
    '',
  ].join('\n')
  const template = await readFile(templatePath, 'utf-8').catch(() => fallback)
  return template
    .replaceAll('{{date}}', date)
    .replaceAll('{{title}}', date)
    .replaceAll('{{yesterday}}', shiftDate(date, -1))
    .replaceAll('{{tomorrow}}', shiftDate(date, 1))
}

function mimeFromName(name: string): string {
  const ext = extname(name).toLowerCase()
  if (['.png'].includes(ext)) return 'image/png'
  if (['.jpg', '.jpeg'].includes(ext)) return 'image/jpeg'
  if (['.gif'].includes(ext)) return 'image/gif'
  if (['.webp'].includes(ext)) return 'image/webp'
  if (['.svg'].includes(ext)) return 'image/svg+xml'
  if (['.pdf'].includes(ext)) return 'application/pdf'
  if (['.md', '.txt'].includes(ext)) return 'text/plain'
  if (['.json'].includes(ext)) return 'application/json'
  return 'application/octet-stream'
}

function noteIdFromWatchFilename(filename: string | Buffer | null): string | undefined {
  if (!filename) return undefined
  const rel = toSlashPath(filename.toString())
  if (!rel || rel.startsWith('.') || rel.includes('/.') || rel.startsWith(`${ASSETS_DIR}/`) || rel.startsWith(`${TEMPLATES_DIR}/`)) return undefined
  if (!rel.toLowerCase().endsWith('.md')) return undefined
  return noteIdFromRelativePath(rel)
}

// Returns true if this file change was caused by our own writeFile() call.
// Compares current on-disk mtime against the mtime we recorded after writing.
async function isOwnWrite(filePath: string): Promise<boolean> {
  const recorded = lastInternalMtime.get(filePath)
  if (recorded === undefined) return false
  try {
    const { mtimeMs } = await stat(filePath)
    if (mtimeMs === recorded) {
      // Consume the record — a second watcher event for the same mtime is external
      lastInternalMtime.delete(filePath)
      return true
    }
  } catch {
    // File deleted or inaccessible — treat as external
  }
  return false
}

async function importAsset(
  notesRoot: string,
  attachment: FileAttachment,
  allowedRoots: string[],
): Promise<{ asset: { name: string; path: string; relativePath: string; size: number; mimeType: string }; markdown: string }> {
  await ensureNotesDirs(notesRoot)
  const assetsRoot = join(notesRoot, ASSETS_DIR)
  await mkdir(assetsRoot, { recursive: true })

  const safeName = sanitizeFilename(attachment.name || basename(attachment.path || 'asset'))
  let assetPath = join(assetsRoot, safeName)
  let suffix = 2
  const parsedExt = extname(safeName)
  const parsedBase = parsedExt ? safeName.slice(0, -parsedExt.length) : safeName
  while (existsSync(assetPath)) {
    assetPath = join(assetsRoot, `${parsedBase}-${suffix++}${parsedExt}`)
  }

  let buffer: Buffer
  if (attachment.base64) {
    buffer = Buffer.from(attachment.base64, 'base64')
  } else if (attachment.text != null) {
    buffer = Buffer.from(attachment.text, 'utf-8')
  } else {
    if (!attachment.path) throw new Error('Attachment is missing contents')
    const resolved = resolve(attachment.path)
    if (!allowedRoots.some(root => isInsidePath(root, resolved))) {
      throw new Error('Attachment path is outside the workspace')
    }
    buffer = await readFile(resolved)
  }

  await writeFile(assetPath, buffer)
  const relativePath = toSlashPath(relative(notesRoot, assetPath))
  const mimeType = attachment.mimeType || mimeFromName(assetPath)
  const isImage = mimeType.startsWith('image/')
  return {
    asset: {
      name: basename(assetPath),
      path: assetPath,
      relativePath,
      size: buffer.length,
      mimeType,
    },
    markdown: isImage ? `![${basename(assetPath)}](${relativePath})` : `[${basename(assetPath)}](${relativePath})`,
  }
}

async function listAssetFiles(dir: string, root = dir): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const files: string[] = []

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const abs = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...await listAssetFiles(abs, root))
    } else if (entry.isFile()) {
      files.push(abs)
    }
  }

  return files
}

function normalizeAssetRef(ref: string): string {
  try {
    return decodeURIComponent(ref.trim()).replace(/\\/g, '/').replace(/^\.\//, '')
  } catch {
    return ref.trim().replace(/\\/g, '/').replace(/^\.\//, '')
  }
}

function assetPathFromRelative(notesRoot: string, relativePath: string): string {
  const normalized = normalizeAssetRef(relativePath)
  if (!normalized.startsWith(`${ASSETS_DIR}/`) || normalized.includes('\0')) throw new Error('Invalid asset path')
  const resolved = resolve(notesRoot, normalized)
  const assetsRoot = resolve(notesRoot, ASSETS_DIR)
  if (!isInsidePath(assetsRoot, resolved)) throw new Error('Invalid asset path')
  return resolved
}

async function listAssets(notesRoot: string): Promise<NoteAsset[]> {
  await ensureNotesDirs(notesRoot)
  const assetsRoot = join(notesRoot, ASSETS_DIR)
  const [files, notes] = await Promise.all([
    listAssetFiles(assetsRoot, notesRoot),
    listNotes(notesRoot),
  ])

  const notesByAsset = new Map<string, Array<{ noteId: string; title: string }>>()
  for (const note of notes) {
    for (const ref of note.assetRefs) {
      const normalized = normalizeAssetRef(ref)
      const variants = new Set([normalized])
      if (!normalized.startsWith(`${ASSETS_DIR}/`)) variants.add(`${ASSETS_DIR}/${basename(normalized)}`)
      for (const variant of variants) {
        const entries = notesByAsset.get(variant) ?? []
        entries.push({ noteId: note.id, title: note.title })
        notesByAsset.set(variant, entries)
      }
    }
  }

  const assets = await Promise.all(files.map(async file => {
    const info = await stat(file)
    const relativePath = toSlashPath(relative(notesRoot, file))
    return {
      name: basename(file),
      path: file,
      relativePath,
      size: info.size,
      mimeType: mimeFromName(file),
      referencedBy: notesByAsset.get(relativePath) ?? [],
    }
  }))
  return assets.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
}

function replaceAssetTargets(content: string, oldRelativePath: string, newRelativePath: string): { content: string; replacements: number } {
  let replacements = 0
  const oldNormalized = normalizeAssetRef(oldRelativePath)
  const oldBasename = basename(oldNormalized)
  const next = content.replace(/(!?\[[^\]]*\]\()([^)]+)(\))/g, (full, prefix: string, ref: string, suffix: string) => {
    const normalizedRef = normalizeAssetRef(ref)
    const matches = normalizedRef === oldNormalized || normalizedRef === `./${oldNormalized}` || normalizedRef === oldBasename
    if (!matches) return full
    replacements++
    return `${prefix}${newRelativePath}${suffix}`
  })
  return { content: next, replacements }
}

async function deleteAsset(notesRoot: string, relativePath: string): Promise<boolean> {
  await ensureNotesDirs(notesRoot)
  const assetPath = assetPathFromRelative(notesRoot, relativePath)
  const assets = await listAssets(notesRoot)
  const asset = assets.find(item => item.relativePath === normalizeAssetRef(relativePath))
  if ((asset?.referencedBy?.length ?? 0) > 0) {
    throw new Error(`Asset is still referenced by ${asset?.referencedBy?.length} note${asset?.referencedBy?.length === 1 ? '' : 's'}`)
  }
  await unlink(assetPath)
  return true
}

async function renameAsset(notesRoot: string, relativePath: string, nextName: string): Promise<NoteAssetRenameResult> {
  await ensureNotesDirs(notesRoot)
  const oldPath = assetPathFromRelative(notesRoot, relativePath)
  const safeName = sanitizeFilename(nextName.trim() || basename(oldPath))
  if (!safeName) throw new Error('Invalid asset name')
  const newPath = join(dirname(oldPath), safeName)
  if (!isInsidePath(resolve(notesRoot, ASSETS_DIR), newPath)) throw new Error('Invalid asset path')
  if (newPath !== oldPath && existsSync(newPath)) throw new Error(`An asset named "${safeName}" already exists`)

  if (newPath !== oldPath) {
    await rename(oldPath, newPath)
  }

  const oldRelativePath = normalizeAssetRef(relativePath)
  const newRelativePath = toSlashPath(relative(notesRoot, newPath))
  const updatedNotes: NoteAssetRenameResult['updatedNotes'] = []
  const files = await listMarkdownFiles(notesRoot)
  for (const file of files) {
    const content = await readFile(file, 'utf-8')
    const result = replaceAssetTargets(content, oldRelativePath, newRelativePath)
    if (result.replacements > 0) {
      await writeFile(file, result.content, 'utf-8')
      updatedNotes.push({
        noteId: noteIdFromRelativePath(relative(notesRoot, file)),
        path: file,
        replacements: result.replacements,
      })
    }
  }

  const info = await stat(newPath)
  return {
    asset: {
      name: basename(newPath),
      path: newPath,
      relativePath: newRelativePath,
      size: info.size,
      mimeType: mimeFromName(newPath),
      referencedBy: (await listAssets(notesRoot)).find(item => item.relativePath === newRelativePath)?.referencedBy ?? [],
    },
    updatedNotes,
  }
}

async function renameFolder(notesRoot: string, folder: string, nextName: string): Promise<{ movedNotes: string[] }> {
  await ensureNotesDirs(notesRoot)
  const safeFolder = assertSafeNoteId(folder)
  const oldDir = resolve(notesRoot, safeFolder)
  if (!isInsidePath(notesRoot, oldDir)) throw new Error('Invalid folder path')
  if (!existsSync(oldDir)) throw new Error(`Folder not found: ${folder}`)

  const parentDir = dirname(oldDir)
  const safeName = sanitizeFilename(nextName.trim() || basename(oldDir))
  const newDir = join(parentDir, safeName)
  if (!isInsidePath(notesRoot, newDir)) throw new Error('Invalid target folder path')
  if (newDir !== oldDir && existsSync(newDir)) throw new Error(`A folder named "${safeName}" already exists`)

  const oldPrefix = toSlashPath(relative(notesRoot, oldDir))
  const newPrefix = toSlashPath(relative(notesRoot, newDir))

  const oldTargetsByNote = new Map<string, Set<string>>()
  const allFiles = await listMarkdownFiles(notesRoot)
  for (const file of allFiles) {
    const rel = toSlashPath(relative(notesRoot, file))
    if (rel.startsWith(`${oldPrefix}/`) || rel === `${oldPrefix}.md`) {
      const content = await readFile(file, 'utf-8')
      const parsed = parseNoteContent(content)
      const targets = new Set([
        noteIdFromRelativePath(rel),
        ...parsed.links.map(l => l.target),
      ])
      oldTargetsByNote.set(file, targets)
    }
  }

  if (newDir !== oldDir) {
    await rename(oldDir, newDir)
  }

  const newFiles = await listMarkdownFiles(newDir, notesRoot)
  const movedNotes: string[] = []
  for (const file of newFiles) {
    const newRel = toSlashPath(relative(notesRoot, file))
    const oldRel = newRel.replace(newPrefix, oldPrefix)
    const oldId = noteIdFromRelativePath(oldRel)
    const newId = noteIdFromRelativePath(newRel)
    movedNotes.push(newId)
    await renameNoteCommentsForRoot(notesRoot, oldId, newId)

    const oldTargets = new Set([
      oldId,
      titleFromId(oldId),
      basename(oldId),
    ].map(v => stripMdExtension(v).toLowerCase()))

    for (const otherFile of allFiles) {
      if (newFiles.includes(otherFile)) continue
      const content = await readFile(otherFile, 'utf-8').catch(() => '')
      const result = replaceWikiTargets(content, oldTargets, titleFromId(newId))
      if (result.replacements > 0) {
        await writeFile(otherFile, result.content, 'utf-8')
      }
    }
  }

  return { movedNotes }
}

async function deleteFolder(notesRoot: string, folder: string): Promise<{ deletedNotes: string[] }> {
  await ensureNotesDirs(notesRoot)
  const safeFolder = assertSafeNoteId(folder)
  const dir = resolve(notesRoot, safeFolder)
  if (!isInsidePath(notesRoot, dir)) throw new Error('Invalid folder path')
  if (!existsSync(dir)) throw new Error(`Folder not found: ${folder}`)

  const files = await listMarkdownFiles(dir, notesRoot)
  const deletedNotes = files.map(f => noteIdFromRelativePath(relative(notesRoot, f)))

  await rm(dir, { recursive: true, force: true })
  await Promise.all(deletedNotes.map(noteId => deleteNoteCommentsForRoot(notesRoot, noteId)))
  return { deletedNotes }
}

export function registerNotesHandlers(server: RpcServer, _deps: HandlerDeps): void {
  const changed = (payload: NoteChangedPayload, target: { to: 'workspace'; workspaceId: string } | { to: 'client'; clientId: string } = { to: 'workspace', workspaceId: payload.workspaceId }) => {
    pushTyped(server, RPC_CHANNELS.notes.CHANGED, target, payload)
  }

  server.handle(RPC_CHANNELS.notes.LIST, async (_ctx, workspaceId: string) => {
    return listNotes(getWorkspaceNotesRoot(workspaceId))
  })

  server.handle(RPC_CHANNELS.notes.READ, async (_ctx, workspaceId: string, noteId: string) => {
    return readNote(getWorkspaceNotesRoot(workspaceId), noteId)
  })

  server.handle(RPC_CHANNELS.notes.SAVE, async (_ctx, workspaceId: string, noteId: string, content: string) => {
    const notesRoot = getWorkspaceNotesRoot(workspaceId)
    let previousLinkCount = 0
    try {
      const existing = await readNote(notesRoot, noteId)
      previousLinkCount = existing.links?.length ?? 0
    } catch {
      // new / unreadable note — treat as zero prior links
    }

    const preparedSave = await prepareNoteSave(notesRoot, noteId, content)
    const sourceLinks = parseNoteContent(content).links
    let autoCreated: CreatedLinkedNote[] = []
    try {
      autoCreated = await autoCreateLinkedNotes(notesRoot, sourceLinks)
      const note = await preparedSave.commit()
      const autoCreatedNoteIds = autoCreated.map(created => created.id)
      for (const created of autoCreated) {
        changed({ workspaceId, reason: 'create', noteId: created.id })
      }
      const nextLinkCount = note.links?.length ?? 0
      if (nextLinkCount > previousLinkCount) {
        awardXpSafe('note_linked')
      }
      changed({ workspaceId, reason: 'save', noteId: note.id })
      return { ...note, autoCreatedNoteIds }
    } catch (error) {
      try {
        await rollbackCreatedLinkedNotes(autoCreated)
      } catch (rollbackError) {
        throw new Error(`${summarizeError(error)}; ${summarizeError(rollbackError)}`)
      }
      throw error
    } finally {
      await preparedSave.discard()
    }
  })

  server.handle(RPC_CHANNELS.notes.CREATE, async (_ctx, workspaceId: string, title: string, folder?: string) => {
    const note = await createNote(getWorkspaceNotesRoot(workspaceId), title, folder)
    changed({ workspaceId, reason: 'create', noteId: note.id })
    return note
  })

  server.handle(RPC_CHANNELS.notes.RENAME, async (_ctx, workspaceId: string, noteId: string, nextTitle: string) => {
    const result = await renameNote(getWorkspaceNotesRoot(workspaceId), noteId, nextTitle)
    changed({ workspaceId, reason: 'rename', noteId: result.note.id })
    return result
  })

  server.handle(RPC_CHANNELS.notes.DELETE, async (_ctx, workspaceId: string, noteId: string) => {
    const notesRoot = getWorkspaceNotesRoot(workspaceId)
    await ensureNotesDirs(notesRoot)
    await unlink(notePathFromId(notesRoot, noteId))
    await deleteNoteCommentsForRoot(notesRoot, noteId)
    changed({ workspaceId, reason: 'delete', noteId })
    return true
  })

  server.handle(RPC_CHANNELS.notes.LIST_COMMENTS, async (_ctx, workspaceId: string, noteId: string) => {
    return listNoteCommentsForRoot(getWorkspaceNotesRoot(workspaceId), noteId)
  })

  server.handle(RPC_CHANNELS.notes.CREATE_COMMENT, async (_ctx, workspaceId: string, input: CreateNoteCommentInput) => {
    const comment = await createNoteCommentForRoot(getWorkspaceNotesRoot(workspaceId), input)
    changed({ workspaceId, reason: 'comments', noteId: comment.noteId })
    return comment
  })

  server.handle(RPC_CHANNELS.notes.UPDATE_COMMENT, async (_ctx, workspaceId: string, input: UpdateNoteCommentInput) => {
    const comment = await updateNoteCommentForRoot(getWorkspaceNotesRoot(workspaceId), input)
    changed({ workspaceId, reason: 'comments', noteId: comment.noteId })
    return comment
  })

  server.handle(RPC_CHANNELS.notes.DELETE_COMMENT, async (_ctx, workspaceId: string, noteId: string, commentId: string) => {
    await deleteNoteCommentForRoot(getWorkspaceNotesRoot(workspaceId), noteId, commentId)
    changed({ workspaceId, reason: 'comments', noteId })
    return true
  })

  server.handle(RPC_CHANNELS.notes.RENAME_FOLDER, async (_ctx, workspaceId: string, folder: string, nextName: string) => {
    const result = await renameFolder(getWorkspaceNotesRoot(workspaceId), folder, nextName)
    changed({ workspaceId, reason: 'rename' })
    return result
  })

  server.handle(RPC_CHANNELS.notes.DELETE_FOLDER, async (_ctx, workspaceId: string, folder: string) => {
    const result = await deleteFolder(getWorkspaceNotesRoot(workspaceId), folder)
    changed({ workspaceId, reason: 'delete' })
    return result
  })

  server.handle(RPC_CHANNELS.notes.SEARCH, async (_ctx, workspaceId: string, query: string) => {
    const notesRoot = getWorkspaceNotesRoot(workspaceId)
    const notes = await listNotes(notesRoot)
    const q = query.trim().toLowerCase()
    if (!q) return notes
    await ensureNotesDirs(notesRoot)

    const results = await Promise.allSettled(
      notes.map(async note => {
        if (note.title.toLowerCase().includes(q) || note.tags.some(tag => tag.toLowerCase().includes(q))) {
          return note
        }
        const content = await readFile(join(notesRoot, note.relativePath), 'utf-8').catch(() => '')
        return content.toLowerCase().includes(q) ? note : null
      })
    )

    return results
      .filter((r): r is PromiseFulfilledResult<NoteSummary> => r.status === 'fulfilled' && r.value !== null)
      .map(r => r.value)
  })

  server.handle(RPC_CHANNELS.notes.GET_BACKLINKS, async (_ctx, workspaceId: string, noteId: string) => {
    return getBacklinks(getWorkspaceNotesRoot(workspaceId), noteId)
  })

  server.handle(RPC_CHANNELS.notes.GET_RENAME_IMPACT, async (_ctx, workspaceId: string, noteId: string, nextTitle: string) => {
    return getRenameImpact(getWorkspaceNotesRoot(workspaceId), noteId, nextTitle)
  })

  server.handle(RPC_CHANNELS.notes.GET_DAILY_NOTE, async (_ctx, workspaceId: string, date?: string) => {
    const notesRoot = getWorkspaceNotesRoot(workspaceId)
    const dailyDate = assertDailyDate(date)
    const id = dailyId(dailyDate)
    await ensureNotesDirs(notesRoot)
    const filePath = notePathFromId(notesRoot, id)
    if (!existsSync(filePath)) {
      await mkdir(dirname(filePath), { recursive: true })
      await writeFile(filePath, await buildDailyNoteContent(notesRoot, dailyDate), 'utf-8')
      changed({ workspaceId, reason: 'create', noteId: id })
    }
    return readNote(notesRoot, id)
  })

  server.handle(RPC_CHANNELS.notes.IMPORT_ASSET, async (_ctx, workspaceId: string, attachment: FileAttachment) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
    const notesRoot = getWorkspaceNotesRoot(workspaceId)
    const result = await importAsset(notesRoot, attachment, [notesRoot, workspace.rootPath])
    changed({ workspaceId, reason: 'asset' })
    return result
  })

  server.handle(RPC_CHANNELS.notes.LIST_ASSETS, async (_ctx, workspaceId: string) => {
    return listAssets(getWorkspaceNotesRoot(workspaceId))
  })

  server.handle(RPC_CHANNELS.notes.DELETE_ASSET, async (_ctx, workspaceId: string, relativePath: string) => {
    const result = await deleteAsset(getWorkspaceNotesRoot(workspaceId), relativePath)
    changed({ workspaceId, reason: 'asset' })
    return result
  })

  server.handle(RPC_CHANNELS.notes.RENAME_ASSET, async (_ctx, workspaceId: string, relativePath: string, nextName: string) => {
    const result = await renameAsset(getWorkspaceNotesRoot(workspaceId), relativePath, nextName)
    changed({ workspaceId, reason: 'asset' })
    return result
  })

  server.handle(RPC_CHANNELS.notes.UPDATE_PROPERTIES, async (_ctx, workspaceId: string, noteId: string, properties: Record<string, unknown>) => {
    const note = await updateNoteProperties(getWorkspaceNotesRoot(workspaceId), noteId, properties)
    changed({ workspaceId, reason: 'properties', noteId: note.id })
    return note
  })

  server.handle(RPC_CHANNELS.notes.WATCH, async (ctx, workspaceId: string) => {
    const clientId = ctx.clientId
    cleanupNotesWatchForClient(clientId)
    const notesRoot = getWorkspaceNotesRoot(workspaceId)
    await ensureNotesDirs(notesRoot)

    try {
      const { watch } = await import('fs')
      const state: ClientNotesWatchState = {
        watcher: null as unknown as import('fs').FSWatcher,
        workspaceId,
        debounceTimer: null,
      }

      state.watcher = watch(notesRoot, { recursive: true }, (_eventType, filename) => {
        const noteId = noteIdFromWatchFilename(filename)
        if (filename && !noteId) return

        // Resolve absolute path for mtime comparison (filename is relative to watched dir)
        const absPath = filename ? join(notesRoot, filename.toString()) : null

        if (state.debounceTimer) clearTimeout(state.debounceTimer)
        state.debounceTimer = setTimeout(async () => {
          if (absPath && await isOwnWrite(absPath)) return
          changed({ workspaceId, reason: 'external', noteId }, { to: 'client', clientId })
        }, 50)
      })

      clientNotesWatches.set(clientId, state)
    } catch (error) {
      throw new Error(`Failed to watch notes: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

  server.handle(RPC_CHANNELS.notes.UNWATCH, async (ctx) => {
    cleanupNotesWatchForClient(ctx.clientId)
  })
}
