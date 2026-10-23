import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { GraphMemoryDocument, GraphMemoryProvider, GraphMemoryStatus } from '@rox/shared/memory/graph-provider'
import type { ChunkSourceDoc } from '../../chunk-index'
import { docIdForPath, graphSourceForPath, scheduleGraphIngest, toInjectableGraphDocs } from '../ingest'
import { readGraphCostLedger, recordGraphSpend } from '../cost-cap'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
})

function home(): string {
  const d = mkdtempSync(join(tmpdir(), 'rox-graph-ingest-'))
  dirs.push(d)
  return d
}

function prov(originClass: 'owner' | 'agent' | 'untrusted' | 'system') {
  return { originClass, sessionKind: 'interactive' as const, observedAt: '2026-10-23T00:00:00Z' }
}

function doc(path: string, content: string, originClass: 'owner' | 'agent' | 'untrusted' | 'system'): ChunkSourceDoc {
  return { path, content, provenance: prov(originClass) }
}

class FakeProvider implements GraphMemoryProvider {
  readonly id = 'fake'
  state: GraphMemoryStatus['state'] = 'ready'
  ingested: GraphMemoryDocument[] = []
  cognifyCalls = 0
  ingestThrows = false
  cognifyThrows = false
  async ingest(docs: readonly GraphMemoryDocument[]): Promise<void> {
    if (this.ingestThrows) throw new Error('ingest boom')
    this.ingested.push(...docs)
  }
  async search(): Promise<never[]> {
    return []
  }
  async forget(): Promise<void> {}
  status(): GraphMemoryStatus {
    return { state: this.state, provider: this.id }
  }
  async cognify(): Promise<void> {
    if (this.cognifyThrows) throw new Error('cognify boom')
    this.cognifyCalls += 1
  }
}

function flush(): Promise<void> {
  return new Promise(r => setTimeout(r, 30))
}

describe('toInjectableGraphDocs', () => {
  test('maps owner/agent and drops untrusted/system/empty', () => {
    const out = toInjectableGraphDocs([
      doc('memory/lessons/a.md', 'keep owner', 'owner'),
      doc('memory/history/s1.md', 'keep agent', 'agent'),
      doc('memory/mail/x.md', 'drop', 'untrusted'),
      doc('memory/notes/y.md', 'drop system', 'system'),
      doc('memory/notes/z.md', '   ', 'owner'),
    ])
    expect(out.map(d => d.ref)).toEqual(['memory/lessons/a.md', 'memory/history/s1.md'])
    expect(out[0]!.source).toBe('lessons')
    expect(out[1]!.source).toBe('session')
    expect(out[0]!.id).toBe(docIdForPath('memory/lessons/a.md'))
  })

  test('graphSourceForPath covers primary kinds', () => {
    expect(graphSourceForPath('memory/lessons/x.md')).toBe('lessons')
    expect(graphSourceForPath('memory/history/abc.md')).toBe('session')
    expect(graphSourceForPath('projects/foo/note.md')).toBe('notes')
    expect(graphSourceForPath('memory/tasks/1.md')).toBe('tasks')
    expect(graphSourceForPath('memory/mail/1.md')).toBe('mail')
    expect(graphSourceForPath('memory/chats/1.md')).toBe('chats')
    expect(graphSourceForPath('memory/calls/1.md')).toBe('calls')
    expect(graphSourceForPath('memory/files/1.md')).toBe('files')
  })
})

