import { existsSync } from 'fs'
import { mkdir, readdir, readFile, realpath, stat, writeFile } from 'fs/promises'
import { basename, dirname, extname, join, relative, resolve, sep } from 'path'
import matter from 'gray-matter'
import yaml from 'js-yaml'
import {
  hashKnowledgeContent,
  KnowledgeError,
  LOCAL_MARKDOWN_KNOWLEDGE_PROVIDER,
  type ApplyResult,
  type ContextMode,
  type ContextPayload,
  type KnowledgeAttribute,
  type KnowledgeCapabilities,
  type KnowledgeConnection,
  type KnowledgeNode,
  type KnowledgeNotebookInfo,
  type KnowledgeProvider,
  type KnowledgeRef,
  type MutationInput,
  type MutationProposal,
  type SearchInput,
  type SearchPage,
} from '@craft-agent/core/knowledge'
import type { ListDocTreeResult, SiyuanDocTreeNode } from '@craft-agent/core/knowledge/providers/siyuan'
import { sanitizeFilename } from '@craft-agent/server-core/handlers'
import type { KnowledgeConnectionsStore } from './connections-store'

export const LOCAL_MARKDOWN_CONNECTION_ID = 'local-markdown'
export const LOCAL_MARKDOWN_CONNECTION_ID_PREFIX = 'local-markdown:'
export const LOCAL_MARKDOWN_NOTEBOOK_ID = 'local-notes'
export const LOCAL_MARKDOWN_BASE_URL = 'local-markdown://workspace-notes'
export const LOCAL_MARKDOWN_LABEL = 'Local Markdown Notes'

const ASSETS_DIR = 'assets'
const DAILY_DIR = 'daily'
const TEMPLATES_DIR = 'templates'
const PROJECTS_DIR = 'projects'
const TREE_IGNORED_DIRS = new Set([ASSETS_DIR, TEMPLATES_DIR])

