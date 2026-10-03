import { describe, expect, it } from 'bun:test'

const module = await import('../knowledge-entity-projection').catch(() => null)

async function load(api: any, isCurrent = () => true) {
  expect(module?.loadKnowledgeEntityGraph).toBeFunction()
  return module!.loadKnowledgeEntityGraph({
    api, workspaceId: 'workspace-a', ref: { scheme: 'siyuan', kind: 'document', id: 'document-a' },
    isCurrent, noConnectionMessage: 'No connection',
  })
}

function apiFixture() {
  const calls: Array<[string, any]> = []
  const api = {
    listConnections: async () => [{ id: 'remote' }, { id: 'siyuan-local' }],
    get: async (args: any) => { calls.push(['get', args]); return { title: 'Found document', markdown: '# Section' } },
    getBacklinks: async (args: any) => { calls.push(['backlinks', args]); return [] },
    getContext: async (args: any) => { calls.push(['context', args]); return { children: [] } },
  }
  return { api, calls }
}

describe('UI-001 knowledge projection callbacks', () => {
  it('loads the selected entity through the local connection and derives real content', async () => {
    const { api, calls } = apiFixture()
    const result = await load(api)
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') throw new Error('Expected ready graph')
    expect(result.graph.nodes[result.graph.rootId].label).toBe('Found document')
    expect(Object.values(result.graph.nodes).some(node => node.label === 'Section')).toBe(true)
    expect(calls.map(([name]) => name)).toEqual(['get', 'backlinks', 'context'])
    expect(calls[0][1]).toMatchObject({ workspaceId: 'workspace-a', connectionId: 'siyuan-local', ref: { id: 'document-a' } })
  })

  it('returns missing for an absent entity without fabricating an ID graph or fetching optional data', async () => {
    const { api, calls } = apiFixture()
    api.get = async (args) => { calls.push(['get', args]); return null as any }
    expect(await load(api)).toEqual({ status: 'missing' })
    expect(calls.map(([name]) => name)).toEqual(['get'])
  })

  it('propagates lookup failures and recovers on a fresh retry', async () => {
    const { api } = apiFixture()
    const get = api.get
    api.get = async () => { throw new Error('temporary lookup failure') }
    await expect(load(api)).rejects.toThrow('temporary lookup failure')
    api.get = get
    expect((await load(api)).status).toBe('ready')
  })

  it('reports no connection rather than an empty graph', async () => {
    const { api, calls } = apiFixture()
    api.listConnections = async () => []
    await expect(load(api)).rejects.toThrow('No connection')
    expect(calls).toEqual([])
  })

  it('ignores optional data failures while preserving the selected entity markdown', async () => {
    const { api } = apiFixture()
    api.getBacklinks = async () => { throw new Error('backlinks unavailable') }
    api.getContext = async () => { throw new Error('context unavailable') }
    const result = await load(api)
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') throw new Error('Expected ready graph')
    expect(Object.values(result.graph.nodes).some(node => node.label === 'Section')).toBe(true)
  })

  for (const phase of ['connections', 'get', 'backlinks', 'context'] as const) {
    it(`cancels stale work after awaiting ${phase}`, async () => {
      const { api, calls } = apiFixture()
      let current = true
      if (phase === 'connections') api.listConnections = async () => { current = false; return [{ id: 'siyuan-local' }] }
      if (phase === 'get') api.get = async (args) => { calls.push(['get', args]); current = false; return { title: 'Stale', markdown: '# Old' } }
      if (phase === 'backlinks') api.getBacklinks = async (args) => { calls.push(['backlinks', args]); current = false; return [] }
      if (phase === 'context') api.getContext = async (args) => { calls.push(['context', args]); current = false; return { children: [] } }
      expect(await load(api, () => current)).toEqual({ status: 'cancelled' })
      expect(calls.map(([name]) => name)).toEqual(
        phase === 'connections' ? [] : phase === 'get' ? ['get'] : phase === 'backlinks' ? ['get', 'backlinks'] : ['get', 'backlinks', 'context'],
      )
    })
  }
})
