import { describe, expect, mock, test } from 'bun:test'
import { createKnowledgeTabTitleLoader, type KnowledgeTabTitleAPI } from '../knowledge-tab-titles'
import type { SurfaceKnowledgeRef } from '../layout-snapshot'
import { knowledgeRefKey } from '../surface-tab-model'

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

describe('knowledge tab title requests', () => {
  const doc: SurfaceKnowledgeRef = { scheme: 'siyuan', kind: 'document', id: 'doc-one' }
  const block: SurfaceKnowledgeRef = { scheme: 'siyuan', kind: 'block', id: 'block-two' }
  const key = (workspace: string, ref: SurfaceKnowledgeRef) => `${workspace}:${knowledgeRefKey(ref)}`

  test('shares an in-flight title when a replaced tab batch stops awaiting its result', async () => {
    let finish!: (value: { title: string }) => void
    const response = new Promise<{ title: string }>(resolve => { finish = resolve })
    const api: KnowledgeTabTitleAPI = {
      listConnections: mock(async () => [{ id: 'local' }]),
      get: mock(async ({ ref }) => ref.id === doc.id ? response : { title: 'Second' }),
    }
    const loader = createKnowledgeTabTitleLoader()
    const staleBatch = loader.load('workspace', [doc], api)
    // Opening another tab invalidates the component effect. Its replacement
    // must still receive the pending document title, with no second RPC.
    const currentBatch = loader.load('workspace', [doc, block, doc], api)
    finish({ title: '  First  ' })
    const current = await currentBatch
    await staleBatch
    expect(current.get(key('workspace', doc))).toBe('First')
    expect(current.get(key('workspace', block))).toBe('Second')
    expect(api.get).toHaveBeenCalledTimes(2)
    expect(current.size).toBe(2)
    await loader.load('workspace', [doc, block], api)
    expect(api.get).toHaveBeenCalledTimes(2)
  })

  test('retries after connections become available without recording a failed request as complete', async () => {
    let online = false
    const api: KnowledgeTabTitleAPI = {
      listConnections: mock(async () => online ? [{ id: 'local' }] : []),
      get: mock(async () => ({ title: 'Reconnected' })),
    }
    const loader = createKnowledgeTabTitleLoader()
    expect((await loader.load('workspace', [doc], api)).size).toBe(0)
    expect(api.get).not.toHaveBeenCalled()
    online = true
    expect((await loader.load('workspace', [doc], api)).get(key('workspace', doc))).toBe('Reconnected')
    expect(api.get).toHaveBeenCalledTimes(1)
  })

  test('does not poison a key after get/list failure and keeps other titles in a batch', async () => {
    let failing = true
    const api: KnowledgeTabTitleAPI = {
      listConnections: mock(async () => [{ id: 'local' }]),
      get: mock(async ({ ref }) => {
        if (ref.id === doc.id && failing) throw new Error('Temporarily unavailable')
        return { title: ref.id }
      }),
    }
    const loader = createKnowledgeTabTitleLoader()
    const partial = await loader.load('workspace', [doc, block], api)
    expect(partial.has(key('workspace', doc))).toBe(false)
    expect(partial.has(key('workspace', block))).toBe(true)
    failing = false
    expect((await loader.load('workspace', [doc, block], api)).size).toBe(2)
    expect(api.get).toHaveBeenCalledTimes(3)

    const unavailable = { ...api, listConnections: async () => { throw new Error('Disconnected') } }
    expect((await loader.load('other', [doc], unavailable)).size).toBe(0)
    expect((await loader.load('other', [doc], api)).size).toBe(1)
  })

  test('isolates identical references between workspaces and resolves connections once per batch', async () => {
    const api: KnowledgeTabTitleAPI = {
      listConnections: mock(async () => [{ id: 'local' }]),
      get: mock(async ({ workspaceId }) => ({ title: workspaceId })),
    }
    const loader = createKnowledgeTabTitleLoader()
    const first = await loader.load('one', [doc, block], api)
    expect(api.listConnections).toHaveBeenCalledTimes(1)
    const second = await loader.load('two', [doc], api)
    expect(first.get(key('one', doc))).toBe('one')
    expect(second.get(key('two', doc))).toBe('two')
    expect(second.has(key('one', doc))).toBe(false)
    expect(api.get).toHaveBeenCalledTimes(3)
  })
})