type LocalMarkdownNote = {
  noteId: string
  relativePath: string
  filePath: string
  title: string
  content: string
  body: string
  properties: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

export type LocalMarkdownCreateArgs =
  | { op: 'notebook'; name: string }
  | { op: 'folder'; path: string; name: string }
  | { op: 'document'; path: string; title: string }

export type LocalMarkdownCreateResult = { id: string } | { path: string }

export function localMarkdownConnectionId(workspaceId: string): string {
  return `${LOCAL_MARKDOWN_CONNECTION_ID_PREFIX}${encodeURIComponent(workspaceId.trim() || 'default')}`
}

export function localMarkdownCredentialRef(workspaceId: string): string {
  const normalized = workspaceId.trim() || 'default'
  return `source_bearer::${normalized}::${localMarkdownConnectionId(normalized)}`
}

export function ensureDefaultLocalMarkdownConnection(
  store: KnowledgeConnectionsStore,
  options: { workspaceId?: string } = {},
): { connectionId: string; created: boolean } {
  const workspaceId = options.workspaceId?.trim() || 'default'
  const connectionId = localMarkdownConnectionId(workspaceId)
  const existing = store.get(connectionId)
  if (existing) {
    store.promote(existing.id)
    return { connectionId: existing.id, created: false }
  }
  const saved = store.save({
    id: connectionId,
    provider: LOCAL_MARKDOWN_KNOWLEDGE_PROVIDER,
    mode: 'external-local',
    baseUrl: LOCAL_MARKDOWN_BASE_URL,
    credentialRef: localMarkdownCredentialRef(workspaceId),
    status: 'ok',
  })
  store.promote(saved.id)
  return { connectionId: saved.id, created: true }
}

export async function listLocalMarkdownNotebooks(notesRoot: string): Promise<KnowledgeNotebookInfo[]> {
  await ensureNotesDirs(notesRoot)
  return [
    {
      id: LOCAL_MARKDOWN_NOTEBOOK_ID,
      name: 'Local Markdown',
      icon: '1f4dd',
      closed: false,
    },
  ]
}

export async function listLocalMarkdownTree(
  notesRoot: string,
  notebookId: string,
  path: string = '/',
): Promise<ListDocTreeResult> {
  assertLocalNotebook(notebookId)
  await ensureNotesDirs(notesRoot)
  const relativeDir = relativeDirFromNavigatorPath(path)
  const root = resolve(notesRoot)
  const abs = resolve(root, relativeDir)
  if (!isInsidePath(root, abs)) {
    throw new KnowledgeError('INVALID_REF', `Invalid local notes path: ${path}`)
  }
  await assertPathAncestorInsideRoot(root, abs, `Local Markdown tree path escapes the notes root: ${path}`)
  if (!existsSync(abs)) {
    return {
      notebookId: LOCAL_MARKDOWN_NOTEBOOK_ID,
      nodes: [],
    }
  }
  await assertRealPathInsideRoot(root, abs, `Local Markdown tree path escapes the notes root: ${path}`)
  return {
    notebookId: LOCAL_MARKDOWN_NOTEBOOK_ID,
    nodes: await listTreeNodes(root, abs),
  }
}

export async function createLocalMarkdownUserItem(
  notesRoot: string,
  args: LocalMarkdownCreateArgs,
): Promise<LocalMarkdownCreateResult> {
  await ensureNotesDirs(notesRoot)
  if (args.op === 'notebook') {
    throw new KnowledgeError(
      'UNSUPPORTED_OPERATION',
      'local-markdown has one workspace-scoped notebook; create folders or documents inside it',
    )
  }
  if (args.op === 'folder') {
    if (typeof args.name !== 'string' || args.name.trim().length === 0) {
      throw new KnowledgeError('INVALID_REF', 'local-markdown folder name is required')
    }
    const parent = relativeDirFromNavigatorPath(args.path)
    const folderName = sanitizeFilename(args.name.trim()).replace(/\.md$/i, '') || 'Untitled'
    const root = resolve(notesRoot)
    const parentPath = resolve(root, parent)
    const folderPath = resolve(root, parent, folderName)
    if (!isInsidePath(root, parentPath) || !isInsidePath(root, folderPath)) {
      throw new KnowledgeError('INVALID_REF', `Invalid local notes folder: ${args.path}`)
    }
    await ensureSafeDirectory(root, parentPath, `Local Markdown folder parent escapes the notes root: ${args.path}`)
    await ensureSafeDirectory(root, folderPath, `Local Markdown folder escapes the notes root: ${args.name}`)
    return { path: `/${toSlashPath(relative(root, folderPath))}` }
  }
  if (args.op === 'document') {
    if (typeof args.title !== 'string' || args.title.trim().length === 0) {
      throw new KnowledgeError('INVALID_REF', 'local-markdown document title is required')
    }
    const parent = relativeDirFromNavigatorPath(args.path)
    const note = await createLocalMarkdownNote(notesRoot, args.title, parent)
    return { id: note.noteId }
  }
  throw new KnowledgeError('INVALID_REF', `local-markdown unknown create op: ${String((args as { op?: string }).op)}`)
}

export class LocalMarkdownKnowledgeProvider implements KnowledgeProvider {
  constructor(
    private readonly options: {
      connection: KnowledgeConnection
      workspaceId: string
      notesRoot: string
    },
  ) {}

  async capabilities(): Promise<KnowledgeCapabilities> {
    return {
      provider: LOCAL_MARKDOWN_KNOWLEDGE_PROVIDER,
      version: '1.0.0',
      minSupportedVersion: '1.0.0',
      features: {
        search: true,
        backlinks: true,
        attributes: true,
        databases: false,
        assets: false,
        liveReference: true,
        watch: true,
        deepLinks: true,
      },
      mutations: {
        createDocument: true,
        appendBlock: false,
        updateBlock: false,
        setAttribute: false,
        transactions: false,
        rollback: false,
      },
    }
  }

  async search(input: SearchInput): Promise<SearchPage> {
    const limit = Math.max(1, Math.min(input.limit ?? 20, 100))
    const query = input.query.trim().toLowerCase()
    const kinds = input.kinds ?? ['document', 'block']
    if (input.notebookId && input.notebookId !== LOCAL_MARKDOWN_NOTEBOOK_ID) {
      return { items: [], totalEstimate: 0 }
    }
    if (!kinds.includes('document') && !kinds.includes('block')) {
      return { items: [], totalEstimate: 0 }
    }
    const pathPrefix = pathPrefixToNoteId(input.pathPrefix)
    const notes = await listLocalMarkdownNotes(this.options.notesRoot)
    const hits = notes
      .filter((note) => !pathPrefix || note.noteId === pathPrefix || note.noteId.startsWith(`${pathPrefix}/`))
      .map((note) => ({ note, score: scoreNote(note, query) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score || b.note.updatedAt - a.note.updatedAt || a.note.noteId.localeCompare(b.note.noteId))
      .slice(0, limit)
      .map(({ note, score }) => ({
        ref: this.refForNote(note),
        title: note.title,
        snippet: makeSnippet(note, query),
        notebookPath: `/Local Markdown/${note.noteId}`,
        updatedAt: note.updatedAt,
        score,
        attributes: Object.fromEntries(attributesFromProperties(note.properties).map((a) => [a.key, a.value])),
      }))
    return { items: hits, totalEstimate: hits.length }
  }

  async get(ref: KnowledgeRef): Promise<KnowledgeNode> {
    if (ref.scheme !== 'local-note' && ref.provider !== LOCAL_MARKDOWN_KNOWLEDGE_PROVIDER) {
      throw new KnowledgeError('INVALID_REF', `local-markdown cannot read scheme '${ref.scheme}'`)
    }
    if (ref.kind === 'notebook') {
      assertLocalNotebook(ref.id)
      const now = Date.now()
      return {
        ref: { scheme: 'local-note', kind: 'notebook', id: LOCAL_MARKDOWN_NOTEBOOK_ID, connectionId: this.options.connection.id },
        title: 'Local Markdown',
        path: '/Local Markdown',
        attributes: [],
        createdAt: now,
        updatedAt: now,
        contentHash: await hashKnowledgeContent(LOCAL_MARKDOWN_NOTEBOOK_ID),
      }
    }
    if (ref.kind !== 'document' && ref.kind !== 'block') {
      throw new KnowledgeError('UNSUPPORTED_OPERATION', `local-markdown does not support ${ref.kind} refs`)
    }
    const note = await readLocalMarkdownNote(this.options.notesRoot, ref.id)
    return {
      ref: this.refForNote(note),
      title: note.title,
      markdown: note.content,
      path: `/${note.noteId}`,
      attributes: attributesFromProperties(note.properties),
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
      contentHash: await hashKnowledgeContent(note.content),
      blockCount: note.body.split(/\n\s*\n/).filter((part) => part.trim()).length || 1,
    }
  }

  async getContext(ref: KnowledgeRef, mode: ContextMode): Promise<ContextPayload> {
    const node = await this.get(ref)
    return {
      ref: node.ref,
      mode,
      blockId: node.ref.id,
      content: node.markdown ?? '',
      children: [],
      backlinks: await this.findBacklinks(node),
      attributes: node.attributes,
      capturedAt: Date.now(),
      contentHash: node.contentHash,
    }
  }

  async proposeMutation(_input: MutationInput): Promise<MutationProposal> {
    throw new KnowledgeError(
      'UNSUPPORTED_OPERATION',
      'local-markdown mutations are handled by the explicit userCreate path in this release',
    )
  }

  async applyMutation(_proposalId: string): Promise<ApplyResult> {
    throw new KnowledgeError(
      'UNSUPPORTED_OPERATION',
      'local-markdown proposal apply is not enabled in this release',
    )
  }

  async open(ref: KnowledgeRef): Promise<void> {
    await this.get(ref)
  }

  private refForNote(note: Pick<LocalMarkdownNote, 'noteId'>): KnowledgeRef {
    return {
      scheme: 'local-note',
      kind: 'document',
      id: note.noteId,
      connectionId: this.options.connection.id,
    }
  }

  private async findBacklinks(node: KnowledgeNode): Promise<ContextPayload['backlinks']> {
    const title = node.title.toLowerCase()
    const id = node.ref.id.toLowerCase()
    const leaf = basename(node.ref.id).toLowerCase()
    const matches = new Set([id, leaf, title])
    const notes = await listLocalMarkdownNotes(this.options.notesRoot)
    const backlinks: ContextPayload['backlinks'] = []
    for (const note of notes) {
      if (note.noteId === node.ref.id) continue
      const links = extractWikilinks(note.content)
      if (links.some((target) => matches.has(normalizeWikiTarget(target)))) {
        backlinks.push({ ref: this.refForNote(note), title: note.title })
      }
    }
    return backlinks
  }
}

async function ensureNotesDirs(notesRoot: string): Promise<void> {
  const root = resolve(notesRoot)
  await mkdir(root, { recursive: true })
  await ensureSafeDirectory(root, join(root, ASSETS_DIR), `Local Markdown assets directory escapes the notes root`)
  await ensureSafeDirectory(root, join(root, DAILY_DIR), `Local Markdown daily directory escapes the notes root`)
  await ensureSafeDirectory(root, join(root, TEMPLATES_DIR), `Local Markdown templates directory escapes the notes root`)
  await ensureSafeDirectory(root, join(root, PROJECTS_DIR), `Local Markdown projects directory escapes the notes root`)
}

async function createLocalMarkdownNote(notesRoot: string, title: string, folder?: string): Promise<LocalMarkdownNote> {
  await ensureNotesDirs(notesRoot)
  const safeFolder = folder ? assertSafeLocalNoteId(folder) : ''
  const root = resolve(notesRoot)
  const dir = safeFolder ? resolve(root, safeFolder) : root
  if (!isInsidePath(root, dir)) {
    throw new KnowledgeError('INVALID_REF', `Invalid local notes folder: ${folder}`)
  }
  await ensureSafeDirectory(root, dir, `Local Markdown note folder escapes the notes root: ${folder ?? '/'}`)
  const base = sanitizeFilename(title.trim() || 'Untitled').replace(/\.md$/i, '') || 'Untitled'
  let filePath = join(dir, `${base}.md`)
  let suffix = 2
  while (existsSync(filePath)) {
    filePath = join(dir, `${base}-${suffix++}.md`)
  }
  await writeFile(filePath, buildInitialNoteContent(title.trim() || 'Untitled'), 'utf-8')
  return readLocalMarkdownNote(root, noteIdFromRelativePath(relative(root, filePath)))
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

async function listLocalMarkdownNotes(notesRoot: string): Promise<LocalMarkdownNote[]> {
  await ensureNotesDirs(notesRoot)
  const root = resolve(notesRoot)
  const files = await listMarkdownFiles(root)
  const notes: LocalMarkdownNote[] = []
  for (const filePath of files) {
    try {
      notes.push(await readLocalMarkdownNote(root, noteIdFromRelativePath(relative(root, filePath))))
    } catch {
      continue
    }
  }
  return notes.sort((a, b) => a.noteId.localeCompare(b.noteId))
}

async function readLocalMarkdownNote(notesRoot: string, noteId: string): Promise<LocalMarkdownNote> {
  const root = resolve(notesRoot)
  const filePath = notePathFromId(root, noteId)
  let content = ''
  let info: Awaited<ReturnType<typeof stat>>
  try {
    const [realRoot, realFile] = await Promise.all([realpath(root), realpath(filePath)])
    if (!isInsidePath(realRoot, realFile)) {
      throw new KnowledgeError('INVALID_REF', `Local Markdown note escapes the notes root: ${noteId}`)
    }
    ;[content, info] = await Promise.all([readFile(realFile, 'utf-8'), stat(realFile)])
  } catch (error) {
    if (error instanceof KnowledgeError) throw error
    throw new KnowledgeError('NOT_FOUND', `Local Markdown note not found: ${noteId}`)
  }
  const parsed = parseFrontmatter(content)
  const cleanId = assertSafeLocalNoteId(noteId)
  return {
    noteId: cleanId,
    relativePath: `${cleanId}.md`,
    filePath,
    title: titleFromNote(cleanId, parsed.properties, parsed.body),
    content,
    body: parsed.body,
    properties: parsed.properties,
    createdAt: info.birthtimeMs || info.ctimeMs || info.mtimeMs,
    updatedAt: info.mtimeMs,
  }
}

async function listMarkdownFiles(dir: string, root = dir): Promise<string[]> {
  await assertRealPathInsideRoot(root, dir, `Local Markdown search path escapes the notes root`)
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const files: string[] = []
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const abs = join(dir, entry.name)
    const rel = toSlashPath(relative(root, abs))
    if (entry.isDirectory()) {
      if (isIgnoredTreePath(rel)) continue
      files.push(...await listMarkdownFiles(abs, root))
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      files.push(abs)
    }
  }
  return files
}

async function listTreeNodes(root: string, dir: string): Promise<SiyuanDocTreeNode[]> {
  await assertRealPathInsideRoot(root, dir, `Local Markdown tree path escapes the notes root`)
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const nodes: SiyuanDocTreeNode[] = []
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const abs = join(dir, entry.name)
    const rel = toSlashPath(relative(root, abs))
    if (entry.isDirectory()) {
      if (isIgnoredTreePath(rel)) continue
      nodes.push({
        id: rel,
        name: entry.name,
        path: `/${rel}`,
        kind: 'folder',
        children: await listTreeNodes(root, abs),
      })
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      const id = noteIdFromRelativePath(rel)
      nodes.push({
        id,
        name: basename(entry.name, extname(entry.name)),
        path: `/${rel}`,
        kind: 'document',
      })
    }
  }
  return nodes.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name))
}

