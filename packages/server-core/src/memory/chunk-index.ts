/**
 * chunk-index — the memory chunk index: one interface, two real backends
 * (spec c1.1).
 *
 * Backends:
 *  - `Fts5MemoryIndexBackend` — FTS5 retrieval, used whenever `bun:sqlite` is
 *    present and FTS5 is compiled in (Bun runtime).
 *  - `JsMemoryIndexBackend`  — a deterministic in-process lexical backend,
 *    used under Electron/Node where `bun:sqlite` is unavailable.
 *
 * Both backends answer the SAME `MemoryIndexBackend` interface and both feed
 * the SAME deterministic BM25 scorer (`rankMemoryChunks`). The FTS5 backend
 * uses the index only to select candidates; final ordering is computed by the
 * shared scorer so the same corpus ranks identically on either runtime — this
 * cross-runtime ordering stability is a first-class requirement, because a
 * memory prompt must not reshuffle between Bun (server) and Electron (main).
 *
 * Everything here is fail-soft in the same spirit as `fts-index.ts`: a broken
 * index degrades to "no candidates", never a thrown error on a recall path.
 */
import { createHash } from 'crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import type { Database } from 'bun:sqlite'
import type {
  MemoryChunkProvenance,
  MemoryIndexCapability,
  MemoryOriginClass,
  MemorySessionKind,
} from '@rox/shared/memory/types'

/** Bump when the chunking algorithm changes; a mismatch marks the index stale. */
export const MEMORY_CHUNKING_VERSION = 1
/** Embedding/scoring provider identity baked into the index identity. */
export const MEMORY_INDEX_PROVIDER = 'local'
/** Scoring model identity baked into the index identity. */
export const MEMORY_INDEX_MODEL = 'lexical-bm25'
/** FTS5 index file inside the memory directory. */
export const CHUNK_INDEX_FILE = 'chunk-index.db'
/** JSONL chunk store for the JS backend. */
export const CHUNK_STORE_FILE = 'chunk-index.jsonl'
/** Index identity/staleness sidecar. */
export const CHUNK_META_FILE = 'chunk-index.meta.json'
/** Soft cap on chunk size in characters (a single long line may exceed it). */
export const MAX_CHUNK_CHARS = 1200
/** BM25 term-frequency saturation / length-normalization constants. */
export const BM25_K1 = 1.2
export const BM25_B = 0.75

export interface MemoryChunk {
  chunkId: string
  /** Document path relative to the workspace root (or memory dir). */
  path: string
  /** 1-based inclusive line span within the document. */
  startLine: number
  endLine: number
  text: string
  provenance: MemoryChunkProvenance
}

/** A source document handed to the chunker. */
export interface ChunkSourceDoc {
  path: string
  content: string
  provenance: MemoryChunkProvenance
}

export interface MemoryIndexIdentity {
  chunkingVersion: number
  provider: string
  model: string
  /** `v<chunkingVersion>:<provider>/<model>` — the persisted identity string. */
  indexIdentity: string
}

export interface RankedChunk {
  chunk: MemoryChunk
  score: number
  textScore: number
}

/** The one interface both backends implement. */
export interface MemoryIndexBackend {
  readonly kind: 'fts5' | 'js'
  /** Replace the whole corpus (rebuild). Never throws. */
  replaceAll(chunks: MemoryChunk[]): void
  /** Candidate chunks containing at least one query token (unordered). */
  candidateChunks(query: string): MemoryChunk[]
  get(chunkId: string): MemoryChunk | null
  count(): number
  /** Every stored chunk, in stable (chunkId) order. */
  all(): MemoryChunk[]
  close(): void
}

interface RawChunkRow {
  chunk_id: string
  path: string
  start_line: number
  end_line: number
  origin_class: string
  session_kind: string
  observed_at: string
  supersedes_key: string | null
  text: string
}

/** Identity string for the current chunking version + provider/model. */
export function memoryIndexIdentity(): MemoryIndexIdentity {
  return {
    chunkingVersion: MEMORY_CHUNKING_VERSION,
    provider: MEMORY_INDEX_PROVIDER,
    model: MEMORY_INDEX_MODEL,
    indexIdentity: `v${MEMORY_CHUNKING_VERSION}:${MEMORY_INDEX_PROVIDER}/${MEMORY_INDEX_MODEL}`,
  }
}

/** Lowercased unicode word/number tokens (underscore kept, mirroring fts-index). */
export function tokenizeMemoryText(text: string): string[] {
  const out: string[] = []
  for (const raw of text.split(/[^\p{L}\p{N}_]+/u)) {
    const term = raw.trim().toLowerCase()
    if (term) out.push(term)
  }
  return out
}

