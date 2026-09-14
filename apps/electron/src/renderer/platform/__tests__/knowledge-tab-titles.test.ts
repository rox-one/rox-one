import { describe, expect, it, mock } from 'bun:test'
import { createKnowledgeTabTitleLoader, type KnowledgeTabTitleAPI } from '../knowledge-tab-titles'
import { knowledgeRefKey } from '../surface-tab-model'
import type { SurfaceKnowledgeRef } from '../layout-snapshot'

const doc: SurfaceKnowledgeRef = { scheme: 'siyuan', kind: 'document', id: 'doc-one' }
const block: SurfaceKnowledgeRef = { scheme: 'siyuan', kind: 'block', id: 'block-two' }
const key = (workspace: string, ref: SurfaceKnowledgeRef) => `${workspace}:${knowledgeRefKey(ref)}`

describe('knowledge tab title requests', () => {
  it('shares an in-flight title when a replaced tab batch stops awaiting its result', async () => {
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

  it('retries after connections become available without recording a failed request as complete', async () => {
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

  it('does not poison a key after get/list failure and keeps other titles in a batch', async () => {
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

  it('isolates identical references between workspaces and resolves connections once per batch', async () => {
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