function parseFrontmatter(content: string): { properties: Record<string, unknown>; body: string } {
  try {
    const parsed = matter(content)
    return { properties: (parsed.data ?? {}) as Record<string, unknown>, body: parsed.content ?? '' }
  } catch {
    return { properties: {}, body: content }
  }
}

function attributesFromProperties(properties: Record<string, unknown>): KnowledgeAttribute[] {
  return Object.entries(properties)
    .filter(([key]) => key !== 'title')
    .map(([key, value]) => ({ key, value: stringifyAttributeValue(value) }))
    .filter((attr) => attr.value.length > 0)
}

function stringifyAttributeValue(value: unknown): string {
  if (Array.isArray(value)) return value.map((v) => stringifyAttributeValue(v)).filter(Boolean).join(', ')
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

function titleFromNote(noteId: string, properties: Record<string, unknown>, body: string): string {
  const frontmatterTitle = properties.title
  if (typeof frontmatterTitle === 'string' && frontmatterTitle.trim()) return frontmatterTitle.trim()
  const firstHeading = body.match(/^#\s+(.+)$/m)
  if (firstHeading?.[1]?.trim()) return firstHeading[1].trim()
  return basename(noteId)
}

function scoreNote(note: LocalMarkdownNote, query: string): number {
  if (!query) return 1
  let score = 0
  const title = note.title.toLowerCase()
  const body = note.body.toLowerCase()
  if (title === query) score += 100
  if (title.includes(query)) score += 50
  if (note.noteId.toLowerCase().includes(query)) score += 25
  if (body.includes(query)) score += 10
  return score
}

function makeSnippet(note: LocalMarkdownNote, query: string): string {
  const source = (note.body.trim() || note.content.trim()).replace(/\s+/g, ' ')
  if (!source) return ''
  if (!query) return source.slice(0, 240)
  const idx = source.toLowerCase().indexOf(query)
  if (idx < 0) return source.slice(0, 240)
  const start = Math.max(0, idx - 80)
  return source.slice(start, start + 240)
}

function extractWikilinks(content: string): string[] {
  const links: string[] = []
  for (const match of content.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]+)?\]\]/g)) {
    if (match[1]?.trim()) links.push(match[1].trim())
  }
  return links
}