describe('scheduleGraphIngest', () => {
  test('no-ops without provider or injectable docs', async () => {
    scheduleGraphIngest({ provider: null, docs: [doc('a.md', 'x', 'owner')] })
    const p = new FakeProvider()
    scheduleGraphIngest({ provider: p, docs: [doc('a.md', 'x', 'untrusted')] })
    await flush()
    expect(p.ingested).toEqual([])
    expect(p.cognifyCalls).toBe(0)
  })

  test('soft-fails when sidecar is cold/not_installed/failed/disabled (no throw)', async () => {
    for (const state of ['disabled', 'not_installed', 'failed'] as const) {
      const p = new FakeProvider()
      p.state = state
      scheduleGraphIngest({ provider: p, docs: [doc('a.md', 'owner text', 'owner')] })
      await flush()
      expect(p.ingested).toEqual([])
    }
    // cold: still schedules (warm happens inside provider); fake stays cold but ingest is invoked
    const cold = new FakeProvider()
    cold.state = 'cold'
    scheduleGraphIngest({ provider: cold, docs: [doc('a.md', 'owner text', 'owner')] })
    await flush()
    expect(cold.ingested).toHaveLength(1)
  })

  test('drops untrusted before provider.ingest and runs cognify under cap', async () => {
    const h = home()
    const p = new FakeProvider()
    const warns: string[] = []
    scheduleGraphIngest({
      provider: p,
      docs: [doc('a.md', 'trusted', 'owner'), doc('b.md', 'bad', 'untrusted')],
      dailyCostCapUsd: 2,
      cognifyEstimateUsd: 0.02,
      roxHome: h,
      logger: { warn: m => warns.push(m) },
    })
    await flush()
    expect(p.ingested.map(d => d.ref)).toEqual(['a.md'])
    expect(p.cognifyCalls).toBe(1)
    expect(readGraphCostLedger(h, Date.now()).cognifyCount).toBe(1)
    expect(warns).toEqual([])
  })

  test('skips cognify when daily cost cap is reached', async () => {
    const h = home()
    const now = Date.now()
    recordGraphSpend(2, h, now)
    const p = new FakeProvider()
    const warns: string[] = []
    scheduleGraphIngest({
      provider: p,
      docs: [doc('a.md', 'trusted', 'owner')],
      dailyCostCapUsd: 2,
      cognifyEstimateUsd: 0.02,
      roxHome: h,
      logger: { warn: m => warns.push(m) },
    })
    await flush()
    expect(p.ingested).toHaveLength(1)
    expect(p.cognifyCalls).toBe(0)
    expect(warns.some(w => w.includes('cost cap'))).toBe(true)
  })

  test('ingest/cognify errors soft-fail (no throw to caller)', async () => {
    const h = home()
    const p = new FakeProvider()
    p.ingestThrows = true
    const warns: string[] = []
    expect(() =>
      scheduleGraphIngest({
        provider: p,
        docs: [doc('a.md', 'trusted', 'owner')],
        roxHome: h,
        logger: { warn: m => warns.push(m) },
      }),
    ).not.toThrow()
    await flush()
    expect(p.cognifyCalls).toBe(0)
    expect(warns.some(w => w.includes('ingest failed'))).toBe(true)

    const p2 = new FakeProvider()
    p2.cognifyThrows = true
    const warns2: string[] = []
    scheduleGraphIngest({
      provider: p2,
      docs: [doc('a.md', 'trusted', 'owner')],
      roxHome: h,
      dailyCostCapUsd: 2,
      logger: { warn: m => warns2.push(m) },
    })
    await flush()
    expect(warns2.some(w => w.includes('cognify failed'))).toBe(true)
  })
})

describe('MemoryIndexService rebuild enqueue', () => {
  test('rebuild schedules injectable ingest; graphIngest:false skips', async () => {
    const { MemoryIndexService } = await import('../../MemoryIndexService')
    const h = home()
    const p = new FakeProvider()
    const svc = new MemoryIndexService({
      workspaceRoot: h,
      workspaceId: 'ws',
      graphProvider: p,
      collectDocs: () => [
        doc('memory/notes/a.md', 'trusted note about deploy', 'owner'),
        doc('memory/mail/b.md', 'spam', 'untrusted'),
      ],
      graphDailyCostCapUsd: 2,
    })
    svc.rebuild()
    await flush()
    expect(p.ingested.map(d => d.ref)).toEqual(['memory/notes/a.md'])
    expect(p.cognifyCalls).toBe(1)
    svc.close()

    const p2 = new FakeProvider()
    const svc2 = new MemoryIndexService({
      workspaceRoot: h,
      workspaceId: 'ws2',
      graphProvider: p2,
      graphIngest: false,
      collectDocs: () => [doc('memory/notes/a.md', 'trusted', 'owner')],
    })
    svc2.rebuild()
    await flush()
    expect(p2.ingested).toEqual([])
    svc2.close()
  })
})
