import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { GraphMemoryDocument, GraphMemoryProvider, GraphMemoryStatus } from '@rox/shared/memory/graph-provider'
import type { ChunkSourceDoc } from '../../chunk-index'
import {
  readGraphImportState,
  runGraphOneTimeImport,
  graphImportPending,
} from '../one-time-import'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) {
    try { rmSync(d, { recursive: true, force: true }) } catch { /* */ }
  }
})

function home(): string {
  const d = mkdtempSync(join(tmpdir(), 'rox-graph-import-'))
  dirs.push(d)
  return d
}

function prov(originClass: 'owner' | 'untrusted') {
  return { originClass, sessionKind: 'interactive' as const, observedAt: '2026-10-23T00:00:00Z' }
}

function doc(path: string, content: string, originClass: 'owner' | 'untrusted' = 'owner'): ChunkSourceDoc {
  return { path, content, provenance: prov(originClass) }
}

class FakeProvider implements GraphMemoryProvider {
  readonly id = 'fake'
  state: GraphMemoryStatus['state'] = 'ready'
  ingested: GraphMemoryDocument[] = []
  failAfter = -1
  cognifyCalls = 0
  async ingest(docs: readonly GraphMemoryDocument[]): Promise<void> {
    if (this.failAfter >= 0 && this.ingested.length >= this.failAfter) throw new Error('boom')
    this.ingested.push(...docs)
  }
  async search(): Promise<never[]> { return [] }
  async forget(): Promise<void> {}
  status(): GraphMemoryStatus { return { state: this.state, provider: this.id } }
  async cognify(): Promise<void> { this.cognifyCalls += 1 }
}

describe('runGraphOneTimeImport', () => {
  test('imports injectable docs in batches and marks done; never deletes', async () => {
    const storage = join(home(), 'ws')
    const p = new FakeProvider()
    const docs = [
      doc('memory/notes/a.md', 'alpha'),
      doc('memory/notes/b.md', 'beta'),
      doc('memory/mail/c.md', 'spam', 'untrusted'),
      doc('memory/notes/d.md', 'delta'),
    ]
    const r = await runGraphOneTimeImport({
      storageDir: storage,
      provider: p,
      docs,
      batchSize: 2,
      roxHome: home(),
    })
    expect(r.state.status).toBe('done')
    expect(r.state.cursor).toBe(3)
    expect(p.ingested).toHaveLength(3)
    expect(p.cognifyCalls).toBe(1)
    expect(graphImportPending(storage)).toBe(false)
    // Native docs untouched — we never write to doc paths
    expect(existsSync(join(storage, 'import-state.json'))).toBe(true)
  })

  test('resumes from cursor after failure without resetting progress', async () => {
    const storage = join(home(), 'ws')
    const p = new FakeProvider()
    p.failAfter = 2
    const docs = [
      doc('memory/notes/a.md', 'a'),
      doc('memory/notes/b.md', 'b'),
      doc('memory/notes/c.md', 'c'),
      doc('memory/notes/d.md', 'd'),
    ]
    const first = await runGraphOneTimeImport({
      storageDir: storage,
      provider: p,
      docs,
      batchSize: 2,
      runCognify: false,
      roxHome: home(),
    })
    expect(first.state.status).toBe('failed')
    expect(first.state.cursor).toBe(2)
    expect(p.ingested).toHaveLength(2)

    p.failAfter = -1
    const second = await runGraphOneTimeImport({
      storageDir: storage,
      provider: p,
      docs,
      batchSize: 2,
      runCognify: false,
      roxHome: home(),
    })
    expect(second.state.status).toBe('done')
    expect(second.state.cursor).toBe(4)
    expect(p.ingested).toHaveLength(4)
    // second run only added the remaining 2
    expect(second.ingested).toBe(2)
  })

  test('done is idempotent (no re-ingest)', async () => {
    const storage = join(home(), 'ws')
    const p = new FakeProvider()
    const docs = [doc('memory/notes/a.md', 'a')]
    await runGraphOneTimeImport({ storageDir: storage, provider: p, docs, runCognify: false, roxHome: home() })
    const again = await runGraphOneTimeImport({ storageDir: storage, provider: p, docs, runCognify: false, roxHome: home() })
    expect(again.ingested).toBe(0)
    expect(p.ingested).toHaveLength(1)
    expect(readGraphImportState(storage).status).toBe('done')
  })

  test('soft-fails when provider disabled without wiping state file progress later', async () => {
    const storage = join(home(), 'ws')
    const p = new FakeProvider()
    p.state = 'not_installed'
    const r = await runGraphOneTimeImport({
      storageDir: storage,
      provider: p,
      docs: [doc('memory/notes/a.md', 'a')],
      roxHome: home(),
    })
    expect(r.state.status).toBe('failed')
    expect(p.ingested).toEqual([])
  })
})
