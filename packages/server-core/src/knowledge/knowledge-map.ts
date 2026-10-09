/**
 * Knowledge Map — pure, deterministic corpus collector (plan §3.2 / slice A1).
 *
 * Scans three read-only sources and turns them into a `KnowledgeMapDto`
 * (nodes + edges + honest stats) for the renderer's radial graph:
 *   - `context` — `<configDir>/context/*.md`
 *   - `memory`  — `<configDir>/memory/*.md` + the last 50 `memory/history/*.md`
 *   - `notes`   — markdown under the workspace notes root (recursive),
 *                 excluding `assets/`, `templates/`, `.craft/`, `.git/`
 *
 * No writes, no sqlite, no new dependencies. A missing root or an unreadable
 * file never throws — the corpus is derived, so it degrades to an empty map.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import type { Dirent } from 'fs'
import { join, relative } from 'path'
import type {
  KnowledgeMapArea,
  KnowledgeMapDto,
  KnowledgeMapEdge,
  KnowledgeMapNode,
} from '@rox/shared/knowledge/knowledge-map-types'

/** Default document cap for the recursively scanned notes area. */
export const KNOWLEDGE_MAP_DEFAULT_MAX_DOCS = 400
/** Default per-file cap (2 MiB); larger files are counted as skipped. */
export const KNOWLEDGE_MAP_DEFAULT_MAX_BYTES_PER_DOC = 2 * 1024 * 1024
/** How many recent `memory/history/*.md` files join the corpus. */
export const MEMORY_HISTORY_LIMIT = 50

const NOTES_EXCLUDED_DIRS: Record<string, true> = { assets: true, templates: true }

export interface BuildKnowledgeMapInput {
  /** Profile config dir (`<CONFIG_DIR>`); context and memory live here. */
  configDir: string
  /** Workspace notes root, or null when no workspace is resolved. */
  notesRoot: string | null
  /** Root node label (user name or the generic profile label). */
  rootLabel: string
  /** Optional corpus caps (plan §3.2). */
  limits?: { maxDocs?: number; maxBytesPerDoc?: number }
}

type DocRecord = {
  area: KnowledgeMapArea
  relPath: string
  id: string
  label: string
  size: number
  outbound: string[]
}

type ReadResult =
  | { kind: 'ok'; relPath: string; size: number; content: string }
  | { kind: 'skip' }

// ---------------------------------------------------------------- fs helpers

function nfc(value: string): string {
  return value.normalize('NFC')
}

/** Top-level `*.md` files of a directory (sorted by filename); [] when absent. */
function listMarkdownFilesFlat(dir: string): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return []
  }
  return entries
    .filter((name) => name.toLowerCase().endsWith('.md'))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((name) => join(dir, name))
}

