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
import { basename, join } from 'path'
import { createHash } from 'crypto'
import { loadMemoryProvenanceOverrides } from '@rox/shared/memory/document-provenance'
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
import { loadXenovaEmbedder, type Embedder } from './episodic-memory'
import { resolveConfigDir } from '@rox/shared/config/paths'

/** Persisted index state sidecar. */
export interface MemoryIndexMeta {
  chunkingVersion: number
  indexIdentity: string
  backend: 'fts5' | 'js'
  /**
   * Fingerprint of the source corpus the index was built from (doc count +
   * per-doc content hashes). A mismatch against the current corpus marks the
   * index stale so `ensureIndex()` rebuilds it.
   */
  corpusFingerprint: string
  builtAt: string
  chunkCount: number
  /** c1.3: true when this build also persisted chunk embeddings (semantic leg). */
  embedded?: boolean
}

export interface MemoryIndexServiceDeps {
  workspaceRoot: string
  workspaceId?: string
  clock?: () => number
  logger?: { warn: (msg: string, err?: unknown) => void }
  /** Test seam: override source collection. */
  collectDocs?: (workspaceRoot: string) => ChunkSourceDoc[]
  /** c1.3: opt-in semantic (vector) leg, config `memory.semantic`. Off by default. */
  semantic?: boolean
  /** c1.3 DI seam: a ready-made embedder (tests / future providers). */
  embedder?: Embedder
  /** c1.3 DI seam: lazy embedder loader; defaults to @xenova/transformers. */
  loadEmbedder?: () => Promise<Embedder | null>
  /** c1.3: config dir holding the model cache; defaults to CRAFT_CONFIG_DIR || resolveConfigDir(). */
  configDir?: string
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
 * Workspace-relative path of a history document from its absolute path.
 *
 * Uses `basename` rather than a `/`-split: on Windows `join()` yields
 * backslashes, so `slice(lastIndexOf('/') + 1)` would return the whole absolute
 * path (breaking the `memory_search` prefix filter and provenance overrides).
 * The backslash normalization additionally makes the derivation deterministic
 * across platforms (and testable on POSIX).
 */
export function memoryHistoryRelPath(absPath: string): string {
  return `memory/history/${basename(absPath.replace(/\\/g, '/'))}`
}

/**
 * Collect the workspace's memory documents with provenance. Default classes:
 * distilled context/history and agent-written MEMORY.md are `agent`; explicit
 * user lessons are `owner`; everything else is `agent` unless overridden.
 */
export function collectMemorySourceDocs(workspaceRoot: string, now: number = Date.now()): ChunkSourceDoc[] {
  const memoryDir = join(workspaceRoot, 'memory')
  const overrides = loadMemoryProvenanceOverrides(workspaceRoot)
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
    const rel = memoryHistoryRelPath(abs)
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
  private readonly semanticEnabled: boolean
  private readonly configDir: string
  private backend: MemoryIndexBackend | null = null
  private meta: MemoryIndexMeta | null | undefined
  /** Resolved embedder promise (null = unavailable); cached for the instance. */
  private embedderReady: Promise<Embedder | null> | null = null

  constructor(deps: MemoryIndexServiceDeps) {
    this.deps = deps
    this.clock = deps.clock ?? (() => Date.now())
    this.logger = deps.logger ?? { warn: () => {} }
    this.semanticEnabled = deps.semantic === true
    this.configDir = deps.configDir ?? (process.env.CRAFT_CONFIG_DIR || resolveConfigDir())
  }

  private get memoryDir(): string {
    return join(this.deps.workspaceRoot, 'memory')
  }

  /** Workspace root this index is bound to (e.g. the wiki store derives its dir from it). */
  get workspaceRoot(): string {
    return this.deps.workspaceRoot
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

  /**
   * Stable fingerprint of the corpus the index was built from: doc count plus
   * a content hash per document. Cheap relative to a rebuild and independent
   * of file mtimes, so it works for injected test corpora too.
   */
  private corpusFingerprint(docs?: ChunkSourceDoc[]): string {
    const source = docs ?? this.collect()
    const combined = createHash('sha1')
    combined.update(String(source.length))
    for (const doc of source) {
      combined.update('\u0000')
      combined.update(doc.path)
      combined.update('\u0000')
      combined.update(createHash('sha1').update(doc.content).digest('hex'))
    }
    return combined.digest('hex')
  }

  /** Current staleness of the persisted index (no rebuild). */
  private metaState(meta: MemoryIndexMeta | null): 'absent' | 'ready' | 'stale' {
    if (!meta) return 'absent'
    const identity = memoryIndexIdentity()
    if (meta.chunkingVersion !== identity.chunkingVersion || meta.indexIdentity !== identity.indexIdentity) return 'stale'
    // Backend identity is part of the index identity: an index built under
    // Bun/FTS5 must not be treated as ready under Node/JS where the FTS5
    // backend is unavailable and would silently return zero hits.
    const activeBackend = this.capability().fts5 ? 'fts5' : 'js'
    if (meta.backend !== activeBackend) return 'stale'
    // A changed source corpus (new/edited/removed docs) invalidates the build.
    if (meta.corpusFingerprint !== this.corpusFingerprint()) return 'stale'
    return 'ready'
  }

  status(): MemoryIndexStatus {
    const capability = this.capability()
    const identity = memoryIndexIdentity()
    const meta = this.readMeta()
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

  private writeMeta(chunks: number, corpusFingerprint: string, embedded = false): MemoryIndexMeta {
    const identity = memoryIndexIdentity()
    const meta: MemoryIndexMeta = {
      chunkingVersion: identity.chunkingVersion,
      indexIdentity: identity.indexIdentity,
      backend: this.backendInstance.kind,
      corpusFingerprint,
      builtAt: new Date(this.clock()).toISOString(),
      chunkCount: chunks,
      embedded,
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

  /** Deterministically rebuild the index from current sources (lexical only). */
  rebuild(): MemoryIndexStatus {
    const docs = this.collect()
    const chunks: MemoryChunk[] = chunkDocuments(docs)
    this.backendInstance.replaceAll(chunks)
    this.writeMeta(chunks.length, this.corpusFingerprint(docs))
    return this.status()
  }

  private getEmbedder(): Promise<Embedder | null> {
    if (this.deps.embedder) return Promise.resolve(this.deps.embedder)
    if (!this.embedderReady) {
      const loader = this.deps.loadEmbedder ?? (() => loadXenovaEmbedder(this.configDir))
      this.embedderReady = loader().catch(() => null)
    }
    return this.embedderReady
  }

  /** True when the persisted build is lexically ready AND carries embeddings. */
  private embeddedReady(): boolean {
    const meta = this.readMeta()
    return this.metaState(meta) === 'ready' && meta?.embedded === true
  }

  /**
   * c1.3 rebuild backfill: chunk the current sources, embed every chunk text in
   * one batch through the Embedder seam, then persist chunks + vectors. A
   * chunk whose embedding is missing is simply not stored (lexical-only for it).
   */
  private async rebuildWithEmbeddings(embedder: Embedder): Promise<boolean> {
    const docs = this.collect()
    const chunks: MemoryChunk[] = chunkDocuments(docs)
    const vectors = chunks.length > 0 ? await embedder(chunks.map(c => c.text)) : []
    const embeddings = new Map<string, Float32Array>()
    chunks.forEach((chunk, i) => {
      const vector = vectors[i]
      if (Array.isArray(vector) && vector.length > 0) embeddings.set(chunk.chunkId, Float32Array.from(vector))
    })
    this.backendInstance.replaceAll(chunks, embeddings)
    const usable = embeddings.size > 0 || chunks.length === 0
    this.writeMeta(chunks.length, this.corpusFingerprint(docs), usable)
    return usable
  }

  /** Rebuild when absent or stale; keep a ready index as-is. */
  private ensureIndex(): void {
    const state = this.metaState(this.readMeta())
    if (state !== 'ready') this.rebuild()
  }

  /**
   * Lexical (and, when a `queryVector` is supplied, hybrid) search. With no
   * vector this is byte-identical to the pre-c1.3 lexical result: no
   * `vectorScore` key is emitted and scores match today's BM25 output.
   */
  search(query: string, limit = 8, queryVector?: readonly number[] | Float32Array | null): MemorySearchResult {
    const capability = this.capability()
    const trimmed = typeof query === 'string' ? query.trim() : ''
    if (!trimmed) return { hits: [], capability }
    try {
      this.ensureIndex()
      const ranked = searchMemoryIndex(this.backendInstance, trimmed, limit, queryVector)
      const hits: MemorySearchHit[] = ranked.map(({ chunk, score, textScore, vectorScore }) => {
        const hit: MemorySearchHit = {
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
        }
        if (typeof vectorScore === 'number') hit.vectorScore = vectorScore
        return hit
      })
      return { hits, capability }
    } catch (err) {
      this.logger.warn('MemoryIndexService: search failed', err)
      return { hits: [], capability }
    }
  }

  /**
   * c1.3 semantic search: the lexical search plus the vector leg, gated by
   * `memory.semantic`. Returns the lexical result unchanged when semantic is
   * off or the embedder is unavailable — the vector leg is never allowed to
   * turn a working lexical recall into an error.
   */
  async searchSemantic(query: string, limit = 8): Promise<MemorySearchResult> {
    if (!this.semanticEnabled) return this.search(query, limit)
    const trimmed = typeof query === 'string' ? query.trim() : ''
    if (!trimmed) return this.search(query, limit)
    try {
      const embedder = await this.getEmbedder()
      if (!embedder) return this.search(trimmed, limit)
      if (!this.embeddedReady() && !(await this.rebuildWithEmbeddings(embedder))) return this.search(trimmed, limit)
      const [queryVector] = await embedder([trimmed])
      if (!queryVector || queryVector.length === 0) return this.search(trimmed, limit)
      return this.search(trimmed, limit, queryVector)
    } catch (err) {
      this.logger.warn('MemoryIndexService: semantic search failed', err)
      return this.search(trimmed, limit)
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

export interface MemoryIndexServiceOptions {
  /** c1.3: config `memory.semantic`; different values get distinct cached services. */
  semantic?: boolean
  /** c1.3: config dir for the embedding-model cache. */
  configDir?: string
}

/**
 * The single mapping from the resolved memory config to index-factory options.
 * MemoryService and the RPC handlers both go through this, so a semantic-on
 * workspace cannot end up with a second, lexical instance: the two would read
 * and write a different index, clobber each other's `embedded` meta and never
 * agree on rebuilds. Reading `semantic` anywhere else in the process re-creates
 * that split (issue: shared-instance drift).
 */
export function memoryIndexServiceOptions(config: { semantic?: boolean }): MemoryIndexServiceOptions {
  return { semantic: config.semantic === true }
}

export function memoryIndexServiceFor(
  workspaceRoot: string,
  workspaceId?: string,
  options?: MemoryIndexServiceOptions,
): MemoryIndexService {
  const key = `${workspaceRoot}\u0000${options?.semantic ? 'semantic' : 'lexical'}`
  let svc = serviceCache.get(key)
  if (!svc) {
    svc = new MemoryIndexService({
      workspaceRoot,
      ...(workspaceId ? { workspaceId } : {}),
      ...(options?.semantic ? { semantic: true } : {}),
      ...(options?.configDir ? { configDir: options.configDir } : {}),
    })
    serviceCache.set(key, svc)
  }
  return svc
}

/** Test seam: drop the shared index-service cache. */
export function resetMemoryIndexServiceCache(): void {
  for (const svc of serviceCache.values()) svc.close()
  serviceCache.clear()
}