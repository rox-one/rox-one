/**
 * createKnowledgeToolRuntime tests — the server-core implementation of the
 * KnowledgeToolRuntime seam that the knowledge_search / knowledge_read /
 * knowledge_get_backlinks session tools consume (K-10 §3.1).
 *
 * Covers: default-connection resolution (explicit id wins; otherwise the first
 * configured connection), the no-connection CONNECTION_UNAVAILABLE typing,
 * KnowledgeError pass-through vs raw-error PROVIDER_ERROR wrapping, and the
 * contextMode mapping for read (get only vs get + getContext).
 */
import { describe, it, expect } from 'bun:test'
import { KnowledgeError } from '@craft-agent/core/knowledge'
import type {
  ContextPayload,
  KnowledgeNode,
  KnowledgeProvider,
  SearchPage,
} from '@craft-agent/core/knowledge'
import { createKnowledgeToolRuntime } from '../tool-runtime'

const DOC_REF = { scheme: 'siyuan', kind: 'document', id: 'doc-1' } as const

const PAGE: SearchPage = {
  items: [
    {
      ref: { scheme: 'siyuan', kind: 'document', id: 'doc-1' },
      title: 'Kernel Guide',
      snippet: 'the kernel contract',
      notebookPath: '/Research',
      updatedAt: 1786000000000,
    },
  ],
  totalEstimate: 1,
}

const NODE: KnowledgeNode = {
  ref: { ...DOC_REF },
  title: 'Kernel Guide',
  markdown: '# Kernel Guide',
  path: '/Research/Kernel Guide',
  attributes: [],
  createdAt: 1786000000000,
  updatedAt: 1786000001000,
  contentHash: 'hash-1',
}

const CONTEXT: ContextPayload = {
  ref: { ...DOC_REF },
  mode: 'snapshot',
  blockId: 'doc-1',
  content: '# Kernel Guide',
  children: [],
  backlinks: [{ ref: { scheme: 'siyuan', kind: 'document', id: 'src-1' }, title: 'Source Doc' }],
  attributes: [],
  capturedAt: 1786000002000,
  contentHash: 'hash-1',
}

function providerDouble(overrides: Partial<KnowledgeProvider> = {}) {
  const calls: Array<{ method: string; args: unknown[] }> = []
  const provider: KnowledgeProvider = {
    async capabilities() {
      throw new KnowledgeError('UNSUPPORTED_OPERATION', 'not needed')
    },
    async search(input) {
      calls.push({ method: 'search', args: [input] })
      return PAGE
    },
    async get(ref) {
      calls.push({ method: 'get', args: [ref] })
      return NODE
    },
    async getContext(ref, mode) {
      calls.push({ method: 'getContext', args: [ref, mode] })
      return CONTEXT
    },
    async proposeMutation() {
      throw new KnowledgeError('UNSUPPORTED_OPERATION', 'not needed')
    },
    async applyMutation() {
      throw new KnowledgeError('UNSUPPORTED_OPERATION', 'not needed')
    },
    async open() {},
    ...overrides,
  }
  return { provider, calls }
}

function makeRuntime(opts: {
  provider?: KnowledgeProvider
  connectionIds?: string[]
  resolveProvider?: (connectionId: string) => Promise<KnowledgeProvider>
}) {
  const providerCalls: string[] = []
  const resolveProvider =
    opts.resolveProvider ??
    (async (connectionId: string) => {
      providerCalls.push(connectionId)
      return opts.provider ?? providerDouble().provider
    })
  const runtime = createKnowledgeToolRuntime({
    resolveProvider,
    listConnections: () => (opts.connectionIds ?? ['conn-1']).map((id) => ({ id })),
  })
  return { runtime, providerCalls }
}

describe('createKnowledgeToolRuntime', () => {
  it('search forwards the input and resolves the default (first) connection when omitted', async () => {
    const { runtime, providerCalls } = makeRuntime({})
    const page = await runtime.search({ input: { query: 'kernel' } })
    expect(page).toBe(PAGE)
    expect(providerCalls).toEqual(['conn-1'])
  })

  it('an explicit connectionId wins over the default', async () => {
    const { runtime, providerCalls } = makeRuntime({ connectionIds: ['conn-1', 'conn-2'] })
    await runtime.search({ connectionId: 'conn-2', input: { query: 'kernel' } })
    expect(providerCalls).toEqual(['conn-2'])
  })

  it('fails with a typed CONNECTION_UNAVAILABLE when no connection is configured', async () => {
    const { runtime } = makeRuntime({ connectionIds: [] })
    const error = await runtime.search({ input: { query: 'kernel' } }).catch((e) => e)
    expect(error).toBeInstanceOf(KnowledgeError)
    expect((error as KnowledgeError).code).toBe('CONNECTION_UNAVAILABLE')
  })

  it('read without contextMode returns the node only (no getContext call)', async () => {
    const { provider, calls } = providerDouble()
    const { runtime } = makeRuntime({ provider })
    const result = await runtime.read({ ref: { ...DOC_REF } })
    expect(result.node).toBe(NODE)
    expect(result.context).toBeUndefined()
    expect(calls.map((c) => c.method)).toEqual(['get'])
  })

  it('read with contextMode snapshot also fetches getContext with that mode', async () => {
    const { provider, calls } = providerDouble()
    const { runtime } = makeRuntime({ provider })
    const result = await runtime.read({ ref: { ...DOC_REF }, contextMode: 'snapshot' })
    expect(result.context).toBe(CONTEXT)
    expect(calls.map((c) => c.method)).toEqual(['get', 'getContext'])
    expect(calls[1]!.args[1]).toBe('snapshot')
  })

  it('getBacklinks returns the snapshot context backlinks slice', async () => {
    const { provider } = providerDouble()
    const { runtime } = makeRuntime({ provider })
    const backlinks = await runtime.getBacklinks({ ref: { ...DOC_REF } })
    expect(backlinks).toBe(CONTEXT.backlinks)
  })

  it('passes KnowledgeError from the provider through unchanged', async () => {
    const { provider } = providerDouble({
      async search() {
        throw new KnowledgeError('NOT_FOUND', 'gone')
      },
    })
    const { runtime } = makeRuntime({ provider })
    const error = await runtime.search({ input: { query: 'x' } }).catch((e) => e)
    expect(error).toBeInstanceOf(KnowledgeError)
    expect((error as KnowledgeError).code).toBe('NOT_FOUND')
  })

  it('defaultConnectionId returns the first configured connection, null when none', async () => {
    const { runtime } = makeRuntime({ connectionIds: ['conn-1', 'conn-2'] })
    expect(runtime.defaultConnectionId?.()).toBe('conn-1')
    const empty = makeRuntime({ connectionIds: [] })
    expect(empty.runtime.defaultConnectionId?.()).toBeNull()
  })

  it('wraps raw provider errors as PROVIDER_ERROR (never raw across the seam)', async () => {
    const { provider } = providerDouble({
      async get() {
        throw new Error('socket hangup')
      },
    })
    const { runtime } = makeRuntime({ provider })
    const error = await runtime.read({ ref: { ...DOC_REF } }).catch((e) => e)
    expect(error).toBeInstanceOf(KnowledgeError)
    expect((error as KnowledgeError).code).toBe('PROVIDER_ERROR')
    expect((error as KnowledgeError).message).toContain('socket hangup')
  })
})