/** Safe FTS5 MATCH expression: each token quoted (user text can never inject syntax), OR'd. */
export function buildMemoryMatchQuery(query: string): string {
  const seen = new Set<string>()
  const terms: string[] = []
  for (const term of tokenizeMemoryText(query)) {
    if (seen.has(term)) continue
    seen.add(term)
    terms.push(term)
    if (terms.length >= 24) break
  }
  return terms.map(t => `"${t.replaceAll('"', '')}"`).join(' OR ')
}

/** Deterministic chunk id: depends on path, chunking version, span and content. */
function chunkIdFor(path: string, startLine: number, endLine: number, text: string): string {
  return createHash('sha1')
    .update(`${path}\u0000${MEMORY_CHUNKING_VERSION}\u0000${startLine}\u0000${endLine}\u0000${text}`)
    .digest('hex')
    .slice(0, 20)
}

/**
 * Split a document into line-aligned chunks. Deterministic: the same document
 * and provenance always yield the same chunk ids in the same order.
 */
export function chunkDocument(doc: ChunkSourceDoc): MemoryChunk[] {
  const lines = doc.content.split('\n')
  const chunks: MemoryChunk[] = []
  let buffer: string[] = []
  let bufferChars = 0
  let startLine = 1
  const flush = (endLine: number): void => {
    if (buffer.length === 0) return
    const text = buffer.join('\n')
    if (text.trim()) {
      chunks.push({
        chunkId: chunkIdFor(doc.path, startLine, endLine, text),
        path: doc.path,
        startLine,
        endLine,
        text,
        provenance: doc.provenance,
      })
    }
    buffer = []
    bufferChars = 0
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    if (buffer.length > 0 && bufferChars + line.length + 1 > MAX_CHUNK_CHARS) {
      flush(i) // 1-based end line = previous line index i (0-based) → i
      startLine = i + 1
    } else if (buffer.length === 0) {
      startLine = i + 1
    }
    buffer.push(line)
    bufferChars += line.length + 1
  }
  flush(lines.length)
  return chunks
}

/** Chunk a set of documents, preserving input order. */
export function chunkDocuments(docs: ChunkSourceDoc[]): MemoryChunk[] {
  const chunks: MemoryChunk[] = []
  for (const doc of docs) chunks.push(...chunkDocument(doc))
  return chunks
}

/**
 * Deterministic BM25 over a candidate set, shared by both backends so ordering
 * is identical for the same corpus regardless of runtime. Documents with no
 * query-term overlap score 0 and are dropped. Ties break on chunkId ascending.
 */
export function rankMemoryChunks(candidates: MemoryChunk[], query: string): RankedChunk[] {
  const queryTokens = [...new Set(tokenizeMemoryText(query))]
  if (queryTokens.length === 0 || candidates.length === 0) return []
  const docTokens = candidates.map(c => tokenizeMemoryText(c.text))
  const docLengths = docTokens.map(t => t.length)
  const avgdl = docLengths.reduce((a, b) => a + b, 0) / candidates.length || 1
  const df = new Map<string, number>()
  for (const tokens of docTokens) {
    const present = new Set(tokens)
    for (const term of queryTokens) {
      if (present.has(term)) df.set(term, (df.get(term) ?? 0) + 1)
    }
  }
  const N = candidates.length
  const idf = new Map<string, number>()
  for (const term of queryTokens) {
    const n = df.get(term) ?? 0
    idf.set(term, Math.log(1 + (N - n + 0.5) / (n + 0.5)))
  }
  const ranked: RankedChunk[] = []
  for (let i = 0; i < candidates.length; i++) {
    const tokens = docTokens[i]!
    const dl = docLengths[i]!
    const tf = new Map<string, number>()
    for (const token of tokens) tf.set(token, (tf.get(token) ?? 0) + 1)
    let score = 0
    for (const term of queryTokens) {
      const f = tf.get(term)
      if (!f) continue
      score += (idf.get(term) ?? 0) * ((f * (BM25_K1 + 1)) / (f + BM25_K1 * (1 - BM25_B + (BM25_B * dl) / avgdl)))
    }
    if (score > 0) ranked.push({ chunk: candidates[i]!, score, textScore: score })
  }
  ranked.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.chunk.chunkId < b.chunk.chunkId ? -1 : 1))
  return ranked
}

// ---------------------------------------------------------------
// Capability probe
// ---------------------------------------------------------------

type DatabaseCtor = new (path: string) => Database
let cachedCtor: DatabaseCtor | null | undefined
let cachedCapability: MemoryIndexCapability | undefined

