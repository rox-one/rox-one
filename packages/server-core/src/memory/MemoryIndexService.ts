/**
 * MemoryIndexService — per-workspace memory chunk index (spec c1.1).
 *
 * Resolves the workspace's memory documents, chunks them deterministically,
 * and drives one of the two `MemoryIndexBackend`s. Owns the index identity and
 * staleness: a chunking-version (or provider/model) change, or a changed source
 * corpus, marks the index stale and the next search rebuilds it.
 *
 * Fail-soft like the rest of the memory stack: a broken source or a broken
 * index degrades to "nothing retrievable", never a thrown recall error.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import type {
  MemoryGetResult,
  MemoryIndexCapability,
  MemoryIndexStatus,
  MemorySearchHit,
  MemorySearchResult,
  MemoryChunkProvenance,
  MemoryOriginClass,
  MemorySessionKind,
} from '@rox/shared/memory/types'
import {
  CHUNK_META_FILE,
  chunkDocuments,
  createMemoryIndexBackend,
  memoryIndexIdentity,
  probeMemoryIndexCapability,
  searchMemoryIndex,
  type ChunkSourceDoc,
  type MemoryChunk,
  type MemoryIndexBackend,
} from './chunk-index'

/** Persisted index state sidecar. */
export interface MemoryIndexMeta {
  chunkingVersion: number
  indexIdentity: string
  backend: 'fts5' | 'js'
  builtAt: string
  chunkCount: number
}

export interface MemoryIndexServiceDeps {
  workspaceRoot: string
  workspaceId?: string
  clock?: () => number
  logger?: { warn: (msg: string, err?: unknown) => void }
  /** Test seam: override source collection. */
  collectDocs?: (workspaceRoot: string) => ChunkSourceDoc[]
}

const SNIPPET_CHARS = 240

/** Map a file kind to the session kind of its writer (used for default provenance). */
const DEFAULT_SESSION_KIND: MemorySessionKind = 'subagent'

function relList(dir: string, suffix: string): string[] {
  try {
    if (!existsSync(dir)) return []
    return readdirSync(dir)
      .filter(name => name.endsWith(suffix))
      .sort()
      .map(name => join(dir, name))
  } catch {
    return []
  }
}

function readIfExists(path: string): string | null {
  try {
    return existsSync(path) ? readFileSync(path, 'utf8') : null
  } catch {
    return null
  }
}

function observedAtFor(path: string, fallback: number): string {
  try {
    return new Date(statSync(path).mtimeMs).toISOString()
  } catch {
    return new Date(fallback).toISOString()
  }
}

/**
 * Provenance overrides recorded at write time: `{ "<relative path>": provenance }`
 * in `memory/index-provenance.json`. Anything not listed falls back to the
 * default classification below. This is the seam through which a producer
 * stamps trust; it is never derived from document text.
 */