function normalizeWikiTarget(value: string): string {
  return stripMdExtension(value.trim()).toLowerCase()
}

function pathPrefixToNoteId(pathPrefix: string | undefined): string {
  if (!pathPrefix) return ''
  return stripMdExtension(pathPrefix.replace(/^\/+|\/+$/g, ''))
}

function relativeDirFromNavigatorPath(path: string | undefined): string {
  const normalized = (path || '/').trim().replace(/^\/+|\/+$/g, '')
  if (!normalized) return ''
  return assertSafeLocalNoteId(stripMdExtension(normalized))
}

function notePathFromId(notesRoot: string, noteId: string): string {
  const safeId = assertSafeLocalNoteId(noteId)
  const root = resolve(notesRoot)
  const resolved = resolve(root, `${safeId}.md`)
  if (!isInsidePath(root, resolved)) {
    throw new KnowledgeError('INVALID_REF', `Invalid local Markdown note id: ${noteId}`)
  }
  return resolved
}

function assertSafeLocalNoteId(noteId: string): string {
  const safe = stripMdExtension(noteId).replace(/^\/+/, '')
  if (!safe || safe.includes('\\') || safe.split('/').some((part) => part === '..' || part === '')) {
    throw new KnowledgeError('INVALID_REF', `Invalid local Markdown note id: ${noteId}`)
  }
  return safe
}

