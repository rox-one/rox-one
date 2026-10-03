import { open, realpath, lstat, mkdir, readdir, readFile, rename, rm, stat, unlink, writeFile } from 'fs/promises'
import { existsSync, constants } from 'fs'
import { createHash } from 'node:crypto'
import { basename, dirname, extname, join, relative, resolve, sep } from 'path'
import { getWorkspaceByNameOrId, isImportProvenancedRelativePath } from '@craft-agent/shared/config'
import { getDefaultWorkspacesDir } from '@craft-agent/shared/workspaces'
import { loadWorkspaceConfig } from '@craft-agent/shared/workspaces'
import matter from 'gray-matter'
import yaml from 'js-yaml'
import { RPC_CHANNELS, type FileAttachment, type NoteAsset, type NoteAssetRenameResult, type NoteBacklink, type NoteChangedPayload, type NoteDocument, type NoteIndexHealth, type NoteLink, type NoteMutationOptions, type NoteRenameImpact, type NoteSummary } from '@craft-agent/shared/protocol'
import type { NativeReplicaCreatePlan } from '@craft-agent/shared/protocol/native-replica'
import { pushTyped, type RpcServer, type RequestContext } from '@craft-agent/server-core/transport'
import { sanitizeFilename } from '@craft-agent/server-core/handlers'
import type { HandlerDeps } from '../handler-deps'
import type { NativePrincipal } from '../../authority/native-authority.ts'
import type { JournalEntitySnapshot, JournalReceipt } from '../../authority/native-journal.ts'
import { registerContentHandlers, CONTENT_HANDLED_CHANNELS } from './content.ts'
import { markdownRevision, type MarkdownChangedEvent, type NativeMarkdownChange, type NativeFolderSnapshot } from '../../docs/markdown-commit.ts'

type NativeNoteWriter = (reason: MarkdownChangedEvent['reason'], changes: NativeMarkdownChange[]) => Promise<unknown>
type NativeFolderReader = (folder: string) => Promise<NativeFolderSnapshot | null>
import { CodedError } from '@craft-agent/shared/protocol'
import { previewPropertyDictionary } from '@craft-agent/core/docs'
import { parseRox2EntityId } from '@craft-agent/core/rox2'
import { createDescriptorResolver, FileDescriptorStore, type ContentOwner, type ContentPolicy } from '../../docs/descriptor-resolver.ts'
import { awardXpSafe } from '@craft-agent/shared/gamification'
import { awardNativeXpAndBroadcast } from './gamification'
import {
  contentHash,
  isClaimableLive,
  rpcNotesActResult,
  rpcNotesListResult,
  rpcNotesReadResult,
} from '@craft-agent/core/rox2'
import {
  applyVaultWatchTick,
  ensureVaultIndex,
  getVaultBacklinks,
  getVaultInsights,
  isVaultIndexAvailable,
  listVaultDocuments,
  queryVaultDocuments,
  rebuildVaultIndex,
  VAULT_WATCH_DEBOUNCE_MS,
  vaultIndexHealth,
  vaultWatchNoteIdFromFilename,
  type VaultBacklink,
  type VaultDocumentSummary,
  type VaultWikiLink,
} from '../../knowledge/vault-index.ts'
import {
  assertDailyDate,
  buildDailyNoteMarkdown,
  datesToEnsure,
  dailyNoteId,
  DAILY_FOLDER,
  formatDateId,
  INSTALL_DAY_FILE,
  mergeSessionsBlock,
  sessionsForDate,
  type DailySessionRef,
} from '../../knowledge/daily-notes.ts'

export const HANDLED_CHANNELS = [
  ...CONTENT_HANDLED_CHANNELS,
  RPC_CHANNELS.notes.LIST,
  RPC_CHANNELS.notes.READ,
  RPC_CHANNELS.notes.SAVE,
  RPC_CHANNELS.notes.CREATE,
  RPC_CHANNELS.notes.PREPARE_CREATE,
  RPC_CHANNELS.notes.RENAME,
  RPC_CHANNELS.notes.MOVE,
  RPC_CHANNELS.notes.DELETE,
  RPC_CHANNELS.notes.RENAME_FOLDER,
  RPC_CHANNELS.notes.DELETE_FOLDER,
  RPC_CHANNELS.notes.SEARCH,
  RPC_CHANNELS.notes.GET_BACKLINKS,
  RPC_CHANNELS.notes.GET_INSIGHTS,
  RPC_CHANNELS.notes.GET_INDEX_HEALTH,
  RPC_CHANNELS.notes.GET_RENAME_IMPACT,
  RPC_CHANNELS.notes.GET_DAILY_NOTE,
  RPC_CHANNELS.notes.IMPORT_ASSET,
  RPC_CHANNELS.notes.LIST_ASSETS,
  RPC_CHANNELS.notes.DELETE_ASSET,
  RPC_CHANNELS.notes.RENAME_ASSET,
  RPC_CHANNELS.notes.UPDATE_PROPERTIES,
  RPC_CHANNELS.notes.REBUILD_INDEX,
  RPC_CHANNELS.notes.WATCH,
  RPC_CHANNELS.notes.UNWATCH,
] as const

const NOTES_DIR = 'notes'
const ASSETS_DIR = 'assets'
const DAILY_DIR = DAILY_FOLDER
const TEMPLATES_DIR = 'templates'
const PROJECTS_DIR = 'projects'
const DAILY_TEMPLATE_FILE = 'daily.md'

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
  lastExternalChangeAt: number | null
  pendingFilenames: Array<string | Buffer | null>
  detachAuthority?: () => void
}

const clientNotesWatches = new Map<string, ClientNotesWatchState>()
const lastExternalChangeByWorkspace = new Map<string, number>()
// noteFilePath → mtime recorded immediately after our own writeFile()
// If watcher fires and stat() mtime matches, it's our own write — suppress it.
const lastInternalMtime = new Map<string, number>()