function getDatabaseCtor(): DatabaseCtor | null {
  if (cachedCtor === undefined) {
    try {
      cachedCtor = require('bun:sqlite').Database as DatabaseCtor
    } catch {
      cachedCtor = null
    }
  }
  return cachedCtor ?? null
}

/**
 * Probe the runtime once for FTS5 and vector capability. FTS5 requires
 * `bun:sqlite` plus a compiling FTS5 module; vector requires a loadable
 * `sqlite-vec` extension. Cached for the process lifetime.
 */
export function probeMemoryIndexCapability(): MemoryIndexCapability {
  if (cachedCapability) return cachedCapability
  let fts5 = false
  let vector = false
  const Ctor = getDatabaseCtor()
  if (Ctor) {
    let db: Database | null = null
    try {
      db = new Ctor(':memory:')
      db.exec('CREATE VIRTUAL TABLE __mem_probe USING fts5(x)')
      fts5 = true
      try {
        const resolved = require.resolve('sqlite-vec')
        db.loadExtension(resolved)
        vector = true
      } catch {
        vector = false
      }
    } catch {
      fts5 = false
    } finally {
      try {
        db?.close()
      } catch {
        // probe db is disposable
      }
    }
  }
  cachedCapability = { fts5, vector }
  return cachedCapability
}

/** Test seam: reset the cached capability/ctor probe. */
export function resetMemoryIndexCapabilityCache(): void {
  cachedCapability = undefined
}

function rowToChunk(row: RawChunkRow): MemoryChunk {
  const provenance: MemoryChunkProvenance = {
    originClass: row.origin_class as MemoryOriginClass,
    sessionKind: row.session_kind as MemorySessionKind,
    observedAt: row.observed_at,
  }
  if (row.supersedes_key) provenance.supersedesKey = row.supersedes_key
  return {
    chunkId: row.chunk_id,
    path: row.path,
    startLine: row.start_line,
    endLine: row.end_line,
    text: row.text,
    provenance,
  }
}

const CHUNK_SELECT =
  'SELECT chunk_id, path, start_line, end_line, origin_class, session_kind, observed_at, supersedes_key, text FROM chunks_fts'

// ---------------------------------------------------------------
// FTS5 backend
// ---------------------------------------------------------------

/** FTS5-backed index. Falls back internally to an empty corpus on any error. */
export class Fts5MemoryIndexBackend implements MemoryIndexBackend {
  readonly kind = 'fts5' as const
  private readonly db: Database | null

  constructor(dbPath: string) {
    let db: Database | null = null
    try {
      const Ctor = getDatabaseCtor()
      if (Ctor) {
        mkdirSync(dirname(dbPath), { recursive: true })
        db = new Ctor(dbPath)
        db.exec('PRAGMA journal_mode = WAL')
        db.exec(
          'CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(' +
            'chunk_id UNINDEXED, path UNINDEXED, start_line UNINDEXED, end_line UNINDEXED, ' +
            'origin_class UNINDEXED, session_kind UNINDEXED, observed_at UNINDEXED, supersedes_key UNINDEXED, text)',
        )
      }
    } catch {
      db = null
    }
    this.db = db
  }

  replaceAll(chunks: MemoryChunk[]): void {
    if (!this.db) return
    try {
      this.db.exec('DELETE FROM chunks_fts')
      const insert = this.db.prepare(
        'INSERT INTO chunks_fts(chunk_id, path, start_line, end_line, origin_class, session_kind, observed_at, supersedes_key, text) ' +
          'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      for (const c of chunks) {
        insert.run(
          c.chunkId,
          c.path,
          c.startLine,
          c.endLine,
          c.provenance.originClass,
          c.provenance.sessionKind,
          c.provenance.observedAt,
          c.provenance.supersedesKey ?? null,
          c.text,
        )
      }
    } catch {
      // best-effort: the JSONL-free read path degrades to no candidates
    }
  }

  candidateChunks(query: string): MemoryChunk[] {
    if (!this.db) return []
    const match = buildMemoryMatchQuery(query)
    if (!match) return []
    try {
      const rows = this.db
        .query<RawChunkRow, [string]>(`${CHUNK_SELECT} WHERE chunks_fts MATCH ?`)
        .all(match)
      return rows.map(rowToChunk)
    } catch {
      return []
    }
  }

  get(chunkId: string): MemoryChunk | null {
    if (!this.db) return null
    try {
      const row = this.db
        .query<RawChunkRow, [string]>(`${CHUNK_SELECT} WHERE chunk_id = ? LIMIT 1`)
        .get(chunkId)
      return row ? rowToChunk(row) : null
    } catch {
      return null
    }
  }