/** Recursive `*.md` files, skipping dot-dirs and the notes reserved dirs. */
function listMarkdownFilesRecursive(dir: string): string[] {
  const out: string[] = []
  let entries: Dirent[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  const names = entries
    .map((entry) => ({ entry, name: entry.name }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  for (const { entry, name } of names) {
    if (entry.isDirectory()) {
      if (name.startsWith('.') || NOTES_EXCLUDED_DIRS[name] === true) continue
      out.push(...listMarkdownFilesRecursive(join(dir, name)))
    } else if (entry.isFile() && name.toLowerCase().endsWith('.md')) {
      out.push(join(dir, name))
    }
  }
  return out
}

/** Stat + read one document; oversized (bytes cap) or unreadable → skip. */
function readDoc(rootDir: string, absPath: string, maxBytesPerDoc: number): ReadResult {
  let size: number
  try {
    const info = statSync(absPath)
    if (!info.isFile() || info.size > maxBytesPerDoc) return { kind: 'skip' }
    size = info.size
  } catch {
    return { kind: 'skip' }
  }
  let content: string
  try {
    content = readFileSync(absPath, 'utf-8')
  } catch {
    return { kind: 'skip' }
  }
  const relPath = nfc(relative(rootDir, absPath).split('\\').join('/'))
  return { kind: 'ok', relPath, size, content }
}

// ------------------------------------------------------------- text parsing

/** Drop a leading YAML frontmatter block (`--- ... ---`) so bodies parse cleanly. */
function stripFrontmatter(text: string): string {
  if (!text.startsWith('---')) return text
  const match = text.match(/^---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?/)
  return match ? text.slice(match[0].length) : text
}

/** First ATX H1 heading of the body, else null. */
function extractHeading(body: string): string | null {
  for (const line of body.split(/\r?\n/)) {
    const match = line.match(/^#[ \t]+(.*?)[ \t]*#*[ \t]*$/)
    const text = match?.[1]?.trim()
    if (text) return text
  }
  return null
}

const WIKI_LINK_RE = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g
const MD_LINK_RE = /(?<!!)\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g

/** Extract outbound link targets: wiki targets plus relative markdown refs. */
function extractLinkTargets(body: string): Array<{ target: string; wiki: boolean }> {
  const links: Array<{ target: string; wiki: boolean }> = []
  for (const match of body.matchAll(WIKI_LINK_RE)) {
    const target = match[1]?.trim()
    if (target) links.push({ target, wiki: true })
  }
  for (const match of body.matchAll(MD_LINK_RE)) {
    let ref = match[1].trim()
    if (ref.startsWith('<') && ref.endsWith('>')) ref = ref.slice(1, -1)
    if (!ref || ref.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(ref)) continue
    const clean = ref.split('#')[0]!.split('?')[0]!
    if (!clean.toLowerCase().endsWith('.md')) continue
    links.push({ target: clean, wiki: false })
  }
  return links
}

// ------------------------------------------------------------- link resolve

/** Normalize a target/resolved path to a comparison key (no ext, NFC, lowercase). */
function targetKey(value: string): string {
  let out = nfc(value.replace(/\\/g, '/')).trim()
  if (out.startsWith('./')) out = out.slice(2)
  out = out.replace(/^\/+|\/+$/g, '')
  return (out.toLowerCase().endsWith('.md') ? out.slice(0, -3) : out).toLowerCase()
}

/** Resolve a relative markdown ref against the source document's directory. */
function resolveRelativePath(fromRelPath: string, ref: string): string {
  const slash = fromRelPath.lastIndexOf('/')
  const base = slash === -1 ? '' : fromRelPath.slice(0, slash)
  const parts = (base ? base.split('/') : []).concat(ref.split('/'))
  const out: string[] = []
  for (const part of parts) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      out.pop()
      continue
    }
    out.push(part)
  }
  return out.join('/')
}

// ---------------------------------------------------------------- build

export function buildKnowledgeMap(input: BuildKnowledgeMapInput): KnowledgeMapDto {
  const { configDir, notesRoot, rootLabel } = input
  const maxDocs = input.limits?.maxDocs ?? KNOWLEDGE_MAP_DEFAULT_MAX_DOCS
  const maxBytesPerDoc = input.limits?.maxBytesPerDoc ?? KNOWLEDGE_MAP_DEFAULT_MAX_BYTES_PER_DOC

  let truncated = false
  let skipped = 0
  // Documents discovered but dropped by a cap (notes doc-count cap or the
  // memory-history limit); the pre-limit `total` is `files + droppedByCap`.
  let droppedByCap = 0

  const docs: DocRecord[] = []
  const pushDoc = (area: KnowledgeMapArea, rootDir: string, absPath: string): void => {
    const result = readDoc(rootDir, absPath, maxBytesPerDoc)
    if (result.kind === 'skip') {
      skipped += 1
      return
    }
    const body = stripFrontmatter(result.content)
    const name = result.relPath.replace(/^.*\//, '')
    const fallback = nfc(name.toLowerCase().endsWith('.md') ? name.slice(0, -3) : name)
    const label = extractHeading(body) ?? fallback
    docs.push({
      area,
      relPath: result.relPath,
      id: `${area}:${result.relPath}`,
      label: label || fallback,
      size: result.size,
      outbound: extractLinkTargets(body).map((link) =>
        link.wiki ? link.target : resolveRelativePath(result.relPath, link.target)),
    })
  }

  // context
  const contextRoot = join(configDir, 'context')
  for (const abs of listMarkdownFilesFlat(contextRoot)) pushDoc('context', contextRoot, abs)

  // memory (+ last N history files)
  const memoryRoot = join(configDir, 'memory')
  for (const abs of listMarkdownFilesFlat(memoryRoot)) pushDoc('memory', memoryRoot, abs)
  const historyRoot = join(memoryRoot, 'history')
  let history = listMarkdownFilesFlat(historyRoot)
  if (history.length > MEMORY_HISTORY_LIMIT) {
    truncated = true
    droppedByCap += history.length - MEMORY_HISTORY_LIMIT
    history = history.slice(history.length - MEMORY_HISTORY_LIMIT)
  }
  for (const abs of history) pushDoc('memory', memoryRoot, abs)

  // notes (recursive, capped)
  if (notesRoot && existsSync(notesRoot)) {
    let notePaths = listMarkdownFilesRecursive(notesRoot).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    if (notePaths.length > maxDocs) {
      truncated = true
      droppedByCap += notePaths.length - maxDocs
      notePaths = notePaths.slice(0, maxDocs)
    }
    for (const abs of notePaths) pushDoc('notes', notesRoot, abs)
  }

  // Resolution indexes: exact relative path (no ext) and basename → node id.
  const byRelPath = new Map<string, string>()
  const byBasename = new Map<string, string[]>()
  for (const doc of docs) {
    byRelPath.set(targetKey(doc.relPath), doc.id)
    const base = targetKey(doc.relPath.replace(/^.*\//, ''))
    const list = byBasename.get(base)
    if (list) list.push(doc.id)
    else byBasename.set(base, [doc.id])
  }
  for (const list of byBasename.values()) list.sort()

  const resolveTarget = (key: string): string | null => {
    const normalized = targetKey(key)
    if (!normalized) return null
    const exact = byRelPath.get(normalized)
    if (exact) return exact
    const base = normalized.replace(/^.*\//, '')
    const candidates = byBasename.get(base)
    return candidates && candidates.length > 0 ? candidates[0]! : null
  }

  // Edges (deduped; self-links dropped).
  const edges: KnowledgeMapEdge[] = []
  const seen = new Set<string>()
  const linkCount = new Map<string, number>()
  const addEdge = (source: string, target: string, kind: KnowledgeMapEdge['kind']): void => {
    if (source === target) return
    const key = `${kind}\u0000${source}\u0000${target}`
    if (seen.has(key)) return
    seen.add(key)
    edges.push({ source, target, kind })
    if (kind === 'link') linkCount.set(source, (linkCount.get(source) ?? 0) + 1)
  }

  const areas: KnowledgeMapArea[] = []
  for (const area of ['context', 'memory', 'notes'] as const) {
    if (docs.some((doc) => doc.area === area)) areas.push(area)
  }

  for (const doc of docs) {
    for (const target of doc.outbound) {
      const resolved = resolveTarget(target)
      if (resolved) addEdge(doc.id, resolved, 'link')
    }
  }
  for (const area of areas) {
    addEdge('root', `area:${area}`, 'member')
    for (const doc of docs) {
      if (doc.area === area) addEdge(`area:${area}`, doc.id, 'member')
    }
  }

  // Nodes — root, areas, then docs; each group deterministically ordered.
  const nodes: KnowledgeMapNode[] = [
    { id: 'root', label: rootLabel, area: 'root', kind: 'root', size: 0, linkCount: 0, relPath: null },
  ]
  for (const area of areas) {
    nodes.push({ id: `area:${area}`, label: area, area, kind: 'area', size: 0, linkCount: 0, relPath: null })
  }
  for (const doc of [...docs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    nodes.push({
      id: doc.id,
      label: doc.label,
      area: doc.area,
      kind: 'doc',
      size: doc.size,
      linkCount: linkCount.get(doc.id) ?? 0,
      relPath: doc.relPath,
    })
  }
  edges.sort((a, b) => (a.source < b.source ? -1 : a.source > b.source ? 1
    : a.target < b.target ? -1 : a.target > b.target ? 1
      : a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0))

  return {
    generatedAt: new Date().toISOString(),
    rootLabel,
    nodes,
    edges,
    stats: {
      files: docs.length,
      total: docs.length + droppedByCap,
      links: edges.reduce((count, edge) => (edge.kind === 'link' ? count + 1 : count), 0),
      areas: areas.length,
      bytes: docs.reduce((bytes, doc) => bytes + doc.size, 0),
      truncated,
      skipped,
    },
  }
}