export function cleanupNotesWatchForClient(clientId: string): void {
  const state = clientNotesWatches.get(clientId)
  if (!state) return

  if (state.debounceTimer) {
    clearTimeout(state.debounceTimer)
    state.debounceTimer = null
  }
  state.watcher.close()
  state.detachAuthority?.()
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

function noteIdFromRelativePath(relativePath: string): string {
  return stripMdExtension(toSlashPath(relativePath))
}

function assertSafeNoteId(noteId: string): string {
  if (!noteId || noteId.startsWith('/') || noteId.includes('\\') || noteId.split('/').some(part => part === '..' || part === '')) {
    throw new Error('Invalid note id')
  }
  const safe = stripMdExtension(noteId).replace(/^\/+/, '')
  if (isImportProvenancedRelativePath(safe)) {
    throw new Error('LOCAL_ONLY')
  }
  return safe
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

function isInsidePath(root: string, candidate: string): boolean {
  const normalizedRoot = resolve(root)
  const normalizedCandidate = resolve(candidate)
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}${sep}`)
}

async function listMarkdownFiles(dir: string, root = dir): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const files: string[] = []

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const abs = join(dir, entry.name)
    const rel = toSlashPath(relative(root, abs))
    if (isImportProvenancedRelativePath(rel)) continue
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

function wikiLinksToNoteLinks(links: VaultWikiLink[]): NoteLink[] {
  return links.map(link => ({
    target: link.target,
    ...(link.alias ? { alias: link.alias } : {}),
    line: link.line,
  }))
}

function summaryFromVaultDoc(notesRoot: string, doc: VaultDocumentSummary): NoteSummary {
  return {
    id: doc.id,
    title: doc.title,
    path: join(notesRoot, doc.relativePath),
    relativePath: doc.relativePath,
    tags: doc.tags,
    properties: doc.properties,
    links: wikiLinksToNoteLinks(doc.links),
    assetRefs: doc.assetRefs,
    updatedAt: doc.updatedAt,
    createdAt: doc.createdAt,
    size: doc.size,
  }
}

function backlinkFromVault(notesRoot: string, item: VaultBacklink): NoteBacklink {
  return {
    noteId: item.noteId,
    title: item.title,
    path: join(notesRoot, item.relativePath),
    line: item.line,
    preview: item.preview,
  }
}

function tryListFromVaultIndex(notesRoot: string): NoteSummary[] | null {
  if (!isVaultIndexAvailable()) return null
  try {
    const result = ensureVaultIndex(notesRoot)
    if (!result.ok) return null
    return listVaultDocuments(notesRoot).map(doc => summaryFromVaultDoc(notesRoot, doc))
  } catch {
    return null
  }
}

function tryQueryFromVaultIndex(notesRoot: string, query: string): NoteSummary[] | null {
  if (!isVaultIndexAvailable()) return null
  try {
    const result = ensureVaultIndex(notesRoot)
    if (!result.ok) return null
    return queryVaultDocuments(notesRoot, query).map(doc => summaryFromVaultDoc(notesRoot, doc))
  } catch {
    return null
  }
}

function tryBacklinksFromVaultIndex(notesRoot: string, noteId: string): NoteBacklink[] | null {
  if (!isVaultIndexAvailable()) return null
  try {
    const result = ensureVaultIndex(notesRoot)
    if (!result.ok) return null
    return getVaultBacklinks(notesRoot, noteId).map(item => backlinkFromVault(notesRoot, item))
  } catch {
    return null
  }
}

function emptyIndexHealth(): NoteIndexHealth {
  return {
    ok: false,
    available: isVaultIndexAvailable(),
    dbPath: '',
    schemaVersion: null,
    documentCount: 0,
    recovered: false,
    indexed: 0,
    unchanged: 0,
    skipped: 0,
    truncated: false,
    watching: false,
    lastExternalChangeAt: null,
  }
}

function indexHealthForWorkspace(workspaceId: string): NoteIndexHealth {
  const notesRoot = getWorkspaceNotesRoot(workspaceId)
  const health = vaultIndexHealth(notesRoot)
  const watching = [...clientNotesWatches.values()].some((state) => state.workspaceId === workspaceId)
  return {
    ...health,
    watching,
    lastExternalChangeAt: lastExternalChangeByWorkspace.get(workspaceId) ?? null,
  }
}

function refreshVaultIndex(notesRoot: string): void {
  if (!isVaultIndexAvailable()) return
  try {
    ensureVaultIndex(notesRoot)
  } catch {
    /* projection only — Markdown remains canonical */
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
    createdAt: info.birthtimeMs,
    size: info.size,
  }
}

async function listNotes(notesRoot: string): Promise<NoteSummary[]> {
  await ensureNotesDirs(notesRoot)
  const indexed = tryListFromVaultIndex(notesRoot)
  if (indexed) return indexed
  const files = await listMarkdownFiles(notesRoot)
  const notes = await Promise.all(files.map(file => summarizeNote(notesRoot, file)))
  notes.sort((a, b) => b.updatedAt - a.updatedAt || a.title.localeCompare(b.title))
  return notes
}

function noteMatchesTarget(note: Pick<NoteSummary, 'id' | 'title'>, target: string): boolean {
  const normalized = stripMdExtension(target.trim()).toLowerCase()
  return normalized === note.id.toLowerCase()
    || normalized === note.title.toLowerCase()
    || normalized === titleFromId(note.id).toLowerCase()
}

async function getBacklinks(notesRoot: string, noteId: string): Promise<NoteBacklink[]> {
  await ensureNotesDirs(notesRoot)
  const indexed = tryBacklinksFromVaultIndex(notesRoot, noteId)
  if (indexed) return indexed
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
  const canonicalRoot = await realpath(notesRoot)
  if (await realpath(filePath) !== resolve(canonicalRoot, `${assertSafeNoteId(noteId)}.md`)) throw new CodedError('AUTH_FAILED', 'Document symlink access denied')
  const handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW)
  const bytes = await handle.readFile().finally(() => handle.close())
  let body: string
  try { body = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) }
  catch { throw new CodedError('DOCUMENT_AUTHORITY_CHANGED', 'Invalid UTF-8 source; preserve the original bytes') }
  const [summary, content, backlinks] = await Promise.all([
    summarizeNote(notesRoot, filePath),
    Promise.resolve(body),
    getBacklinks(notesRoot, assertSafeNoteId(noteId)),
  ])
  return { ...summary, content, backlinks, revision: markdownRevision(content) }
}

function buildInitialNoteContent(title: string): string {
  return stringifyNoteContent('', { title, tags: [] })
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

async function createNote(notesRoot: string, title: string, writeNative: NativeNoteWriter, folder?: string): Promise<NoteDocument> {
  await ensureNotesDirs(notesRoot)
  const safeFolder = folder ? assertSafeNoteId(folder) : ''
  const dir = safeFolder ? resolve(notesRoot, safeFolder) : notesRoot
  if (!dir.startsWith(resolve(notesRoot))) throw new Error('Invalid note folder')
  await mkdir(dir, { recursive: true })

  let filePath = join(dir, safeNoteFilename(title))
  let suffix = 2
  while (existsSync(filePath)) {
    filePath = join(dir, `${sanitizeFilename(title || 'Untitled')}-${suffix++}.md`)
  }
  await writeNative('create', [{ kind: 'write', noteId: noteIdFromRelativePath(relative(notesRoot, filePath)), expectedRevision: null, content: buildInitialNoteContent(title || 'Untitled') }])
  return readNote(notesRoot, noteIdFromRelativePath(relative(notesRoot, filePath)))
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

async function renameNote(notesRoot: string, noteId: string, nextTitle: string, writeNative: NativeNoteWriter): Promise<{ note: NoteDocument; updatedNotes: Array<{ noteId: string; path: string; replacements: number }> }> {
  await ensureNotesDirs(notesRoot)
  const oldPath = notePathFromId(notesRoot, noteId)
  const oldSummary = await summarizeNote(notesRoot, oldPath)
  const newPath = join(dirname(oldPath), safeNoteFilename(nextTitle))
  if (oldPath !== newPath && existsSync(newPath)) throw new Error('A note with the requested title already exists')
  const newId = noteIdFromRelativePath(relative(notesRoot, newPath))
  const originalContent = await readFile(oldPath, 'utf-8')
  const oldTargets = new Set([oldSummary.id, oldSummary.title, titleFromId(oldSummary.id)].map(value => stripMdExtension(value).toLowerCase()))
  const changes: NativeMarkdownChange[] = []
  if (oldPath !== newPath) changes.push({ kind: 'move', noteId, targetNoteId: newId, expectedRevision: markdownRevision(originalContent) })
  const updatedNotes: Array<{ noteId: string; path: string; replacements: number }> = []
  for (const file of await listMarkdownFiles(notesRoot)) {
    const content = file === oldPath ? originalContent : await readFile(file, 'utf-8')
    const titled = file === oldPath ? updateFrontmatterTitle(content, nextTitle) : content
    const result = replaceWikiTargets(titled, oldTargets, titleFromId(newId))
    const targetId = file === oldPath ? newId : noteIdFromRelativePath(relative(notesRoot, file))
    if (result.content !== content) changes.push({ kind: 'write', noteId: targetId, expectedRevision: markdownRevision(content), content: result.content })
    if (result.replacements > 0) updatedNotes.push({ noteId: targetId, path: file === oldPath ? newPath : file, replacements: result.replacements })
  }
  if (changes.length > 0) await writeNative('rename', changes)
  return { note: await readNote(notesRoot, newId), updatedNotes }
}

async function readInstallDay(notesRoot: string, now = new Date()): Promise<string> {
  const marker = join(notesRoot, INSTALL_DAY_FILE)
  if (existsSync(marker)) {
    const stored = (await readFile(marker, 'utf-8')).trim()
    if (/^\d{4}-\d{2}-\d{2}$/.test(stored)) return stored
  }
  const today = formatDateId(now)
  await writeFile(marker, `${today}\n`, 'utf-8')
  return today
}

async function upsertDailyNote(
  notesRoot: string,
  date: string,
  sessions: readonly DailySessionRef[],
  writeNative: NativeNoteWriter,
): Promise<string> {
  const dailyDate = assertDailyDate(date)
  const id = dailyNoteId(dailyDate)
  const filePath = notePathFromId(notesRoot, id)
  await mkdir(dirname(filePath), { recursive: true })
  const daySessions = sessionsForDate(sessions, dailyDate)
  if (!existsSync(filePath)) {
    const templatePath = join(notesRoot, TEMPLATES_DIR, DAILY_TEMPLATE_FILE)
    const template = await readFile(templatePath, 'utf-8').catch(() => '')
    await writeNative('create', [{ kind: 'write', noteId: id, expectedRevision: null, content: buildDailyNoteMarkdown({ date: dailyDate, sessions: daySessions, template }) }])
    return id
  }
  const existing = await readFile(filePath, 'utf-8')
  const next = mergeSessionsBlock(existing, daySessions)
  if (next !== existing) await writeNative('save', [{ kind: 'write', noteId: id, expectedRevision: markdownRevision(existing), content: next }])
  return id
}

async function ensureDailyNotes(notesRoot: string, sessions: readonly DailySessionRef[], writeNative: NativeNoteWriter, now = new Date()): Promise<void> {
  await ensureNotesDirs(notesRoot)
  const today = formatDateId(now)
  const install = await readInstallDay(notesRoot, now)
  for (const date of datesToEnsure(install, today)) {
    await upsertDailyNote(notesRoot, date, sessions, writeNative)
  }
}

function sessionsFromDeps(deps: HandlerDeps, workspaceId: string): DailySessionRef[] {
  try {
    return deps.sessionManager.getSessions(workspaceId).map((session) => ({
      id: session.id,
      name: session.name?.trim() || session.preview?.trim() || session.id,
      createdAt: session.createdAt,
      lastMessageAt: session.lastMessageAt,
    }))
  } catch {
    return []
  }
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
  return vaultWatchNoteIdFromFilename(filename)
}

// Returns true if this file change was caused by our own writeFile() call.
// Compares current on-disk mtime against the mtime we recorded after writing.
async function isOwnWrite(filePath: string): Promise<boolean> {
  const recorded = lastInternalMtime.get(filePath)
  if (recorded === undefined) return false
  try {
    const { mtimeMs } = await stat(filePath)
    if (mtimeMs === recorded) {
      // fs.watch may report the same native publication several times. Keep
      // its version until the file changes so duplicate events cannot reopen it.
      return true
    }
    lastInternalMtime.delete(filePath)
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
    const rel = toSlashPath(relative(root, abs))
    if (isImportProvenancedRelativePath(rel)) continue
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

async function renameAsset(notesRoot: string, relativePath: string, nextName: string, writeNative: NativeNoteWriter): Promise<NoteAssetRenameResult> {
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
  const changes: NativeMarkdownChange[] = []
  const files = await listMarkdownFiles(notesRoot)
  for (const file of files) {
    const content = await readFile(file, 'utf-8')
    const result = replaceAssetTargets(content, oldRelativePath, newRelativePath)
    if (result.replacements > 0) {
      changes.push({ kind: 'write', noteId: noteIdFromRelativePath(relative(notesRoot, file)), expectedRevision: markdownRevision(content), content: result.content })
      updatedNotes.push({
        noteId: noteIdFromRelativePath(relative(notesRoot, file)),
        path: file,
        replacements: result.replacements,
      })
    }
  }

  if (changes.length > 0) await writeNative('asset', changes)
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

async function renameFolder(notesRoot: string, folder: string, nextName: string, writeNative: NativeNoteWriter, readFolder: NativeFolderReader): Promise<{ movedNotes: string[] }> {
  await ensureNotesDirs(notesRoot)
  const oldPrefix = assertSafeNoteId(folder)
  const oldDir = resolve(notesRoot, oldPrefix)
  const newDir = join(dirname(oldDir), sanitizeFilename(nextName.trim() || basename(oldDir)))
  if (!isInsidePath(notesRoot, newDir)) throw new Error('Invalid target folder path')
  if (newDir === oldDir) return { movedNotes: (await listMarkdownFiles(oldDir, notesRoot)).map(file => noteIdFromRelativePath(relative(notesRoot, file))) }
  if (existsSync(newDir)) throw new Error('A folder with the requested name already exists')
  const newPrefix = toSlashPath(relative(notesRoot, newDir))
  const snapshot = await readFolder(oldPrefix)
  if (!snapshot) throw new Error('Folder not found')
  const movedNotes = snapshot.noteIds.map(id => newPrefix + '/' + id.slice(oldPrefix.length + 1))
  const changes: NativeMarkdownChange[] = [{ kind: 'moveFolder', noteId: oldPrefix, targetNoteId: newPrefix, expectedRevision: snapshot.revision, noteIds: snapshot.noteIds }]
  for (const file of await listMarkdownFiles(notesRoot)) {
    const id = noteIdFromRelativePath(relative(notesRoot, file))
    const content = await readFile(file, 'utf-8')
    let next = content
    for (let index = 0; index < snapshot.noteIds.length; index++) {
      const oldId = snapshot.noteIds[index], newId = movedNotes[index]
      if (!oldId || !newId) throw new Error('Folder note mapping changed')
      const targets = new Set([oldId, titleFromId(oldId), basename(oldId)].map(value => stripMdExtension(value).toLowerCase()))
      next = replaceWikiTargets(next, targets, titleFromId(newId)).content
    }
    if (next !== content) changes.push({ kind: 'write', noteId: id.startsWith(oldPrefix + '/') ? newPrefix + '/' + id.slice(oldPrefix.length + 1) : id, expectedRevision: markdownRevision(content), content: next })
  }
  await writeNative('rename', changes)
  return { movedNotes }
}

async function deleteFolder(notesRoot: string, folder: string, writeNative: NativeNoteWriter, readFolder: NativeFolderReader): Promise<{ deletedNotes: string[] }> {
  await ensureNotesDirs(notesRoot)
  const safeFolder = assertSafeNoteId(folder)
  const snapshot = await readFolder(safeFolder)
  if (!snapshot) throw new Error('Folder not found')
  await writeNative('delete', [{ kind: 'deleteFolder', noteId: safeFolder, expectedRevision: snapshot.revision, entries: snapshot.entries, noteIds: snapshot.noteIds }])
  return { deletedNotes: snapshot.noteIds }
}
type NativeNoteOperation = NoteMutationOptions

type NativeNotesContext = {
  principal: NativePrincipal
  workspaceId: string
  notesRoot: string
  authorizationFences: Array<{ action: 'read' | 'write' | 'delete'; fence: string }>
}

function nativeNotesContext(
  deps: HandlerDeps,
  ctx: { workspaceId: string | null; principal?: NativePrincipal },
  workspaceId: string,
  actions: 'read' | 'write' | 'delete' | readonly ('read' | 'write' | 'delete')[],
): NativeNotesContext {
  if (!ctx.principal || !ctx.workspaceId || ctx.workspaceId !== workspaceId) {
    throw new Error('notes workspace does not match authenticated client')
  }
  const native = deps.nativeData
  if (!native) throw new Error('native Notes dependencies are unavailable')
  const requiredActions: Array<'read' | 'write' | 'delete'> = [...new Set<'read' | 'write' | 'delete'>(['read', ...(Array.isArray(actions) ? actions : [actions])])]
  const authorizationFences: NativeNotesContext['authorizationFences'] = []
  for (const action of requiredActions) {
    if (!native.authority.authorize(ctx.principal, workspaceId, action)) {
      throw new Error(`native notes ${action} is unauthorized`)
    }
    const fence = native.authority.permissionFence(ctx.principal, workspaceId, action)
    if (!fence) throw new Error(`native notes ${action} is unauthorized`)
    authorizationFences.push({ action, fence })
  }
  const workspace = native.authority.resolveWorkspace(workspaceId)
  if (!workspace) throw new Error('registered notes workspace root is unavailable')
  assertNativeNotesFences(deps, { principal: ctx.principal, workspaceId, notesRoot: '', authorizationFences })
  return { principal: ctx.principal, workspaceId, notesRoot: join(workspace.nativeRoot, NOTES_DIR), authorizationFences }
}

function assertNativeNotesFences(deps: HandlerDeps, context: NativeNotesContext): void {
  const authority = deps.nativeData!.authority
  for (const { action, fence } of context.authorizationFences) {
    if (authority.permissionFence(context.principal, context.workspaceId, action) !== fence ||
      !authority.authorize(context.principal, context.workspaceId, action)) {
      throw new Error(`native notes ${action} permission changed during operation`)
    }
  }
}

function nativeOperation(operation: NativeNoteOperation | undefined): NativeNoteOperation {
  if (!operation || !operation.operationId || operation.schemaVersion !== 1 ||
    (operation.expectedRevision !== null && (!Number.isSafeInteger(operation.expectedRevision) || operation.expectedRevision < 1))) {
    throw new Error('native notes operation metadata is required')
  }
  return operation
}

async function nativeNoteEntities(deps: HandlerDeps, context: NativeNotesContext): Promise<JournalEntitySnapshot[]> {
  const native = deps.nativeData!
  const entities = new Map<string, JournalEntitySnapshot>()
  let afterSequence = 0
  while (true) {
    assertNativeNotesFences(deps, context)
    const page = native.sync.pull(context.principal, context.workspaceId, afterSequence, 100)
    assertNativeNotesFences(deps, context)
    for (const entity of page.entities) {
      if (!entity.deleted && entity.kind === 'notes') entities.set(entity.nativeId, entity)
    }
    if (!page.hasMore || page.nextSequence <= afterSequence) break
    afterSequence = page.nextSequence
  }
  return [...entities.values()]
}

async function nativeNoteDocument(
  deps: HandlerDeps,
  context: NativeNotesContext,
  entity: JournalEntitySnapshot,
  file: { path: string; content: string },
  allEntities: readonly JournalEntitySnapshot[],
): Promise<NoteDocument & { nativeRevision: number }> {
  const notesRoot = context.notesRoot
  assertNativeNotesFences(deps, context)
  const relativePath = file.path.slice(`${NOTES_DIR}/`.length)
  const id = noteIdFromRelativePath(relativePath)
  const filePath = notePathFromId(notesRoot, id)
  const parsed = parseNoteContent(file.content)
  const info = await stat(filePath)
  assertNativeNotesFences(deps, context)
  const title = typeof parsed.properties.title === 'string' && parsed.properties.title.trim()
    ? parsed.properties.title.trim()
    : titleFromId(id)
  const summary: NoteSummary = {
    id,
    title,
    path: filePath,
    relativePath,
    tags: parsed.tags,
    properties: parsed.properties,
    links: parsed.links,
    assetRefs: parsed.assetRefs,
    updatedAt: info.mtimeMs,
    createdAt: info.birthtimeMs,
    size: Buffer.byteLength(file.content, 'utf8'),
  }
  const backlinks = allEntities.flatMap(candidate => candidate.files.flatMap(candidateFile => {
    if (!candidateFile.path.startsWith(`${NOTES_DIR}/`) || candidateFile.path === file.path || !candidateFile.path.endsWith('.md')) return []
    const candidateId = noteIdFromRelativePath(candidateFile.path.slice(`${NOTES_DIR}/`.length))
    const candidateContent = parseNoteContent(candidateFile.content)
    return candidateContent.links.filter(link => noteMatchesTarget({ ...summary, id, title }, link.target)).map(link => ({
      noteId: candidateId,
      title: typeof candidateContent.properties.title === 'string' ? candidateContent.properties.title : titleFromId(candidateId),
      path: join(notesRoot, candidateFile.path.slice(`${NOTES_DIR}/`.length)),
      line: link.line,
      preview: (candidateFile.content.split(/\r?\n/)[link.line - 1] ?? '').trim(),
    }))
  }))
  return { ...summary, content: file.content, backlinks, nativeRevision: entity.revision, nativeId: entity.nativeId,
    revision: markdownRevision(file.content), sourceStoreId: nativeJournalSourceStoreId(context) }
}

async function findNativeNote(
  deps: HandlerDeps,
  context: NativeNotesContext,
  noteId: string,
): Promise<{ entity: JournalEntitySnapshot; file: { path: string; content: string }; entities: JournalEntitySnapshot[] }> {
  const safeId = assertSafeNoteId(noteId)
  const relativePath = `${NOTES_DIR}/${safeId}.md`
  const entities = await nativeNoteEntities(deps, context)
  for (const entity of entities) {
    const file = entity.files.find(item => item.path === relativePath)
    if (file) return { entity, file, entities }
  }
  throw new Error('note not found in native journal')
}

async function commitNativeNote(
  deps: HandlerDeps,
  context: NativeNotesContext,
  entityId: string,
  operation: NativeNoteOperation | undefined,
  changes: Array<{ path: string; content: string | null }>,
): Promise<JournalReceipt> {
  const metadata = nativeOperation(operation)
  return deps.nativeData!.sync.commit(context.principal, context.workspaceId, {
    kind: 'notes',
    nativeId: entityId,
    operationId: metadata.operationId,
    expectedRevision: metadata.expectedRevision,
    schemaVersion: metadata.schemaVersion,
    changes,
  })
}

function nativeJournalSourceStoreId(context: NativeNotesContext): string {
  return `native-journal:${context.workspaceId}:${createHash('sha256').update(JSON.stringify([context.principal.issuer, context.notesRoot])).digest('hex')}`
}

async function nativeJournalContentServices(deps: HandlerDeps, ctx: RequestContext, workspaceId: string) {
  const context = nativeNotesContext(deps, ctx, workspaceId, 'read')
  const authority = deps.nativeData!.authority
  const initialWriteFence = authority.permissionFence(context.principal, workspaceId, 'write')
  // An advertised edit capability is bound to the same live permission generation as the read.
  if (authority.authorize(context.principal, workspaceId, 'write')) {
    const fence = authority.permissionFence(context.principal, workspaceId, 'write')
    if (!fence) throw new CodedError('AUTH_FAILED', 'Native document permission unavailable')
    context.authorizationFences.push({ action: 'write', fence })
  }
  const capturedRoot = await realpath(context.notesRoot)
  const sourceStoreId = nativeJournalSourceStoreId(context)
  const actorPrincipalId = JSON.stringify([context.principal.issuer, context.principal.subject])
  const assertSource = async () => {
    assertNativeNotesFences(deps, context)
    if (authority.permissionFence(context.principal, workspaceId, 'write') !== initialWriteFence) throw new CodedError('AUTH_FAILED', 'Native document edit permission changed')
    const current = authority.resolveWorkspace(workspaceId)
    if (!current || join(current.nativeRoot, NOTES_DIR) !== context.notesRoot || await realpath(context.notesRoot) !== capturedRoot) {
      throw new CodedError('DOCUMENT_AUTHORITY_CHANGED', 'Native document source binding changed')
    }
    assertNativeNotesFences(deps, context)
    if (authority.permissionFence(context.principal, workspaceId, 'write') !== initialWriteFence) throw new CodedError('AUTH_FAILED', 'Native document edit permission changed')
  }
  const safeRead = async (noteId: string): Promise<NoteDocument> => {
    await assertSource()
    const entities = await nativeNoteEntities(deps, context)
    const entity = entities.find(item => item.nativeId === noteId)
    const files = entity?.files.filter(item => item.path.startsWith(`${NOTES_DIR}/`) && item.path.endsWith('.md')) ?? []
    if (!entity || files.length !== 1) throw new CodedError('NOT_FOUND', 'Native document requires one canonical Markdown file')
    const file = files[0]!
    const note = await nativeNoteDocument(deps, context, entity, file, entities)
    await assertSource()
    return note
  }
  const owner: ContentOwner = {
    async bindingFor(ref) {
      await assertSource()
      if (ref.workspaceId !== workspaceId || ref.accountNamespace) return null
      return { workspaceId, sourceStoreId, authorityEpoch: 1,
        authority: 'markdown', contentKinds: ['document'], writable: authority.authorize(context.principal, workspaceId, 'write'), offlineReadable: true }
    },
    async read(ref) {
      const { id } = parseRox2EntityId(ref.entityId)
      let note: NoteDocument
      try { note = await safeRead(id) }
      catch (error) {
        if (error instanceof CodedError && error.code === 'NOT_FOUND') return null
        throw error
      }
      return { ref, nativeId: note.nativeId!, title: note.title, content: note.content, revision: markdownRevision(note.content), freshness: 'live' }
    },
  }
  const policy: ContentPolicy = {
    async authorize({ context: actor, ref, action }) {
      await assertSource()
      if (actor.actorPrincipalId !== actorPrincipalId || ref.workspaceId !== workspaceId || ref.accountNamespace) return { allowed: false, policyRevision: context.authorizationFences[0]!.fence }
      const canWrite = authority.authorize(context.principal, workspaceId, 'write')
      return { allowed: action === 'read' || canWrite, canWrite, policyRevision: context.authorizationFences[0]!.fence }
    },
  }
  const resolver = createDescriptorResolver({ owner, policy,
    // Metadata alone never grants ownership or triggers the competing Markdown WAL.
    store: new FileDescriptorStore(join(context.notesRoot, '.rox-native', 'descriptors.json'), { trustedRoot: capturedRoot }),
  })
  await assertSource()
  return { actorPrincipalId, resolver, sourceStoreId, safeRead, assertSource, store: null }
}

function movedNoteId(title: string, targetFolder: string): string {
  const normalizedFolder = targetFolder.trim().replace(/^\/+|\/+$/g, '')
  const safeFolder = normalizedFolder ? assertSafeNoteId(normalizedFolder) : ''
  const filename = stripMdExtension(safeNoteFilename(title))
  return safeFolder ? `${safeFolder}/${filename}` : filename
}

async function moveNoteInFilesystem(notesRoot: string, noteId: string, targetFolder: string): Promise<NoteDocument> {
  const sourcePath = notePathFromId(notesRoot, noteId)
  const source = await readNote(notesRoot, noteId)
  const nextId = movedNoteId(source.title, targetFolder)
  const targetPath = notePathFromId(notesRoot, nextId)
  if (sourcePath === targetPath) return source
  if (existsSync(targetPath)) throw new Error(`A note named "${source.title}" already exists in the target folder`)
  await mkdir(dirname(targetPath), { recursive: true })
  await rename(sourcePath, targetPath)
  return readNote(notesRoot, nextId)
}

export function registerNotesHandlers(server: RpcServer, deps: HandlerDeps): void {
  const originalServer = server
  server = new Proxy(originalServer, { get(target, property) {
    if (property === 'handle') return (channel: string, handler: Parameters<RpcServer['handle']>[1], options?: Parameters<RpcServer['handle']>[2]) => target.handle(channel, (ctx, ...args) => {
      // PREPARE_CREATE's explicit legacy null neither authors bytes nor exposes
      // native identity. Every actual legacy read/write is fenced once native
      // authority owns any workspace, including direct handler adapters.
      if (!ctx.principal && deps.nativeData?.authority.hasRegisteredWorkspaces() && channel !== RPC_CHANNELS.notes.PREPARE_CREATE) throw new CodedError('AUTH_FAILED', 'Native Notes authentication required')
      if (ctx.principal && !options?.nativeAction) throw new CodedError('CAPABILITY_UNAVAILABLE', 'This Notes capability has no canonical native adapter')
      return handler(ctx, ...args)
    }, options)
    const value = Reflect.get(target, property, target)
    return typeof value === 'function' ? value.bind(target) : value
  } })
  const changed = (payload: NoteChangedPayload, target: { to: 'workspace'; workspaceId: string } | { to: 'client'; clientId: string } = { to: 'workspace', workspaceId: payload.workspaceId }) => {
    pushTyped(server, RPC_CHANNELS.notes.CHANGED, target, payload)
  }
  const watchedClients = new Set<string>()
  const watchRequests = new Map<string, number>()
  let watchesDisposed = false
  server.onClientDisconnect?.(clientId => {
    watchRequests.delete(clientId)
    if (watchedClients.delete(clientId)) cleanupNotesWatchForClient(clientId)
  })
  server.onShutdown?.(() => {
    watchesDisposed = true
    for (const clientId of watchedClients) cleanupNotesWatchForClient(clientId)
    watchedClients.clear()
    watchRequests.clear()
  })

  const nativeContent = registerContentHandlers(server, {
    nativeJournal: {
      active: () => deps.nativeData?.authority.hasRegisteredWorkspaces() ?? false,
      assertScope: (ctx, workspaceId) => { nativeNotesContext(deps, ctx, workspaceId, 'read') },
      services: (ctx, workspaceId) => nativeJournalContentServices(deps, ctx, workspaceId),
    },
    notesRoot: workspaceId => {
      try { return getWorkspaceNotesRoot(workspaceId) } catch { return null }
    },
    readNote: (_workspaceId, noteId, capturedRoot) => readNote(capturedRoot, noteId),
    ownsWindow: context => context.webContentsId !== null
      && !!deps.windowManager?.getWindowByWebContentsId(context.webContentsId)
      && deps.windowManager?.getWorkspaceForWindow(context.webContentsId) === context.workspaceId,
    async changed(workspaceId, noteId, reason, eventId) {
      if (deps.nativeData?.authority.resolveWorkspace(workspaceId)) {
        // Canonical journal projection invalidation never indexes a legacy
        // filesystem vault or needs its global local config.
        changed({ workspaceId, reason, noteId, ...(eventId ? { eventId } : {}) })
        return
      }
      const notesRoot = getWorkspaceNotesRoot(workspaceId)
      const filePath = notePathFromId(notesRoot, noteId)
      try { lastInternalMtime.set(filePath, (await stat(filePath)).mtimeMs) }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      refreshVaultIndex(notesRoot)
      changed({ workspaceId, reason, noteId, ...(eventId ? { eventId } : {}) })
    },
  })

  server.handle(RPC_CHANNELS.notes.LIST, async (ctx, workspaceId: string) => {
    nativeContent.assertScope(ctx, workspaceId)
    const listed = rpcNotesListResult({ source: 'native' })
    if (!isClaimableLive(listed.result)) return []
    if (ctx.principal) {
      const context = nativeNotesContext(deps, ctx, workspaceId, 'read')
      const entities = await nativeNoteEntities(deps, context)
      const documents = await Promise.all(entities.flatMap(entity =>
        entity.files.filter(file => file.path.startsWith(`${NOTES_DIR}/`) && file.path.endsWith('.md'))
          .map(file => nativeNoteDocument(deps, context, entity, file, entities))))
      return documents.sort((a, b) => b.updatedAt - a.updatedAt || a.title.localeCompare(b.title))
    }
    const notesRoot = getWorkspaceNotesRoot(workspaceId)
    await ensureDailyNotes(notesRoot, sessionsFromDeps(deps, workspaceId), (reason, changes) => nativeContent.writeNative(ctx, workspaceId, reason, changes))
    refreshVaultIndex(notesRoot)
    return listNotes(notesRoot)
  }, { nativeAction: 'read' })

  server.handle(RPC_CHANNELS.notes.READ, async (ctx, workspaceId: string, noteId: string) => {
    const read = rpcNotesReadResult({ source: 'native', nativeId: noteId })
    if (!isClaimableLive(read.result)) throw new Error('note read is not live')
    if (ctx.principal) {
      const context = nativeNotesContext(deps, ctx, workspaceId, 'read')
      const found = await findNativeNote(deps, context, noteId)
      return nativeNoteDocument(deps, context, found.entity, found.file, found.entities)
    }
    return nativeContent.readNote(ctx, workspaceId, noteId)
  }, { nativeAction: 'read' })

  server.handle(RPC_CHANNELS.notes.SAVE, async (
    ctx,
    workspaceId: string,
    noteId: string,
    content: string,
    expectedRevision?: string,
    operationOrSourceStoreId?: NativeNoteOperation | string,
  ) => {
    const operation = typeof operationOrSourceStoreId === 'string' ? undefined : operationOrSourceStoreId
    const sourceStoreId = typeof operationOrSourceStoreId === 'string' ? operationOrSourceStoreId : undefined
    nativeContent.assertScope(ctx, workspaceId)
    const act = rpcNotesActResult({ source: 'native', action: 'write', nativeId: noteId })
    if (!isClaimableLive(act)) throw new Error('note save is not live')
    if (ctx.principal) {
      const context = nativeNotesContext(deps, ctx, workspaceId, 'write')
      const found = await findNativeNote(deps, context, noteId)
      if (found.entity.files.length !== 1) throw new Error('native Notes save requires one canonical Markdown file')
      const previous = await nativeNoteDocument(deps, context, found.entity, found.file, found.entities)
      await commitNativeNote(deps, context, found.entity.nativeId, operation, [{
        path: found.file.path,
        content,
      }])
      const updated = await findNativeNote(deps, context, noteId)
      const note = await nativeNoteDocument(deps, context, updated.entity, updated.file, updated.entities)
      const previousLinks = new Set(previous.links.map(link => stripMdExtension(link.target.trim()).toLowerCase()))
      for (const link of note.links ?? []) {
        if (previousLinks.has(stripMdExtension(link.target.trim()).toLowerCase())) continue
        const targets = updated.entities.filter(entity => entity.nativeId !== updated.entity.nativeId && entity.files.some(file => {
          if (!file.path.startsWith(`${NOTES_DIR}/`) || !file.path.endsWith('.md')) return false
          const id = noteIdFromRelativePath(file.path.slice(`${NOTES_DIR}/`.length))
          const parsed = parseNoteContent(file.content)
          const title = typeof parsed.properties.title === 'string' ? parsed.properties.title : titleFromId(id)
          return noteMatchesTarget({ id, title }, link.target)
        }))
        // Award only a real unambiguous canonical edge, once for its lifetime.
        if (targets.length === 1) awardNativeXpAndBroadcast(server, deps, ctx, 'note_linked', JSON.stringify([workspaceId, updated.entity.nativeId, targets[0]!.nativeId]))
      }
      changed({ workspaceId, reason: 'save', noteId: note.id })
      return note
    }
    const notesRoot = getWorkspaceNotesRoot(workspaceId)
    let previousLinkCount = 0
    try {
      const existing = await readNote(notesRoot, noteId)
      previousLinkCount = existing.links?.length ?? 0
    } catch {
      // new / unreadable note — treat as zero prior links
    }
    if (!expectedRevision) throw new Error('note expected revision is required')
    const existing = await readNote(notesRoot, noteId)
    if (expectedRevision !== existing.revision && expectedRevision !== contentHash(existing.content)) throw new Error('note revision conflict')
    const { note } = await nativeContent.commit(ctx, {
      workspaceId, noteId, content, expectedRevision: markdownRevision(existing.content), sourceStoreId,
      authorityEpoch: 1, operationId: crypto.randomUUID(),
    })
    refreshVaultIndex(notesRoot)
    const nextLinkCount = note.links?.length ?? 0
    if (nextLinkCount > previousLinkCount) awardXpSafe('note_linked')
    changed({ workspaceId, reason: 'save', noteId: note.id })
    return note
  }, { nativeAction: 'write' })

  // Planning uses the same canonical filename/frontmatter authority as CREATE; it never commits.
  server.handle(RPC_CHANNELS.notes.PREPARE_CREATE, (ctx, workspaceId: string, title: string, folder?: string): NativeReplicaCreatePlan | null => {
    if (!ctx.principal) return null // Explicit legacy response; authorization failures never fall back.
    const context = nativeNotesContext(deps, ctx, workspaceId, 'write')
    if (typeof title !== 'string' || (folder != null && typeof folder !== 'string')) throw new Error('invalid native note creation intent')
    const safeFolder = folder ? assertSafeNoteId(folder) : ''
    const filename = safeNoteFilename(title || 'Untitled')
    const nativeId = safeFolder ? `${safeFolder}/${stripMdExtension(filename)}` : stripMdExtension(filename)
    const path = `${NOTES_DIR}/${nativeId}.md`
    assertSafeNoteId(nativeId)
    const permissionFence = context.authorizationFences.find(item => item.action === 'read')!.fence
    assertNativeNotesFences(deps, context)
    return {
      context: { issuer: context.principal.issuer, subject: context.principal.subject, workspaceId, permissionFence },
      writePermissionFence: context.authorizationFences.find(item => item.action === 'write')!.fence,
      mutation: { nativeId, expectedRevision: null, schemaVersion: 1, changes: [{ path, content: buildInitialNoteContent(title || 'Untitled') }] },
    }
  }, { nativeAction: 'write' })

  server.handle(RPC_CHANNELS.notes.CREATE, async (ctx, workspaceId: string, title: string, folder?: string, operation?: NativeNoteOperation) => {
    const act = rpcNotesActResult({ source: 'native', action: 'write', nativeId: title || 'untitled' })
    if (!isClaimableLive(act)) throw new Error('note create is not live')
    if (ctx.principal) {
      const context = nativeNotesContext(deps, ctx, workspaceId, 'write')
      const safeFolder = folder ? assertSafeNoteId(folder) : ''
      const filename = safeNoteFilename(title || 'Untitled')
      const relativeId = safeFolder ? `${safeFolder}/${stripMdExtension(filename)}` : stripMdExtension(filename)
      const path = `${NOTES_DIR}/${relativeId}.md`
      const metadata = nativeOperation(operation)
      if (metadata.expectedRevision !== null) throw new Error('native note create requires expectedRevision:null')
      const initialContent = buildInitialNoteContent(title || 'Untitled')
      await commitNativeNote(deps, context, relativeId, metadata, [{ path, content: initialContent }])
      const created = await findNativeNote(deps, context, relativeId)
      const note = await nativeNoteDocument(deps, context, created.entity, created.file, created.entities)
      awardNativeXpAndBroadcast(server, deps, ctx, 'first_note', JSON.stringify([workspaceId, created.entity.nativeId]))
      changed({ workspaceId, reason: 'create', noteId: note.id })
      return note
    }
    const note = await createNote(getWorkspaceNotesRoot(workspaceId), title, (reason, changes) => nativeContent.writeNative(ctx, workspaceId, reason, changes), folder)
    refreshVaultIndex(getWorkspaceNotesRoot(workspaceId))
    return note
  }, { nativeAction: 'write' })

  server.handle(RPC_CHANNELS.notes.RENAME, async (ctx, workspaceId: string, noteId: string, nextTitle: string, operation?: NativeNoteOperation) => {
    if (ctx.principal) {
      const context = nativeNotesContext(deps, ctx, workspaceId, ['write', 'delete'])
      const found = await findNativeNote(deps, context, noteId)
      if (found.entity.files.length !== 1) throw new Error('native Notes rename requires one canonical Markdown file')
      const parent = dirname(noteId)
      const nextId = `${parent === '.' ? '' : `${parent}/`}${stripMdExtension(safeNoteFilename(nextTitle))}`
      const nextPath = `${NOTES_DIR}/${nextId}.md`
      const content = updateFrontmatterTitle(found.file.content, nextTitle)
      await commitNativeNote(deps, context, found.entity.nativeId, operation, [
        { path: found.file.path, content: null },
        { path: nextPath, content },
      ])
      const renamed = await findNativeNote(deps, context, nextId)
      const note = await nativeNoteDocument(deps, context, renamed.entity, renamed.file, renamed.entities)
      changed({ workspaceId, reason: 'rename', noteId: note.id })
      return { note, updatedNotes: [] }
    }
    const result = await renameNote(getWorkspaceNotesRoot(workspaceId), noteId, nextTitle, (reason, changes) => nativeContent.writeNative(ctx, workspaceId, reason, changes))
    refreshVaultIndex(getWorkspaceNotesRoot(workspaceId))
    return result
  }, { nativeAction: 'write' })

  server.handle(RPC_CHANNELS.notes.MOVE, async (ctx, workspaceId: string, noteId: string, targetFolder: string, operation?: NativeNoteOperation) => {
    if (typeof targetFolder !== 'string') throw new Error('notes.move: targetFolder is required')
    if (ctx.principal) {
      const context = nativeNotesContext(deps, ctx, workspaceId, ['write', 'delete'])
      const found = await findNativeNote(deps, context, noteId)
      if (found.entity.files.length !== 1) throw new Error('native Notes move requires one canonical Markdown file')
      const current = await nativeNoteDocument(deps, context, found.entity, found.file, found.entities)
      const nextId = movedNoteId(current.title, targetFolder)
      const nextPath = `${NOTES_DIR}/${nextId}.md`
      if (found.file.path === nextPath) return { note: current }
      await commitNativeNote(deps, context, found.entity.nativeId, operation, [
        { path: found.file.path, content: null },
        { path: nextPath, content: found.file.content },
      ])
      const moved = await findNativeNote(deps, context, nextId)
      const note = await nativeNoteDocument(deps, context, moved.entity, moved.file, moved.entities)
      changed({ workspaceId, reason: 'move', noteId: note.id })
      return { note }
    }
    const note = await moveNoteInFilesystem(getWorkspaceNotesRoot(workspaceId), noteId, targetFolder)
    refreshVaultIndex(getWorkspaceNotesRoot(workspaceId))
    changed({ workspaceId, reason: 'move', noteId: note.id })
    return { note }
  }, { nativeAction: 'write' })

  server.handle(RPC_CHANNELS.notes.DELETE, async (ctx, workspaceId: string, noteId: string, operation?: NativeNoteOperation) => {
    if (!noteId) throw new Error('notes.delete: noteId is required')
    const act = rpcNotesActResult({ source: 'native', action: 'destroy', granted: true, nativeId: noteId })
    if (!isClaimableLive(act)) throw new Error('note delete is not live')
    if (ctx.principal) {
      const context = nativeNotesContext(deps, ctx, workspaceId, ['write', 'delete'])
      const found = await findNativeNote(deps, context, noteId)
      await commitNativeNote(deps, context, found.entity.nativeId, operation, found.entity.files.map(file => ({
        path: file.path,
        content: null,
      })))
      changed({ workspaceId, reason: 'delete', noteId })
      return true
    }
    const notesRoot = getWorkspaceNotesRoot(workspaceId)
    await ensureNotesDirs(notesRoot)
    const existing = await nativeContent.readNote(ctx, workspaceId, noteId)
    await nativeContent.writeNative(ctx, workspaceId, 'delete', [{ kind: 'delete', noteId, expectedRevision: markdownRevision(existing.content) }])
    refreshVaultIndex(notesRoot)
    return true
  }, { nativeAction: 'delete' })

  server.handle(RPC_CHANNELS.notes.RENAME_FOLDER, async (ctx, workspaceId: string, folder: string, nextName: string) => {
    nativeContent.assertScope(ctx, workspaceId)
    const result = await renameFolder(getWorkspaceNotesRoot(workspaceId), folder, nextName, (reason, changes) => nativeContent.writeNative(ctx, workspaceId, reason, changes), target => nativeContent.folderSnapshot(ctx, workspaceId, target))
    refreshVaultIndex(getWorkspaceNotesRoot(workspaceId))
    return result
  }, { access: 'localElectron' })

  server.handle(RPC_CHANNELS.notes.DELETE_FOLDER, async (ctx, workspaceId: string, folder: string) => {
    nativeContent.assertScope(ctx, workspaceId)
    if (!folder) throw new Error('notes.deleteFolder: folder is required')
    const act = rpcNotesActResult({ source: 'native', action: 'destroy', granted: true, nativeId: folder })
    if (!isClaimableLive(act)) throw new Error('note folder delete is not live')
    const result = await deleteFolder(getWorkspaceNotesRoot(workspaceId), folder, (reason, changes) => nativeContent.writeNative(ctx, workspaceId, reason, changes), target => nativeContent.folderSnapshot(ctx, workspaceId, target))
    refreshVaultIndex(getWorkspaceNotesRoot(workspaceId))
    return result
  }, { access: 'localElectron' })

  server.handle(RPC_CHANNELS.notes.SEARCH, async (ctx, workspaceId: string, query: string) => {
    if (ctx.principal) {
      const context = nativeNotesContext(deps, ctx, workspaceId, 'read')
      const entities = await nativeNoteEntities(deps, context)
      const docs = await Promise.all(entities.flatMap(entity =>
        entity.files.filter(file => file.path.startsWith(`${NOTES_DIR}/`) && file.path.endsWith('.md'))
          .map(file => nativeNoteDocument(deps, context, entity, file, entities))))
      const q = query.trim().toLowerCase()
      return docs.filter(note => !q || note.title.toLowerCase().includes(q) ||
        note.tags.some(tag => tag.toLowerCase().includes(q)) || note.content.toLowerCase().includes(q))
        .map(({ content: _content, backlinks: _backlinks, nativeRevision: _revision, ...summary }) => summary)
    }
    const notesRoot = getWorkspaceNotesRoot(workspaceId)
    const indexed = tryQueryFromVaultIndex(notesRoot, query)
    if (indexed) return indexed
    const notes = await listNotes(notesRoot)
    const q = query.trim().toLowerCase()
    if (!q) return notes
    await ensureNotesDirs(notesRoot)

    const results = await Promise.allSettled(
      notes.map(async note => {
        if (note.title.toLowerCase().includes(q) || note.tags.some(tag => tag.toLowerCase().includes(q))) return note
        const content = await readFile(join(notesRoot, note.relativePath), 'utf-8').catch(() => '')
        return content.toLowerCase().includes(q) ? note : null
      })
    )

    return results
      .filter((r): r is PromiseFulfilledResult<NoteSummary> => r.status === 'fulfilled' && r.value !== null)
      .map(r => r.value)
  }, { nativeAction: 'read' })

  server.handle(RPC_CHANNELS.notes.GET_BACKLINKS, async (ctx, workspaceId: string, noteId: string) => {
    if (ctx.principal) {
      const context = nativeNotesContext(deps, ctx, workspaceId, 'read')
      const found = await findNativeNote(deps, context, noteId)
      const note = await nativeNoteDocument(deps, context, found.entity, found.file, found.entities)
      return note.backlinks
    }
    return getBacklinks(getWorkspaceNotesRoot(workspaceId), noteId)
  }, { nativeAction: 'read' })

  server.handle(RPC_CHANNELS.notes.GET_INSIGHTS, async (_ctx, workspaceId: string, noteId: string) => {
    const notesRoot = getWorkspaceNotesRoot(workspaceId)
    try {
      ensureVaultIndex(notesRoot)
      return getVaultInsights(notesRoot, noteId)
    } catch {
      return {
        entities: [],
        linkSuggestions: [],
        unlinkedMentions: [],
        brokenLinks: [],
        suggestedMerges: [],
        footnotes: [],
      }
    }
  })

  server.handle(RPC_CHANNELS.notes.GET_INDEX_HEALTH, async (_ctx, workspaceId: string) => {
    try {
      return indexHealthForWorkspace(workspaceId)
    } catch {
      return emptyIndexHealth()
    }
  })

  server.handle(RPC_CHANNELS.notes.REBUILD_INDEX, async (_ctx, workspaceId: string) => {
    const act = rpcNotesActResult({ source: 'native', action: 'write', nativeId: workspaceId })
    if (!isClaimableLive(act)) throw new Error('note index rebuild is not live')
    const notesRoot = getWorkspaceNotesRoot(workspaceId)
    try {
      rebuildVaultIndex(notesRoot)
      return indexHealthForWorkspace(workspaceId)
    } catch {
      return emptyIndexHealth()
    }
  })

  server.handle(RPC_CHANNELS.notes.GET_RENAME_IMPACT, async (_ctx, workspaceId: string, noteId: string, nextTitle: string) => {
    return getRenameImpact(getWorkspaceNotesRoot(workspaceId), noteId, nextTitle)
  })

  server.handle(RPC_CHANNELS.notes.GET_DAILY_NOTE, async (ctx, workspaceId: string, date?: string) => {
    nativeContent.assertScope(ctx, workspaceId)
    const act = rpcNotesActResult({ source: 'native', action: 'write', nativeId: date || 'daily' })
    if (!isClaimableLive(act)) throw new Error('daily note upsert is not live')
    const notesRoot = getWorkspaceNotesRoot(workspaceId)
    const sessions = sessionsFromDeps(deps, workspaceId)
    await ensureDailyNotes(notesRoot, sessions, (reason, changes) => nativeContent.writeNative(ctx, workspaceId, reason, changes))
    const id = await upsertDailyNote(notesRoot, date || formatDateId(new Date()), sessions, (reason, changes) => nativeContent.writeNative(ctx, workspaceId, reason, changes))
    refreshVaultIndex(notesRoot)
    return readNote(notesRoot, id)
  }, { access: 'localElectron' })

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
    if (!relativePath) throw new Error('notes.deleteAsset: relativePath is required')
    const act = rpcNotesActResult({ source: 'native', action: 'destroy', granted: true, nativeId: relativePath })
    if (!isClaimableLive(act)) throw new Error('note asset delete is not live')
    const result = await deleteAsset(getWorkspaceNotesRoot(workspaceId), relativePath)
    changed({ workspaceId, reason: 'asset' })
    return result
  })

  server.handle(RPC_CHANNELS.notes.RENAME_ASSET, async (ctx, workspaceId: string, relativePath: string, nextName: string) => {
    nativeContent.assertScope(ctx, workspaceId)
    const result = await renameAsset(getWorkspaceNotesRoot(workspaceId), relativePath, nextName, (reason, changes) => nativeContent.writeNative(ctx, workspaceId, reason, changes))
    changed({ workspaceId, reason: 'asset' })
    return result
  }, { access: 'localElectron' })

  server.handle(RPC_CHANNELS.notes.UPDATE_PROPERTIES, async (
    ctx,
    workspaceId: string,
    noteId: string,
    properties: Record<string, unknown>,
    operationOrExpectedRevision?: NativeNoteOperation | string,
    reviewedDigest?: string,
    sourceStoreId?: string,
  ) => {
    const operation = typeof operationOrExpectedRevision === 'string' ? undefined : operationOrExpectedRevision
    const expectedRevision = typeof operationOrExpectedRevision === 'string' ? operationOrExpectedRevision : undefined
    nativeContent.assertScope(ctx, workspaceId)
    if (ctx.principal) {
      const context = nativeNotesContext(deps, ctx, workspaceId, 'write')
      const found = await findNativeNote(deps, context, noteId)
      if (found.entity.files.length !== 1) throw new Error('native Notes properties require one canonical Markdown file')
      const content = updateFrontmatterProperties(found.file.content, properties)
      await commitNativeNote(deps, context, found.entity.nativeId, operation, [{ path: found.file.path, content }])
      const updated = await findNativeNote(deps, context, noteId)
      const note = await nativeNoteDocument(deps, context, updated.entity, updated.file, updated.entities)
      changed({ workspaceId, reason: 'properties', noteId: note.id })
      return note
    }
    const notesRoot = getWorkspaceNotesRoot(workspaceId)
    const existing = await readNote(notesRoot, noteId)
    if (!expectedRevision) throw new CodedError('DOCUMENT_VALIDATION_FAILED', 'Document revision is required')
    if (expectedRevision !== existing.revision) throw new CodedError('HASH_CONFLICT', 'Document revision conflict')
    const preview = previewPropertyDictionary(existing.content, existing.properties, properties)
    if (preview.requiresReview && preview.digest !== reviewedDigest) throw new CodedError('UNSUPPORTED_OPERATION', 'Property conversion requires a reviewed preview')
    const { note } = await nativeContent.commit(ctx, { workspaceId, noteId, content: preview.content, expectedRevision, sourceStoreId,
      authorityEpoch: 1, operationId: crypto.randomUUID() })
    refreshVaultIndex(notesRoot)
    changed({ workspaceId, reason: 'properties', noteId: note.id })
    return note
  }, { nativeAction: 'write' })

  server.handle(RPC_CHANNELS.notes.WATCH, async (ctx, workspaceId: string) => {
    const clientId = ctx.clientId
    const request = (watchRequests.get(clientId) ?? 0) + 1
    watchRequests.set(clientId, request)
    cleanupNotesWatchForClient(clientId)
    watchedClients.delete(clientId)
    if (ctx.principal) {
      const context = nativeNotesContext(deps, ctx, workspaceId, 'read')
      const authority = deps.nativeData!.authority
      const subscribeFence = authority.permissionFence(context.principal, workspaceId, 'subscribe')
      if (!subscribeFence || !authority.authorize(context.principal, workspaceId, 'subscribe')) {
        throw new CodedError('FORBIDDEN', 'Native Notes subscription denied')
      }
      const workspaceRoot = dirname(context.notesRoot)
      let sourceIdentity: { dev: number; ino: number } | undefined
      const assertCurrent = async () => {
        assertNativeNotesFences(deps, context)
        if (watchesDisposed || watchRequests.get(clientId) !== request ||
            !server.isRequestContextCurrent?.(ctx, 'subscribe') ||
            authority.permissionFence(context.principal, workspaceId, 'subscribe') !== subscribeFence ||
            !authority.authorize(context.principal, workspaceId, 'subscribe')) {
          throw new CodedError('AUTH_FAILED', 'Native Notes subscription changed')
        }
        const workspace = authority.resolveWorkspace(workspaceId)
        if (!workspace || workspace.nativeRoot !== workspaceRoot ||
            await realpath(workspaceRoot) !== workspaceRoot) {
          throw new CodedError('DOCUMENT_AUTHORITY_CHANGED', 'Native Notes source binding changed')
        }
        const source = await lstat(context.notesRoot).catch(error => {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
          throw error
        })
        if ((!source && sourceIdentity) || (source && (!source.isDirectory() || source.isSymbolicLink() ||
            await realpath(context.notesRoot) !== context.notesRoot ||
            (sourceIdentity && (source.dev !== sourceIdentity.dev || source.ino !== sourceIdentity.ino))))) {
          throw new CodedError('DOCUMENT_AUTHORITY_CHANGED', 'Native Notes source directory changed')
        }
        // An empty registered workspace has no Notes source yet. Reading or
        // subscribing must not create it. Latch the first canonical directory
        // only after an authorized writer has created it.
        if (source && !sourceIdentity) sourceIdentity = { dev: source.dev, ino: source.ino }
        assertNativeNotesFences(deps, context)
        if (watchesDisposed || watchRequests.get(clientId) !== request ||
            !server.isRequestContextCurrent?.(ctx, 'subscribe') ||
            authority.permissionFence(context.principal, workspaceId, 'subscribe') !== subscribeFence) {
          throw new CodedError('AUTH_FAILED', 'Native Notes subscription changed')
        }
      }
      // Observe the existing registered parent so the first authorized note
      // creation is visible, without writing under a read/subscribe grant.
      await assertCurrent()
      const { watch } = await import('fs')
      await assertCurrent()
      const state: ClientNotesWatchState = {
        watcher: null as unknown as import('fs').FSWatcher,
        workspaceId, debounceTimer: null, lastExternalChangeAt: null, pendingFilenames: [],
      }
      state.watcher = watch(workspaceRoot, { recursive: true }, (_eventType, filename) => {
        let noteFilename: string | null = null
        if (filename) {
          const relativeFilename = toSlashPath(filename.toString())
          if (relativeFilename !== NOTES_DIR && !relativeFilename.startsWith(`${NOTES_DIR}/`)) return
          noteFilename = relativeFilename === NOTES_DIR ? null : relativeFilename.slice(NOTES_DIR.length + 1)
          if (noteFilename && !noteIdFromWatchFilename(noteFilename)) return
        }
        state.pendingFilenames.push(noteFilename)
        if (state.debounceTimer) clearTimeout(state.debounceTimer)
        state.debounceTimer = setTimeout(() => {
          state.debounceTimer = null
          const burst = state.pendingFilenames.splice(0)
          void (async () => {
            await assertCurrent()
            if (clientNotesWatches.get(clientId) !== state) return
            const noteIds = [...new Set(burst.flatMap(name => {
              const noteId = noteIdFromWatchFilename(name)
              return noteId ? [noteId] : []
            }))]
            state.lastExternalChangeAt = Date.now()
            changed({ workspaceId, reason: 'external', noteId: noteIds.length === 1 ? noteIds[0] : undefined },
              { to: 'client', clientId })
          })().catch(() => {
            if (clientNotesWatches.get(clientId) === state) {
              cleanupNotesWatchForClient(clientId)
              watchedClients.delete(clientId)
            }
          })
        }, VAULT_WATCH_DEBOUNCE_MS)
      })
      state.detachAuthority = authority.onInvalidation(event => {
        if (event.subject === context.principal.subject && clientNotesWatches.get(clientId) === state) {
          cleanupNotesWatchForClient(clientId)
          watchedClients.delete(clientId)
        }
      })
      clientNotesWatches.set(clientId, state)
      watchedClients.add(clientId)
      try { await assertCurrent() } catch (error) {
        if (clientNotesWatches.get(clientId) === state) {
          cleanupNotesWatchForClient(clientId)
          watchedClients.delete(clientId)
        }
        throw error
      }
      return
    }
    const notesRoot = getWorkspaceNotesRoot(workspaceId)
    await ensureNotesDirs(notesRoot)

    try {
      const { watch } = await import('fs')
      const state: ClientNotesWatchState = {
        watcher: null as unknown as import('fs').FSWatcher,
        workspaceId,
        debounceTimer: null,
        lastExternalChangeAt: lastExternalChangeByWorkspace.get(workspaceId) ?? null,
        pendingFilenames: [],
      }

      state.watcher = watch(notesRoot, { recursive: true }, (_eventType, filename) => {
        const noteId = noteIdFromWatchFilename(filename)
        if (filename && !noteId) return
        state.pendingFilenames.push(filename ?? null)

        if (state.debounceTimer) clearTimeout(state.debounceTimer)
        state.debounceTimer = setTimeout(async () => {
          const burst = state.pendingFilenames.splice(0)
          const external: Array<string | Buffer | null> = []
          for (const name of burst) {
            const absPath = name ? join(notesRoot, name.toString()) : null
            if (absPath && await isOwnWrite(absPath)) continue
            external.push(name)
          }
          if (external.length === 0) return
          const tick = applyVaultWatchTick(notesRoot, external)
          const at = Date.now()
          state.lastExternalChangeAt = at
          lastExternalChangeByWorkspace.set(workspaceId, at)
          changed({
            workspaceId,
            reason: 'external',
            noteId: tick.noteIds.length === 1 ? tick.noteIds[0] : undefined,
          }, { to: 'client', clientId })
        }, VAULT_WATCH_DEBOUNCE_MS)
      })

      clientNotesWatches.set(clientId, state)
      watchedClients.add(clientId)
    } catch (error) {
      throw new Error(`Failed to watch notes: ${error instanceof Error ? error.message : String(error)}`)
    }
  }, { nativeAction: 'subscribe' })

  server.handle(RPC_CHANNELS.notes.UNWATCH, async (ctx) => {
    if (ctx.principal) nativeNotesContext(deps, ctx, ctx.workspaceId ?? '', 'read')
    watchRequests.set(ctx.clientId, (watchRequests.get(ctx.clientId) ?? 0) + 1)
    cleanupNotesWatchForClient(ctx.clientId)
    watchedClients.delete(ctx.clientId)
  }, { nativeAction: 'read' })
}