  count(): number {
    if (!this.db) return 0
    try {
      return this.db.query<{ n: number }, []>('SELECT count(*) AS n FROM chunks_fts').get()?.n ?? 0
    } catch {
      return 0
    }
  }

  all(): MemoryChunk[] {
    if (!this.db) return []
    try {
      return this.db
        .query<RawChunkRow, []>(`${CHUNK_SELECT} ORDER BY chunk_id`)
        .all()
        .map(rowToChunk)
    } catch {
      return []
    }
  }

  close(): void {
    try {
      this.db?.close()
    } catch {
      // already closed
    }
  }
}

// ---------------------------------------------------------------
// JS backend
// ---------------------------------------------------------------

/** In-process lexical backend backed by a JSONL chunk store. */
export class JsMemoryIndexBackend implements MemoryIndexBackend {
  readonly kind = 'js' as const
  private readonly storePath: string
  private chunks: MemoryChunk[]

  constructor(storePath: string) {
    this.storePath = storePath
    this.chunks = this.load()
  }

  private load(): MemoryChunk[] {
    try {
      if (!existsSync(this.storePath)) return []
      const out: MemoryChunk[] = []
      for (const line of readFileSync(this.storePath, 'utf8').split('\n')) {
        if (!line.trim()) continue
        const parsed = JSON.parse(line) as MemoryChunk
        if (parsed && typeof parsed.chunkId === 'string' && typeof parsed.text === 'string') out.push(parsed)
      }
      return out.sort((a, b) => (a.chunkId < b.chunkId ? -1 : a.chunkId > b.chunkId ? 1 : 0))
    } catch {
      return []
    }
  }

  replaceAll(chunks: MemoryChunk[]): void {
    const sorted = [...chunks].sort((a, b) => (a.chunkId < b.chunkId ? -1 : a.chunkId > b.chunkId ? 1 : 0))
    try {
      mkdirSync(dirname(this.storePath), { recursive: true })
      writeFileSync(this.storePath, sorted.map(c => JSON.stringify(c)).join('\n') + (sorted.length ? '\n' : ''))
      this.chunks = sorted
    } catch {
      // keep the previous in-memory corpus on a failed persist
    }
  }

  candidateChunks(query: string): MemoryChunk[] {
    const terms = new Set(tokenizeMemoryText(query))
    if (terms.size === 0) return []
    const out: MemoryChunk[] = []
    for (const chunk of this.chunks) {
      const tokens = new Set(tokenizeMemoryText(chunk.text))
      for (const term of terms) {
        if (tokens.has(term)) {
          out.push(chunk)
          break
        }
      }
    }
    return out
  }

  get(chunkId: string): MemoryChunk | null {
    return this.chunks.find(c => c.chunkId === chunkId) ?? null
  }

  count(): number {
    return this.chunks.length
  }

  all(): MemoryChunk[] {
    return [...this.chunks]
  }

  close(): void {
    // no handles to release
  }
}

/** Pick the FTS5 backend when the runtime supports it, else the JS backend. */
export function createMemoryIndexBackend(memoryDir: string): MemoryIndexBackend {
  return probeMemoryIndexCapability().fts5
    ? new Fts5MemoryIndexBackend(join(memoryDir, CHUNK_INDEX_FILE))
    : new JsMemoryIndexBackend(join(memoryDir, CHUNK_STORE_FILE))
}

/**
 * Ranked search through the shared scorer over a backend's candidate set.
 *
 * The two backends select candidates with DIFFERENT tokenizers: the JS backend
 * uses `tokenizeMemoryText` (underscore kept, diacritics preserved) while FTS5
 * applies its own unicode61 analyzer (`_` split, diacritics folded). FTS5
 * therefore admits chunks the JS scorer can never match, which would inflate
 * the candidate count and shift idf/avgdl. We re-filter every backend's
 * candidates down to chunks that are JS-token-visible for the query BEFORE
 * scoring, so both runtimes hash the same candidate set and produce identical
 * order and scores.
 */
export function searchMemoryIndex(backend: MemoryIndexBackend, query: string, limit: number): RankedChunk[] {
  const capped = Math.min(Math.max(Math.trunc(limit) || 0, 1), 200)
  const terms = new Set(tokenizeMemoryText(query))
  const candidates = backend.candidateChunks(query).filter(c => {
    if (terms.size === 0) return false
    for (const token of tokenizeMemoryText(c.text)) {
      if (terms.has(token)) return true
    }
    return false
  })
  return rankMemoryChunks(candidates, query).slice(0, capped)
}