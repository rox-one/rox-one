import { describe, expect, test } from 'bun:test'
import { createKnowledgeTabTitleLoader, type KnowledgeTabTitleAPI } from '../knowledge-tab-titles'
import type { SurfaceKnowledgeRef } from '../layout-snapshot'

const ref = (id: string): SurfaceKnowledgeRef => ({ scheme: 'siyuan', kind: 'document', id })
const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(yes => { resolve = yes })
  return { promise, resolve }
}

describe('Golden Gate knowledge tab title recovery', () => {
  test('failure, unavailable connection and empty title do not poison a later navigation', async () => {
    for (const failure of ['connection', 'read', 'empty']) {
      const loader = createKnowledgeTabTitleLoader()
      let online = false, reads = 0
      const api: KnowledgeTabTitleAPI = {
        listConnections: async () => { if (!online && failure === 'connection') throw Error('offline'); return [{ id: 'local' }] },
        get: async () => { reads++; if (!online && failure === 'read') throw Error('offline'); return { title: online ? 'Recovered' : '' } },
      }
      expect((await loader.load('a', [ref('one')], api)).size).toBe(0)
      online = true
      expect((await loader.load('a', [ref('one')], api)).get('a:document:one')).toBe('Recovered')
      expect(reads).toBe(failure === 'connection' ? 1 : 2)
    }
  })
  test('cancelled render and its replacement share pending reads and both receive the result', async () => {
    const loader = createKnowledgeTabTitleLoader(), pending = deferred<{ title: string }>()
    let connections = 0, reads = 0
    const api = { listConnections: async () => { connections++; return [{ id: 'local' }] }, get: async () => { reads++; return pending.promise } }
    const old = loader.load('a', [ref('one')], api)
    const replacement = loader.load('a', [ref('one'), ref('one')], api)
    pending.resolve({ title: '  Shared  ' })
    expect((await old).get('a:document:one')).toBe('Shared')
    expect((await replacement).get('a:document:one')).toBe('Shared')
    expect(reads).toBe(1); expect(connections).toBe(1)
  })
  test('a batch lists connections once, successful titles cache, and workspace keys stay separate', async () => {
    const loader = createKnowledgeTabTitleLoader()
    const reads: string[] = [], connections: number[] = []
    const api: KnowledgeTabTitleAPI = {
      listConnections: async () => { connections.push(1); return [{ id: 'local' }] },
      get: async ({ workspaceId, ref }) => { reads.push(workspaceId + ref.id); return { title: workspaceId + ref.id } },
    }
    await loader.load('a', [ref('one'), ref('two')], api)
    await loader.load('a', [ref('one'), ref('two')], api)
    expect(connections).toHaveLength(1); expect(reads).toEqual(['aone', 'atwo'])
    expect((await loader.load('b', [ref('one')], api)).get('b:document:one')).toBe('bone')
    expect((await loader.load('a', [ref('one')], api)).get('a:document:one')).toBe('aone')
  })
  test('successful cache is bounded to256 entries and evicted titles can be read again', async () => {
    const loader = createKnowledgeTabTitleLoader(); let reads = 0
    const api: KnowledgeTabTitleAPI = { listConnections: async () => [{ id: 'local' }], get: async ({ ref }) => { reads++; return { title: ref.id } } }
    await loader.load('a', Array.from({ length: 257 }, (_, i) => ref(String(i))), api)
    await loader.load('a', [ref('256')], api); expect(reads).toBe(257)
    await loader.load('a', [ref('0')], api); expect(reads).toBe(258)
  })
})