function assertLocalNotebook(notebookId: string): void {
  if (notebookId !== LOCAL_MARKDOWN_NOTEBOOK_ID && notebookId !== '__full__') {
    throw new KnowledgeError('NOT_FOUND', `Local Markdown notebook not found: ${notebookId}`)
  }
}

function noteIdFromRelativePath(relativePath: string): string {
  return stripMdExtension(toSlashPath(relativePath))
}

function stripMdExtension(path: string): string {
  return path.toLowerCase().endsWith('.md') ? path.slice(0, -3) : path
}

function toSlashPath(path: string): string {
  return path.split(sep).join('/')
}

function isInsidePath(root: string, candidate: string): boolean {
  const normalizedRoot = resolve(root)
  const normalizedCandidate = resolve(candidate)
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}${sep}`)
}

async function ensureSafeDirectory(root: string, dir: string, message: string): Promise<void> {
  await assertPathAncestorInsideRoot(root, dir, message)
  await mkdir(dir, { recursive: true })
  await assertRealPathInsideRoot(root, dir, message)
}

async function assertPathAncestorInsideRoot(root: string, candidate: string, message: string): Promise<void> {
  let existing = candidate
  while (!existsSync(existing)) {
    const parent = dirname(existing)
    if (parent === existing) break
    existing = parent
  }
  await assertRealPathInsideRoot(root, existing, message)
}

async function assertRealPathInsideRoot(root: string, candidate: string, message: string): Promise<void> {
  try {
    const [realRoot, realCandidate] = await Promise.all([realpath(root), realpath(candidate)])
    if (!isInsidePath(realRoot, realCandidate)) {
      throw new KnowledgeError('INVALID_REF', message)
    }
  } catch (error) {
    if (error instanceof KnowledgeError) throw error
    throw new KnowledgeError('NOT_FOUND', message)
  }
}

function isIgnoredTreePath(rel: string): boolean {
  const first = rel.split('/')[0]
  return TREE_IGNORED_DIRS.has(first)
}