function loadProvenanceOverrides(memoryDir: string): Record<string, MemoryChunkProvenance> {
  try {
    const raw = readFileSync(join(memoryDir, 'index-provenance.json'), 'utf8')
    const parsed = JSON.parse(raw) as Record<string, MemoryChunkProvenance>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/**
 * Collect the workspace's memory documents with provenance. Default classes:
 * distilled context/history and agent-written MEMORY.md are `agent`; explicit
 * user lessons are `owner`; everything else is `agent` unless overridden.
 */
export function collectMemorySourceDocs(workspaceRoot: string, now: number = Date.now()): ChunkSourceDoc[] {
  const memoryDir = join(workspaceRoot, 'memory')
  const overrides = loadProvenanceOverrides(memoryDir)
  const docs: ChunkSourceDoc[] = []
  const prov = (relPath: string, absPath: string, fallback?: Partial<MemoryChunkProvenance>): MemoryChunkProvenance => {
    const override = overrides[relPath]
    if (override?.originClass) return override
    return {
      originClass: (fallback?.originClass ?? 'agent') as MemoryOriginClass,
      sessionKind: (fallback?.sessionKind ?? DEFAULT_SESSION_KIND) as MemorySessionKind,
      observedAt: observedAtFor(absPath, now),
    }
  }

  const contextPath = join(memoryDir, 'context.md')
  const context = readIfExists(contextPath)
  if (context?.trim()) docs.push({ path: 'memory/context.md', content: context, provenance: prov('memory/context.md', contextPath) })

  for (const abs of relList(join(memoryDir, 'history'), '.md')) {
    const content = readIfExists(abs)
    const rel = `memory/history/${abs.slice(abs.lastIndexOf('/') + 1)}`
    if (content?.trim()) docs.push({ path: rel, content, provenance: prov(rel, abs) })
  }

  const lessonsPath = join(memoryDir, 'lessons.jsonl')
  const lessons = readIfExists(lessonsPath)
  if (lessons) {
    for (const line of lessons.split('\n')) {
      if (!line.trim()) continue
      let rule = ''
      let explicit = false
      try {
        const parsed = JSON.parse(line) as { rule?: string; source?: { trigger?: string } }
        rule = typeof parsed.rule === 'string' ? parsed.rule : ''
        explicit = parsed.source?.trigger === 'explicit'
      } catch {
        continue
      }
      if (!rule.trim()) continue
      const rel = 'memory/lessons.jsonl'
      const base = prov(rel, lessonsPath, explicit ? { originClass: 'owner', sessionKind: 'interactive' } : undefined)
      docs.push({
        path: rel,
        content: rule,
        provenance: { ...base, observedAt: observedAtFor(lessonsPath, now) },
      })
    }
  }

  const projectsDir = join(workspaceRoot, 'projects')
  if (existsSync(projectsDir)) {
    let slugs: string[] = []
    try {
      slugs = readdirSync(projectsDir).sort()
    } catch {
      slugs = []
    }
    for (const slug of slugs) {
      const abs = join(projectsDir, slug, 'MEMORY.md')
      const content = readIfExists(abs)
      const rel = `projects/${slug}/MEMORY.md`
      if (content?.trim()) docs.push({ path: rel, content, provenance: prov(rel, abs) })
    }
  }

  return docs
}

export class MemoryIndexService {
  private readonly deps: MemoryIndexServiceDeps
  private readonly clock: () => number
  private readonly logger: { warn: (msg: string, err?: unknown) => void }
  private backend: MemoryIndexBackend | null = null
  private meta: MemoryIndexMeta | null | undefined

  constructor(deps: MemoryIndexServiceDeps) {
    this.deps = deps
    this.clock = deps.clock ?? (() => Date.now())
    this.logger = deps.logger ?? { warn: () => {} }
  }

  private get memoryDir(): string {
    return join(this.deps.workspaceRoot, 'memory')
  }

  private get backendInstance(): MemoryIndexBackend {
    return (this.backend ??= createMemoryIndexBackend(this.memoryDir))
  }

  capability(): MemoryIndexCapability {
    return probeMemoryIndexCapability()
  }

  private collect(): ChunkSourceDoc[] {
    try {
      return this.deps.collectDocs
        ? this.deps.collectDocs(this.deps.workspaceRoot)
        : collectMemorySourceDocs(this.deps.workspaceRoot, this.clock())
    } catch (err) {
      this.logger.warn('MemoryIndexService: source collection failed', err)
      return []
    }
  }

  private readMeta(): MemoryIndexMeta | null {
    if (this.meta !== undefined) return this.meta
    try {
      const raw = readFileSync(join(this.memoryDir, CHUNK_META_FILE), 'utf8')
      this.meta = JSON.parse(raw) as MemoryIndexMeta
    } catch {
      this.meta = null
    }
    return this.meta
  }

  /** Current staleness of the persisted index (no rebuild). */
  private metaState(meta: MemoryIndexMeta | null): 'absent' | 'ready' | 'stale' {
    if (!meta) return 'absent'
    const identity = memoryIndexIdentity()
    if (meta.chunkingVersion !== identity.chunkingVersion || meta.indexIdentity !== identity.indexIdentity) return 'stale'
    return 'ready'
  }

  status(): MemoryIndexStatus {
    const capability = this.capability()
    const identity = memoryIndexIdentity()
    let meta = this.readMeta()
    let state: MemoryIndexStatus['state'] = this.metaState(meta)
    // A chunking-version bump also invalidates the on-disk build: rebuild on read.
    let chunks = meta?.chunkCount
    if (state === 'ready' && meta) {
      try {
        chunks = this.backendInstance.count()
      } catch (err) {
        this.logger.warn('MemoryIndexService: index count failed', err)
        return { state: 'failed', safeError: 'index unreadable', capability, indexIdentity: identity.indexIdentity }
      }
      // A missing/emptied backend behind a ready meta is stale, not ready.
      if ((chunks ?? 0) !== meta.chunkCount) state = 'stale'
    }
    return {
      state,
      chunks: state === 'ready' ? (chunks ?? 0) : 0,
      updatedAt: state === 'ready' && meta ? Date.parse(meta.builtAt) || undefined : undefined,
      capability,
      indexIdentity: identity.indexIdentity,
      chunkingVersion: identity.chunkingVersion,
      backend: this.backend?.kind ?? (capability.fts5 ? 'fts5' : 'js'),
    }
  }

  private writeMeta(chunks: number): MemoryIndexMeta {
    const identity = memoryIndexIdentity()
    const meta: MemoryIndexMeta = {
      chunkingVersion: identity.chunkingVersion,
      indexIdentity: identity.indexIdentity,
      backend: this.backendInstance.kind,
      builtAt: new Date(this.clock()).toISOString(),
      chunkCount: chunks,
    }
    try {
      mkdirSync(this.memoryDir, { recursive: true })
      writeFileSync(join(this.memoryDir, CHUNK_META_FILE), JSON.stringify(meta, null, 2))
    } catch (err) {
      this.logger.warn('MemoryIndexService: meta write failed', err)
    }
    this.meta = meta
    return meta
  }

  /** Deterministically rebuild the index from current sources. */
  rebuild(): MemoryIndexStatus {
    const chunks: MemoryChunk[] = chunkDocuments(this.collect())
    this.backendInstance.replaceAll(chunks)
    this.writeMeta(chunks.length)
    return this.status()
  }

  /** Rebuild when absent or stale; keep a ready index as-is. */
  private ensureIndex(): void {
    const state = this.metaState(this.readMeta())
    if (state !== 'ready') this.rebuild()
  }

  search(query: string, limit = 8): MemorySearchResult {
    const capability = this.capability()
    const trimmed = typeof query === 'string' ? query.trim() : ''
    if (!trimmed) return { hits: [], capability }
    try {
      this.ensureIndex()
      const ranked = searchMemoryIndex(this.backendInstance, trimmed, limit)
      const hits: MemorySearchHit[] = ranked.map(({ chunk, score, textScore }) => ({
        chunkId: chunk.chunkId,
        path: chunk.path,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        score,
        textScore,
        snippet: snippetOf(chunk.text),
        text: chunk.text,
        origin: chunk.provenance.originClass,
        provenance: chunk.provenance,
      }))
      return { hits, capability }
    } catch (err) {
      this.logger.warn('MemoryIndexService: search failed', err)
      return { hits: [], capability }
    }
  }

  get(chunkId: string): MemoryGetResult | null {
    try {
      this.ensureIndex()
      const chunk = this.backendInstance.get(chunkId)
      if (!chunk) return null
      return {
        chunkId: chunk.chunkId,
        path: chunk.path,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        text: chunk.text,
        origin: chunk.provenance.originClass,
        provenance: chunk.provenance,
        metadata: { sessionKind: chunk.provenance.sessionKind, observedAt: chunk.provenance.observedAt },
      }
    } catch (err) {
      this.logger.warn('MemoryIndexService: get failed', err)
      return null
    }
  }

  /**
   * Eligible source documents for the provenance-gated bootstrap block: a doc
   * is admitted only when its whole-provenance origin class is injectable.
   */
  bootstrapDocuments(): ChunkSourceDoc[] {
    return this.collect()
  }

  close(): void {
    this.backendInstance.close()
    this.backend = null
  }
}

function snippetOf(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > SNIPPET_CHARS ? `${flat.slice(0, SNIPPET_CHARS)}…` : flat
}

/** One index service per workspace root per process (shared by RPC + prompt paths). */
const serviceCache = new Map<string, MemoryIndexService>()

export function memoryIndexServiceFor(workspaceRoot: string, workspaceId?: string): MemoryIndexService {
  let svc = serviceCache.get(workspaceRoot)
  if (!svc) {
    svc = new MemoryIndexService({ workspaceRoot, ...(workspaceId ? { workspaceId } : {}) })
    serviceCache.set(workspaceRoot, svc)
  }
  return svc
}

/** Test seam: drop the shared index-service cache. */
export function resetMemoryIndexServiceCache(): void {
  for (const svc of serviceCache.values()) svc.close()
  serviceCache.clear()
}