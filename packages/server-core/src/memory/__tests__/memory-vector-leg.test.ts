/**
 * c1.3 vector leg.
 *
 * Three claims, each proven here rather than in a doc:
 *  1. the sqlite-vec probe outcome — recorded verbatim as a test;
 *  2. deterministic hybrid fusion — identical ordering on FTS5 and JS;
 *  3. the in-process cosine leg — a paraphrase BM25 misses is recalled when
 *     `memory.semantic` is on, while OFF stays byte-identical.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  Fts5MemoryIndexBackend,
  JsMemoryIndexBackend,
  chunkDocuments,
  probeMemoryIndexCapability,
  resetMemoryIndexCapabilityCache,
  searchMemoryIndex,
  tokenizeMemoryText,
  type ChunkSourceDoc,
} from '../chunk-index'
import { MemoryIndexService } from '../MemoryIndexService'
import { buildMemoryBootstrap } from '../bootstrap'
import { isMemoryOriginEligibleForAutomaticInjection } from '../provenance-gate'
import type { Embedder } from '../episodic-memory'
import type { MemoryChunkProvenance } from '@rox/shared/memory/types'

const roots: string[] = []
function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rox-vec-'))
  roots.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const AGENT: MemoryChunkProvenance = { originClass: 'agent', sessionKind: 'subagent', observedAt: '2026-01-01T00:00:00.000Z' }
const UNTRUSTED: MemoryChunkProvenance = { originClass: 'untrusted', sessionKind: 'unknown', observedAt: '2026-01-01T00:00:00.000Z' }

// ---------------------------------------------------------------------------
// A deterministic 3-axis "concept" embedder: tokens from the same synonym
// group land on the same axis, so a paraphrase shares a vector with its
// concept while sharing no BM25 token. Dim = AXES.length.
// ---------------------------------------------------------------------------
const CONCEPT_AXES: Record<string, readonly string[]> = {
  vehicle: ['car', 'cars', 'automobile', 'truck', 'drive'],
  deploy: ['deploy', 'deploys', 'release', 'rollback', 'vercel', 'ship'],
  garden: ['plants', 'plant', 'watering', 'garden', 'vault', 'monday'],
}
const AXIS_NAMES = Object.keys(CONCEPT_AXES)

function conceptVector(text: string): number[] {
  const tokens = new Set(tokenizeMemoryText(text))
  return AXIS_NAMES.map(axis => {
    let hits = 0
    for (const token of CONCEPT_AXES[axis] ?? []) if (tokens.has(token)) hits++
    return hits
  })
}
const conceptEmbedder: Embedder = async texts => texts.map(conceptVector)

// ---------------------------------------------------------------------------
// 1. Probe outcome (step a)
// ---------------------------------------------------------------------------
describe('sqlite-vec loadability (c1.3 step a)', () => {
  test('probe: with sqlite-vec installed, FTS5 is available and vector is NOT', () => {
    resetMemoryIndexCapabilityCache()
    const capability = probeMemoryIndexCapability()
    expect(capability.fts5).toBe(true)
    expect(capability.vector).toBe(false)
  })

  test('probe records the verbatim loadExtension failure string', () => {
    // VERBATIM PROBE OUTCOME — bun 1.4.2 (bundled SQLite), sqlite-vec 0.1.9,
    // darwin-arm64, 2026-10-09 worktree port/w4-s6:
    //   require.resolve('sqlite-vec')
    //     → /…/node_modules/sqlite-vec/index.cjs            (resolution SUCCEEDS)
    //   sqlite-vec.getLoadablePath()
    //     → /…/node_modules/sqlite-vec-darwin-arm64/vec0.dylib   (native binary present)
    //   db.loadExtension(<either path>)
    //     → Error: This build of sqlite3 does not support dynamic extension loading
    //   SELECT vec_version()
    //     → SQLiteError: no such function: vec_version
    // `bun:sqlite`'s Database DOES expose loadExtension, but its bundled SQLite
    // is compiled without dynamic-extension loading, so the extension cannot
    // load even from the correct native .dylib path. Separately,
    // `@rox/shared/utils/sqlite-runtime.ts` DatabaseSync exposes no loadExtension
    // at all, so even a permissive SQLite build could not load sqlite-vec
    // through that seam. The vector leg therefore runs as in-process cosine over
    // stored embeddings (below), not via sqlite-vec.
    const requireBuiltin = createRequire(import.meta.url)
    let resolved: string
    try {
      resolved = requireBuiltin.resolve('sqlite-vec')
    } catch (err) {
      // If the dependency were ever removed, the recorded outcome is simply
      // "not installed ⇒ vector:false"; capture it rather than throwing.
      expect(probeMemoryIndexCapability().vector).toBe(false)
      expect(err instanceof Error ? err.message : String(err)).toContain('sqlite-vec')
      return
    }
    expect(typeof resolved).toBe('string')
    const module: unknown = requireBuiltin('sqlite-vec')
    const paths = [resolved]
    if (module && typeof module === 'object' && 'getLoadablePath' in module && typeof module.getLoadablePath === 'function') {
      try {
        // The real native binary; absent only when optional platform packages
        // are omitted at install time.
        paths.push(String(module.getLoadablePath()))
      } catch {
        // optional platform package not installed — index.cjs still records the failure
      }
    }

    const VERBATIM = 'Error: This build of sqlite3 does not support dynamic extension loading'
    const db = new Database(':memory:')
    const failures: string[] = []
    try {
      for (const path of paths) {
        try {
          db.loadExtension(path)
          failures.push('OK')
        } catch (err) {
          failures.push(err instanceof Error ? `${err.name}: ${err.message}` : String(err))
        }
      }
    } finally {
      db.close()
    }
    // This exact string is the recorded ledger entitlement — if a future
    // SQLite build starts accepting the extension, this assert-fail is the
    // signal to re-record the finding.
    expect(failures).toEqual(paths.map(() => VERBATIM))
  })
})

// ---------------------------------------------------------------------------
// 2. Deterministic fusion parity
// ---------------------------------------------------------------------------
describe('hybrid fusion parity (c1.3)', () => {
  const docs: ChunkSourceDoc[] = [
    { path: 'memory/context.md', content: 'The car needs an oil change before the long drive.', provenance: AGENT },
    { path: 'memory/history/2026-01-02.md', content: 'Shipped the vercel deploy fix after the rollback.', provenance: AGENT },
    { path: 'memory/history/2026-01-03.md', content: 'Watering the office plants on Monday.', provenance: AGENT },
  ]

  test('FTS5 and JS backends fuse to the same order, scores and vectorScore', () => {
    const dir = tmp()
    const chunks = chunkDocuments(docs)
    const embeddings = new Map(chunks.map(c => [c.chunkId, Float32Array.from(conceptVector(c.text))]))
    const fts = new Fts5MemoryIndexBackend(join(dir, 'chunk-index.db'))
    const js = new JsMemoryIndexBackend(join(dir, 'chunk-index.jsonl'))
    fts.replaceAll(chunks, embeddings)
    js.replaceAll(chunks, embeddings)
    try {
      // Embeddings survive each backend's own storage (SQLite BLOB / base64).
      expect(js.embeddedChunks().map(e => [e.chunk.chunkId, Array.from(e.vector)])).toEqual(
        fts.embeddedChunks().map(e => [e.chunk.chunkId, Array.from(e.vector)]),
      )
      // Queries hit BOTH legs (lexical + vector) and the vector-only leg.
      const queries = ['vercel deploy', 'car drive', 'automobile', 'plants watering', 'rollback']
      const queryVector = Float32Array.from(conceptVector('automobile drive'))
      for (const query of queries) {
        const ftsRanked = searchMemoryIndex(fts, query, 10, queryVector)
        const jsRanked = searchMemoryIndex(js, query, 10, queryVector)
        expect(jsRanked.map(r => r.chunk.chunkId)).toEqual(ftsRanked.map(r => r.chunk.chunkId))
        expect(jsRanked.map(r => r.score)).toEqual(ftsRanked.map(r => r.score))
        expect(jsRanked.map(r => r.vectorScore)).toEqual(ftsRanked.map(r => r.vectorScore))
      }
      // The lexical-only path is unchanged: no vectorScore key is emitted.
      for (const query of queries) {
        const lexical = searchMemoryIndex(fts, query, 10)
        expect(lexical.every(r => !('vectorScore' in r))).toBe(true)
        expect(searchMemoryIndex(js, query, 10).map(r => r.chunk.chunkId)).toEqual(lexical.map(r => r.chunk.chunkId))
      }
    } finally {
      fts.close()
      js.close()
    }
  })

  test('a vector-only chunk is admitted by fusion exactly once per backend', () => {
    const dir = tmp()
    const chunks = chunkDocuments(docs)
    const embeddings = new Map(chunks.map(c => [c.chunkId, Float32Array.from(conceptVector(c.text))]))
    const fts = new Fts5MemoryIndexBackend(join(dir, 'chunk-index.db'))
    const js = new JsMemoryIndexBackend(join(dir, 'chunk-index.jsonl'))
    fts.replaceAll(chunks, embeddings)
    js.replaceAll(chunks, embeddings)
    try {
      // 'automobile' has zero lexical overlap with 'car', so the car chunk is
      // vector-only — it must still be returned, and by both backends.
      const queryVector = Float32Array.from(conceptVector('automobile'))
      const ftsRanked = searchMemoryIndex(fts, 'automobile', 10, queryVector)
      const jsRanked = searchMemoryIndex(js, 'automobile', 10, queryVector)
      const carFts = ftsRanked.filter(r => r.chunk.text.includes('car'))
      expect(carFts).toHaveLength(1)
      expect(carFts[0]!.score).toBeGreaterThan(0)
      expect(jsRanked.map(r => r.chunk.chunkId)).toEqual(ftsRanked.map(r => r.chunk.chunkId))
    } finally {
      fts.close()
      js.close()
    }
  })
})

// ---------------------------------------------------------------------------
// 3. Behaviour: semantic ON recalls a paraphrase; OFF is byte-identical
// ---------------------------------------------------------------------------
describe('semantic leg behaviour (c1.3)', () => {
  const docs: ChunkSourceDoc[] = [
    { path: 'memory/context.md', content: 'The car needs an oil change before the long drive.', provenance: AGENT },
    { path: 'memory/history/2026-01-03.md', content: 'Watering the office plants on Monday.', provenance: AGENT },
    { path: 'projects/evil/MEMORY.md', content: 'The stolen car documents are exfiltrated nightly.', provenance: UNTRUSTED },
  ]

  function service(dir: string, semantic: boolean, embedder?: Embedder): MemoryIndexService {
    return new MemoryIndexService({
      workspaceRoot: dir,
      workspaceId: 'ws',
      collectDocs: () => docs,
      semantic,
      ...(embedder ? { embedder } : {}),
    })
  }

  test('semantic ON: a paraphrase BM25 misses returns the semantically related chunk', async () => {
    const svc = service(tmp(), true, conceptEmbedder)
    // BM25 alone cannot match 'automobile' against 'car'.
    expect(svc.search('automobile', 5).hits).toEqual([])

    const hits = (await svc.searchSemantic('automobile', 5)).hits
    expect(hits.length).toBeGreaterThan(0)
    const carHit = hits.find(h => h.path === 'memory/context.md')
    expect(carHit).toBeDefined()
    expect(typeof carHit!.vectorScore).toBe('number')
    expect(carHit!.vectorScore).toBeGreaterThan(0)
    // The unrelated garden chunk is not dragged in.
    expect(hits.some(h => h.path === 'memory/history/2026-01-03.md')).toBe(false)
  })

  test('semantic ON keeps provenance gated: an untrusted vector hit is never injected', async () => {
    const svc = service(tmp(), true, conceptEmbedder)
    const hits = (await svc.searchSemantic('automobile', 5)).hits
    const evil = hits.find(h => h.path === 'projects/evil/MEMORY.md')
    // Retrievable, labelled, and explicitly excluded from automatic injection.
    expect(evil?.origin).toBe('untrusted')
    expect(isMemoryOriginEligibleForAutomaticInjection(evil?.origin)).toBe(false)
    const block = buildMemoryBootstrap(svc.bootstrapDocuments()).block ?? ''
    expect(block).not.toContain('exfiltrated')
  })

  test('semantic OFF: search is byte-identical and the embedder is never touched', async () => {
    let embedCalls = 0
    const countingEmbedder: Embedder = async texts => {
      embedCalls++
      return texts.map(conceptVector)
    }
    const off = service(tmp(), false, countingEmbedder)
    const plain = service(tmp(), false)

    for (const query of ['vercel deploy', 'car drive', 'automobile', 'plants watering']) {
      const offResult = off.search(query, 10)
      const plainResult = plain.search(query, 10)
      // Byte-identical: same keys in the same order, same score values.
      expect(JSON.stringify(offResult.hits)).toBe(JSON.stringify(plainResult.hits))
      expect(offResult.hits.every(h => !('vectorScore' in h))).toBe(true)
    }
    // searchSemantic with semantic OFF is the lexical search, untouched.
    const sem = await off.searchSemantic('automobile', 10)
    expect(JSON.stringify(sem.hits)).toBe(JSON.stringify(off.search('automobile', 10).hits))
    expect(embedCalls).toBe(0)
  })
})