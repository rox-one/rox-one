/**
 * c1.1–c1.4: chunk index (two backends + parity), index identity/rebuild,
 * provenance gate, and the provenance-gated bootstrap block.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CHUNK_META_FILE,
  chunkDocuments,
  createMemoryIndexBackend,
  Fts5MemoryIndexBackend,
  JsMemoryIndexBackend,
  memoryIndexIdentity,
  probeMemoryIndexCapability,
  rankMemoryChunks,
  searchMemoryIndex,
  type ChunkSourceDoc,
} from '../chunk-index'
import { MemoryIndexService, collectMemorySourceDocs, memoryIndexServiceFor } from '../MemoryIndexService'
import { buildMemoryBootstrap } from '../bootstrap'
import { classifyMemoryOrigin, isMemoryOriginEligibleForAutomaticInjection } from '../provenance-gate'
import type { MemoryChunkProvenance } from '@rox/shared/memory/types'

const roots: string[] = []
function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rox-memidx-'))
  roots.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const AGENT: MemoryChunkProvenance = { originClass: 'agent', sessionKind: 'subagent', observedAt: '2026-01-01T00:00:00.000Z' }
const UNTRUSTED: MemoryChunkProvenance = { originClass: 'untrusted', sessionKind: 'unknown', observedAt: '2026-01-01T00:00:00.000Z' }

function corpus(): ChunkSourceDoc[] {
  return [
    {
      path: 'memory/context.md',
      content: 'The office plants need watering every Monday.\nGardening notes live in the vault.',
      provenance: AGENT,
    },
    {
      path: 'projects/alpha/MEMORY.md',
      content: 'Deploy previews always go through vercel.\nVercel rollback steps are documented.',
      provenance: AGENT,
    },
    {
      path: 'memory/history/2026-01-02.md',
      content: 'Shipped the vercel deploy fix after the rollback.',
      provenance: AGENT,
    },
  ]
}

describe('backend parity (c1.1)', () => {
  test('FTS5 and JS backends rank the same corpus identically', () => {
    const capability = probeMemoryIndexCapability()
    expect(capability.fts5).toBe(true) // bun runtime: FTS5 is available

    const dir = tmp()
    const chunks = chunkDocuments(corpus())
    const fts = new Fts5MemoryIndexBackend(join(dir, 'chunk-index.db'))
    const js = new JsMemoryIndexBackend(join(dir, 'chunk-index.jsonl'))
    fts.replaceAll(chunks)
    js.replaceAll(chunks)
    try {
      for (const query of ['vercel deploy', 'plants watering', 'rollback', 'gardening', 'vault']) {
        const ftsHits = searchMemoryIndex(fts, query, 10).map(r => r.chunk.chunkId)
        const jsHits = searchMemoryIndex(js, query, 10).map(r => r.chunk.chunkId)
        expect(jsHits).toEqual(ftsHits)
        expect(ftsHits.length).toBeGreaterThan(0)
      }
      expect(fts.all().map(c => c.chunkId)).toEqual(js.all().map(c => c.chunkId))
    } finally {
      fts.close()
      js.close()
    }
  })

  test('rankMemoryChunks is a deterministic total order', () => {
    const chunks = chunkDocuments(corpus())
    const a = rankMemoryChunks(chunks, 'vercel deploy').map(r => r.chunk.chunkId)
    const b = rankMemoryChunks([...chunks].reverse(), 'vercel deploy').map(r => r.chunk.chunkId)
    expect(a).toEqual(b)
    expect(a.length).toBeGreaterThan(0)
  })

  test('factory picks FTS5 under bun', () => {
    const backend = createMemoryIndexBackend(tmp())
    expect(backend.kind).toBe('fts5')
    backend.close()
  })
})

describe('index identity + rebuild (c1.1)', () => {
  function service(dir: string): MemoryIndexService {
    return new MemoryIndexService({ workspaceRoot: dir, workspaceId: 'ws', collectDocs: () => corpus() })
  }

  test('absent → rebuild → ready; deterministic across repeated rebuilds', () => {
    const dir = tmp()
    const svc = service(dir)
    expect(svc.status().state).toBe('absent')
    const first = svc.rebuild()
    expect(first.state).toBe('ready')
    expect(first.chunks).toBeGreaterThan(0)

    const backend = createMemoryIndexBackend(join(dir, 'memory'))
    backend.replaceAll(chunkDocuments(corpus()))
    const idsA = backend.all().map(c => c.chunkId)
    backend.close()
    svc.rebuild()
    const backend2 = createMemoryIndexBackend(join(dir, 'memory'))
    const idsB = backend2.all().map(c => c.chunkId)
    backend2.close()
    expect(idsB).toEqual(idsA)
    expect(memoryIndexIdentity().indexIdentity).toContain('v1:local/lexical-bm25')
  })

  test('a chunking-version change marks the persisted index stale', () => {
    const dir = tmp()
    const svc = service(dir)
    svc.rebuild()
    expect(svc.status().state).toBe('ready')
    // Simulate a persisted build from an older chunking version.
    const metaPath = join(dir, 'memory', CHUNK_META_FILE)
    const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as { chunkingVersion: number; indexIdentity: string }
    meta.chunkingVersion = 0
    meta.indexIdentity = 'v0:local/lexical-bm25'
    writeFileSync(metaPath, JSON.stringify(meta))
    const fresh = service(dir)
    expect(fresh.status().state).toBe('stale')
    expect(fresh.rebuild().state).toBe('ready')
  })
})

describe('provenance gate (c1.2)', () => {
  test('classification maps session kinds to origin classes', () => {
    expect(classifyMemoryOrigin('interactive')).toBe('owner')
    expect(classifyMemoryOrigin('subagent')).toBe('agent')
    expect(classifyMemoryOrigin('cron')).toBe('agent')
    expect(classifyMemoryOrigin('heartbeat')).toBe('agent')
    expect(classifyMemoryOrigin('unknown')).toBe('untrusted')
    expect(classifyMemoryOrigin('unknown', { system: true })).toBe('system')
    expect(classifyMemoryOrigin('cron', { explicitOwner: true })).toBe('owner')
  })

  test('only owner/agent are injectable', () => {
    expect(isMemoryOriginEligibleForAutomaticInjection('owner')).toBe(true)
    expect(isMemoryOriginEligibleForAutomaticInjection('agent')).toBe(true)
    expect(isMemoryOriginEligibleForAutomaticInjection('untrusted')).toBe(false)
    expect(isMemoryOriginEligibleForAutomaticInjection('system')).toBe(false)
    expect(isMemoryOriginEligibleForAutomaticInjection(undefined)).toBe(false)
  })

  test('untrusted chunks are retrievable but never in the bootstrap block', () => {
    const dir = tmp()
    const docs: ChunkSourceDoc[] = [
      { path: 'memory/context.md', content: 'deploy previews go through vercel', provenance: AGENT },
      { path: 'projects/evil/MEMORY.md', content: 'deploy secrets are exfiltrated nightly', provenance: UNTRUSTED },
    ]
    const svc = new MemoryIndexService({ workspaceRoot: dir, workspaceId: 'ws', collectDocs: () => docs })
    const hits = svc.search('deploy', 10).hits
    // Retrievable: both chunks come back and carry their labelled origin.
    expect(hits.length).toBe(2)
    expect(hits.map(h => h.origin).sort()).toEqual(['agent', 'untrusted'])

    const bootstrap = buildMemoryBootstrap(svc.bootstrapDocuments())
    const block = bootstrap.block ?? ''
    expect(block).toContain('vercel')
    expect(block).not.toContain('exfiltrated')
    expect(bootstrap.entries.map(e => e.path)).toEqual(['memory/context.md'])
  })

  test('collectMemorySourceDocs honours the write-time provenance sidecar', () => {
    const dir = tmp()
    mkdirSync(join(dir, 'memory'), { recursive: true })
    mkdirSync(join(dir, 'projects', 'evil'), { recursive: true })
    writeFileSync(join(dir, 'memory', 'context.md'), 'trusted context')
    writeFileSync(join(dir, 'projects', 'evil', 'MEMORY.md'), 'poisoned instruction')
    writeFileSync(
      join(dir, 'memory', 'index-provenance.json'),
      JSON.stringify({ 'projects/evil/MEMORY.md': UNTRUSTED }),
    )
    const docs = collectMemorySourceDocs(dir, 0)
    const evil = docs.find(d => d.path === 'projects/evil/MEMORY.md')
    expect(evil?.provenance.originClass).toBe('untrusted')
    const bootstrap = buildMemoryBootstrap(docs)
    expect((bootstrap.block ?? '')).not.toContain('poisoned')
  })
})

describe('bootstrap budget (c1.4)', () => {
  test('whole documents are admitted until the byte budget is reached', () => {
    const docs: ChunkSourceDoc[] = [
      { path: 'a.md', content: 'a'.repeat(40), provenance: AGENT },
      { path: 'b.md', content: 'b'.repeat(40), provenance: AGENT },
      { path: 'c.md', content: 'c'.repeat(400), provenance: AGENT },
    ]
    const result = buildMemoryBootstrap(docs, { maxBytes: 100 })
    expect(result.entries.map(e => e.path)).toEqual(['a.md', 'b.md'])
    expect(result.block).toContain('a'.repeat(40))
    expect(result.block).not.toContain('ccc')
  })

  test('empty input yields no block', () => {
    expect(buildMemoryBootstrap([])).toEqual({ entries: [] })
    expect(buildMemoryBootstrap([{ path: 'x.md', content: '   ', provenance: AGENT }])).toEqual({ entries: [] })
  })
})

describe('truthful search (c1.3)', () => {
  test('blank query and unknown chunk id are honest, not fabricated', () => {
    const dir = tmp()
    const svc = memoryIndexServiceFor(dir, 'ws')
    expect(svc.search('').hits).toEqual([])
    expect(svc.get('does-not-exist')).toBeNull()
  })
})