import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MemoryIndexService, setGraphMemoryProviderResolver } from '../MemoryIndexService'
import type { ChunkSourceDoc } from '../chunk-index'
import type { GraphMemoryHit, GraphMemoryProvider, GraphMemoryState } from '@rox/shared/memory/graph-provider'

const roots: string[] = []
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'rox-graph-'))
  roots.push(d)
  return d
}
afterEach(() => {
  setGraphMemoryProviderResolver(null)
  for (const d of roots.splice(0)) rmSync(d, { recursive: true, force: true })
})

const docs: ChunkSourceDoc[] = [
  {
    path: 'memory/MEMORY.md',
    content: '# Notes\n\nThe deploy pipeline uses buildkite for releases.\n',
    provenance: { originClass: 'owner', sessionKind: 'interactive', observedAt: '2026-10-14T00:00:00.000Z' },
  } as ChunkSourceDoc,
]

function provider(hits: GraphMemoryHit[], opts: { delayMs?: number; state?: GraphMemoryState; throws?: boolean } = {}) {
  const calls = { search: 0, aborted: false }
  const p: GraphMemoryProvider = {
    id: 'fake',
    async ingest() {},
    async forget() {},
    status: () => ({ state: opts.state ?? 'ready', provider: 'fake' }),
    search(_q, o) {
      calls.search++
      o?.signal?.addEventListener('abort', () => { calls.aborted = true })
      if (opts.throws) return Promise.reject(new Error('boom'))
      return new Promise(r => setTimeout(() => r(hits), opts.delayMs ?? 0))
    },
  }
  return { p, calls }
}

const fact = (id: string, origin: 'owner' | 'untrusted' = 'owner'): GraphMemoryHit => ({
  id, source: 'notes', text: `buildkite release graph fact ${id}`, score: 1,
  provenance: { originClass: origin, sessionKind: 'interactive', observedAt: '2026-10-14T00:00:00.000Z' },
})

function svc(graphProvider: GraphMemoryProvider | null | undefined, graphBudgetMs?: number) {
  return new MemoryIndexService({
    workspaceRoot: tmp(),
    collectDocs: () => docs,
    ...(graphProvider !== undefined ? { graphProvider } : {}),
    ...(graphBudgetMs ? { graphBudgetMs } : {}),
  })
}

describe('graph-memory fusion in searchSemantic', () => {
  test('no provider: identical to native search', async () => {
    const s = svc(null)
    expect(await s.searchSemantic('buildkite')).toEqual(s.search('buildkite'))
  })
  test('trusted graph hits are fused, untrusted dropped', async () => {
    const { p } = provider([fact('a'), fact('evil', 'untrusted')])
    const res = await svc(p).searchSemantic('buildkite')
    const ids = res.hits.map(h => h.chunkId)
    expect(ids).toContain('graph:a')
    expect(ids).not.toContain('graph:evil')
    expect(ids.some(id => !id.startsWith('graph:'))).toBe(true)
  })
  test('slow provider is cut at the budget and aborted', async () => {
    const { p, calls } = provider([fact('late')], { delayMs: 500 })
    const t0 = Date.now()
    const res = await svc(p, 30).searchSemantic('buildkite')
    expect(Date.now() - t0).toBeLessThan(400)
    expect(res.hits.map(h => h.chunkId)).not.toContain('graph:late')
    expect(calls.aborted).toBe(true)
  })
  test('throwing or disabled provider falls back to FTS', async () => {
    const native = svc(null).search('buildkite').hits.map(h => h.path)
    const { p } = provider([], { throws: true })
    expect((await svc(p).searchSemantic('buildkite')).hits.map(h => h.path)).toEqual(native)
    const d = provider([fact('x')], { state: 'disabled' })
    expect((await svc(d.p).searchSemantic('buildkite')).hits.map(h => h.chunkId)).not.toContain('graph:x')
    expect(d.calls.search).toBe(0)
  })
  test('registered resolver is used when no DI provider', async () => {
    const { p, calls } = provider([fact('r')])
    setGraphMemoryProviderResolver(() => p)
    const res = await svc(undefined).searchSemantic('buildkite')
    expect(calls.search).toBe(1)
    expect(res.hits.map(h => h.chunkId)).toContain('graph:r')
  })
  test('empty query never calls the provider', async () => {
    const { p, calls } = provider([fact('q')])
    await svc(p).searchSemantic('   ')
    expect(calls.search).toBe(0)
  })
})
