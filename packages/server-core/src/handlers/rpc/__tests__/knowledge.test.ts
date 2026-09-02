/**
 * P1 knowledge RPC handler tests (spec 2026-08-07-siyuan-integration/03 §§3.2–3.6):
 * HANDLED_CHANNELS is exactly the 9-channel P1 read set (no mutation / engine-lifecycle
 * channels; CHANGED is a push event, not a handled channel); every declared channel gets
 * a registered handler; connection records map to contract connections with credentialRef
 * stripped; provider resolution reads the token from CredentialManager at
 * source_bearer::{workspaceId}::{connectionId}; ENGINE_STATUS is probe semantics
 * (unreachable kernel → running:false, never a thrown provider error).
 *
 * Harness mirrors memory-io.test.ts: CRAFT_CONFIG_DIR is redirected by memory-test-setup
 * (the real KnowledgeConnectionsStore reads/writes there), the workspace registry and
 * CredentialManager are mock.module seams, and the SiYuan provider/kernel client are
 * stubbed at the module seam so no network ever happens.
 */
import '../memory-test-setup' // must run before any module reading CRAFT_CONFIG_DIR
import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { CodedError, RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { CredentialId } from '@craft-agent/shared/credentials'
import { getDefaultWorkspacesDir } from '@craft-agent/shared/workspaces'
import type { HandlerFn, RequestContext, RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../../handler-deps'
import type {
  ContextMode,
  ContextPayload,
  KnowledgeCapabilities,
  KnowledgeConnection,
  KnowledgeNode,
  KnowledgeRef,
  SearchInput,
  SearchPage,
} from '@craft-agent/core/knowledge'
import {
  KnowledgeConnectionsStore,
  KnowledgeContextSnapshotsStore,
  KnowledgeMutationProposalsStore,
  LOCAL_MARKDOWN_BASE_URL,
  LOCAL_MARKDOWN_CONNECTION_ID,
  LOCAL_MARKDOWN_LABEL,
  LOCAL_MARKDOWN_NOTEBOOK_ID,
  localMarkdownConnectionId,
} from '../../../knowledge'
import type { KnowledgeProposalFileRecord } from '../../../knowledge/bridge-service'
import type { SaveConnectionInput } from '../../../knowledge'

// ---------------------------------------------------------------------------
// Mutable seam state (reset in beforeEach)
// ---------------------------------------------------------------------------

const DOC_REF: KnowledgeRef = { scheme: 'siyuan', kind: 'document', id: 'doc-1' }
const LOCAL_WS1_CONNECTION_ID = localMarkdownConnectionId('ws1')

// Kernel-wire fixture for the REAL SiyuanKnowledgeProvider search mapping (fullTextSearchBlock).
const KERNEL_SEARCH_RESPONSE = {
  code: 0,
  msg: '',
  data: {
    blocks: [
      {
        box: 'nb-1',
        path: '/20260807142000-x1afz9.sy',
        hPath: '/Research/Kernel Guide',
        id: 'doc-1',
        rootID: 'doc-1',
        parentID: '',
        name: 'Kernel Guide',
        alias: '',
        memo: '',
        tag: '',
        content: 'the siyuan <span data-type="search-mark">kernel</span> contract',
        fcontent: '',
        markdown: '',
        folded: false,
        type: 'NodeDocument',
        subType: '',
        refText: '',
        refs: null,
        defID: '',
        defPath: '',
        ial: '',
        children: null,
        depth: 0,
        count: 0,
        sort: 0,
        created: '20260807000000',
        updated: '20260807120000',
      },
    ],
    matchedBlockCount: 1,
    matchedRootCount: 1,
    pageCount: 1,
    docMode: false,
  },
}

// Kernel-wire fixture for lsNotebooks (POST /api/notebook/lsNotebooks).
const KERNEL_NOTEBOOKS_RESPONSE = {
  code: 0,
  msg: '',
  data: {
    notebooks: [
      { id: 'nb-1', name: 'Research', icon: '1f4da', sort: 0, sortMode: 0, closed: false, subFileCount: 12 },
      { id: 'nb-2', name: 'Inbox', icon: '', sort: 1, sortMode: 0, closed: true, subFileCount: 3 },
    ],
    boxDocEnabled: true,
  },
}

const credentials = new Map<string, { value: string }>()
const fetchCalls: Array<{ url: string; init: RequestInit }> = []
let kernelProbeError: Error | null = null
const PREVIOUS_SIYUAN_FLAG = process.env.ROX_ENABLE_SIYUAN_KNOWLEDGE

// globalThis.fetch seam: bun's mock.module registry is process-global and leaks into OTHER
// test files in combined runs (the adapter's own suite observed this fake module and failed
// 19/19 with our fixtures). Fetch, by contrast, is consulted per handler invocation — the
// handler constructs SiyuanKernelClient without fetchImpl, so the real client+adapter run
// end-to-end against this stub. Restored to the captured original in afterAll.
const originalFetch = globalThis.fetch

function installFetchSeam() {
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url)
    fetchCalls.push({ url: u, init: init as RequestInit })
    if (kernelProbeError) throw kernelProbeError
    if (u.endsWith('/api/system/version')) {
      return new Response(JSON.stringify({ code: 0, msg: '', data: '3.1.28' }), { status: 200 })
    }
    if (u.endsWith('/api/search/fullTextSearchBlock')) {
      return new Response(JSON.stringify(KERNEL_SEARCH_RESPONSE), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    if (u.endsWith('/api/notebook/lsNotebooks')) {
      return new Response(JSON.stringify(KERNEL_NOTEBOOKS_RESPONSE), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    if (u.endsWith('/api/filetree/listDocsByPath')) {
      return new Response(JSON.stringify({
        code: 0,
        msg: '',
        data: {
          box: 'nb-1',
          path: '/',
          files: [
            { id: 'folder-1', name: 'Research', path: '/20260807-folder', subFileCount: 2 },
            { id: 'doc-1', name: 'Craft Spec', path: '/20260807-doc.sy', subFileCount: 0 },
          ],
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    if (u.endsWith('/api/query/sql')) {
      return new Response(JSON.stringify({ code: 0, msg: '', data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    if (u.endsWith('/api/filetree/createDocWithMd')) {
      return new Response(JSON.stringify({ code: 0, msg: '', data: 'doc-created-1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    throw new Error(`unmocked kernel endpoint: ${u}`)
  }) as unknown as typeof fetch
}
installFetchSeam()

afterAll(() => {
  globalThis.fetch = originalFetch
  if (PREVIOUS_SIYUAN_FLAG === undefined) delete process.env.ROX_ENABLE_SIYUAN_KNOWLEDGE
  else process.env.ROX_ENABLE_SIYUAN_KNOWLEDGE = PREVIOUS_SIYUAN_FLAG
})

// ---------------------------------------------------------------------------
// Module seams: workspace registry + CredentialManager only. The SiYuan
// provider/client run REAL through the fetch seam above — module mocks must
// never target packages another suite imports directly (bun leak, see above).
// ---------------------------------------------------------------------------

mock.module('@craft-agent/shared/credentials', () => ({
  getCredentialManager: () => ({
    async get(id: CredentialId) {
      return credentials.get(`${id.type}::${id.workspaceId}::${id.sourceId}`) ?? null
    },
    async set(id: CredentialId, credential: { value: string }) {
      credentials.set(`${id.type}::${id.workspaceId}::${id.sourceId}`, credential)
    },
  }),
}))

let workspaceRoot: string
const extraWorkspaceRoots = new Map<string, string>()

mock.module('@craft-agent/shared/config', () => ({
  getWorkspaceByNameOrId: (id: string) => {
    if (id === 'ws1') return { id: 'ws1', name: 'ws1', rootPath: workspaceRoot }
    const rootPath = extraWorkspaceRoots.get(id)
    return rootPath ? { id, name: id, rootPath } : null
  },
  getWorkspaces: () => [
    ...(workspaceRoot ? [{ id: 'ws1', name: 'ws1', rootPath: workspaceRoot }] : []),
    ...[...extraWorkspaceRoots.entries()].map(([id, rootPath]) => ({ id, name: id, rootPath })),
  ],
}))

import { registerKnowledgeHandlers, HANDLED_CHANNELS, __setSkipKnowledgeWatchAutoStart } from '../knowledge'
import { getKnowledgeToolRuntime, handleKnowledgeSearch } from '@craft-agent/session-tools-core'

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function createHarness(options: { workspaceId?: string | null; sessionManager?: HandlerDeps['sessionManager'] } = {}) {
  const handlers = new Map<string, HandlerFn>()
  const server: RpcServer = {
    handle(channel, handler) { handlers.set(channel, handler) },
    push() {},
    async invokeClient() { return undefined },
    hasClientCapability() { return false },
    findClientsWithCapability() { return [] },
  }
  const deps: HandlerDeps = {
    sessionManager: options.sessionManager ?? ({} as HandlerDeps['sessionManager']),
    oauthFlowStore: {} as HandlerDeps['oauthFlowStore'],
    platform: {
      appRootPath: '/',
      resourcesPath: '/',
      isPackaged: false,
      appVersion: '0.0.0-test',
      isDebugMode: true,
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
      imageProcessor: { getMetadata: async () => null, process: async () => Buffer.from('') },
    },
  }
  registerKnowledgeHandlers(server, deps)
  const invoke = (channel: string, args: unknown) => {
    const handler = handlers.get(channel)
    if (!handler) throw new Error(`No handler for ${channel}`)
    return handler({ clientId: 'c1', workspaceId: options.workspaceId ?? null } as unknown as RequestContext, args)
  }
  return { handlers, invoke }
}

function seedConnection(id: string, overrides: Partial<SaveConnectionInput> = {}) {
  return new KnowledgeConnectionsStore().save({
    id,
    baseUrl: 'http://127.0.0.1:6806',
    credentialRef: `source_bearer::ws1::${id}`,
    ...overrides,
  })
}

beforeEach(() => {
  __setSkipKnowledgeWatchAutoStart(true)
  workspaceRoot = mkdtempSync(join(tmpdir(), 'knowledge-test-ws-'))
  rmSync(join(process.env.CRAFT_CONFIG_DIR!, 'knowledge'), { recursive: true, force: true })
  rmSync(getDefaultWorkspacesDir(), { recursive: true, force: true })
  credentials.clear()
  fetchCalls.length = 0
  kernelProbeError = null
  extraWorkspaceRoots.clear()
  process.env.ROX_ENABLE_SIYUAN_KNOWLEDGE = '1'
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('registration', () => {
  it('declares P1–P6 knowledge channels plus ENGINE_START/DETECT/METRICS — no engineStop, no CHANGED push event', () => {
    expect([...HANDLED_CHANNELS]).toEqual([
      RPC_CHANNELS.knowledge.LIST_CONNECTIONS,
      RPC_CHANNELS.knowledge.CAPABILITIES,
      RPC_CHANNELS.knowledge.SEARCH,
      RPC_CHANNELS.knowledge.GET,
      RPC_CHANNELS.knowledge.GET_CONTEXT,
      RPC_CHANNELS.knowledge.GET_BACKLINKS,
      RPC_CHANNELS.knowledge.GET_EXPORT_PAYLOAD,
      RPC_CHANNELS.knowledge.LIST_NOTEBOOKS,
      RPC_CHANNELS.knowledge.LIST_TREE,
      RPC_CHANNELS.knowledge.USER_CREATE,
      RPC_CHANNELS.knowledge.UPDATE_CONNECTION,
      RPC_CHANNELS.knowledge.SNAPSHOT_CREATE,
      RPC_CHANNELS.knowledge.SNAPSHOT_GET,
      RPC_CHANNELS.knowledge.ENGINE_STATUS,
      RPC_CHANNELS.knowledge.DETECT_ENGINE,
      RPC_CHANNELS.knowledge.ENGINE_START,
      RPC_CHANNELS.knowledge.METRICS_GET,
      RPC_CHANNELS.knowledge.PROPOSE_MUTATION,
      RPC_CHANNELS.knowledge.APPROVE_PROPOSAL,
      RPC_CHANNELS.knowledge.REJECT_PROPOSAL,
      RPC_CHANNELS.knowledge.APPLY_PROPOSAL,
      RPC_CHANNELS.knowledge.ROLLBACK_PROPOSAL,
      RPC_CHANNELS.knowledge.GET_PROPOSAL,
      RPC_CHANNELS.knowledge.LIST_PROPOSALS,
      RPC_CHANNELS.knowledge.PUBLISH_DISTILL,
      RPC_CHANNELS.knowledge.PUBLISH_GET_DRAFT,
      RPC_CHANNELS.knowledge.PUBLISH_UPDATE_DRAFT,
      RPC_CHANNELS.knowledge.PUBLISH_PREPARE,
      RPC_CHANNELS.knowledge.PUBLISH_APPLY,
      RPC_CHANNELS.knowledge.PUBLISH_FINALIZE,
      RPC_CHANNELS.knowledge.PUBLISH_LIST,
      RPC_CHANNELS.knowledge.LIST_LINKS,
      RPC_CHANNELS.knowledge.ENVELOPE_GET,
      RPC_CHANNELS.knowledge.ENVELOPE_UPSERT,
      RPC_CHANNELS.knowledge.ENVELOPE_LIST,
      RPC_CHANNELS.knowledge.VIEWS_LIST,
      RPC_CHANNELS.knowledge.VIEW_RUN,
      RPC_CHANNELS.knowledge.VIEW_SET_ATTRIBUTE,
      RPC_CHANNELS.knowledge.WATCH,
      RPC_CHANNELS.knowledge.UNWATCH,
      RPC_CHANNELS.knowledge.MIGRATE_NOTES,
    ])
    // engineStop remains out of scope (managed lifecycle).
    expect(HANDLED_CHANNELS.some((ch) => /engineStop/i.test(ch))).toBe(false)
    // CHANGED is a server→client push event subscribed via knowledge.onChanged, not a handler.
    expect([...HANDLED_CHANNELS]).not.toContain(RPC_CHANNELS.knowledge.CHANGED)
    expect(HANDLED_CHANNELS).toHaveLength(41) // + DETECT_ENGINE + METRICS_GET + LIST_NOTEBOOKS + UPDATE_CONNECTION
  })

  it('registers a handler for every declared channel and nothing else', () => {
    const { handlers } = createHarness()
    expect(handlers.size).toBe(HANDLED_CHANNELS.length)
    for (const ch of HANDLED_CHANNELS) expect(handlers.has(ch)).toBe(true)
  })
})

describe('listConnections', () => {
  it('maps store records to contract connections and never leaks credentialRef', async () => {
    seedConnection('conn-1', { status: 'ok' })
    seedConnection('conn-2', { status: 'needs_auth', baseUrl: 'http://127.0.0.1:6807' })
    const { invoke } = createHarness()
    const list = await invoke(RPC_CHANNELS.knowledge.LIST_CONNECTIONS, {}) as KnowledgeConnection[]
    expect(list).toEqual([
      {
        id: LOCAL_WS1_CONNECTION_ID,
        provider: 'local-markdown',
        label: LOCAL_MARKDOWN_LABEL,
        baseUrl: LOCAL_MARKDOWN_BASE_URL,
        status: 'connected',
      },
      { id: 'conn-1', provider: 'siyuan', label: 'http://127.0.0.1:6806', baseUrl: 'http://127.0.0.1:6806', status: 'connected' },
      { id: 'conn-2', provider: 'siyuan', label: 'http://127.0.0.1:6807', baseUrl: 'http://127.0.0.1:6807', status: 'needs_auth' },
    ])
    for (const conn of list) expect('credentialRef' in conn).toBe(false)
    expect(fetchCalls).toHaveLength(0)
  })

  it('scopes local Markdown defaults per workspace and isolates ws1 from ws2 data', async () => {
    const workspaceRootB = mkdtempSync(join(tmpdir(), 'knowledge-test-ws2-'))
    extraWorkspaceRoots.set('ws2', workspaceRootB)
    const connA = localMarkdownConnectionId('ws1')
    const connB = localMarkdownConnectionId('ws2')
    const harnessA = createHarness({ workspaceId: 'ws1' })
    const harnessB = createHarness({ workspaceId: 'ws2' })

    const listA = await harnessA.invoke(RPC_CHANNELS.knowledge.LIST_CONNECTIONS, {}) as KnowledgeConnection[]
    expect(listA[0]?.id).toBe(connA)
    const listB = await harnessB.invoke(RPC_CHANNELS.knowledge.LIST_CONNECTIONS, {}) as KnowledgeConnection[]
    expect(listB[0]?.id).toBe(connB)
    expect(connA).not.toBe(connB)
    const listAAfterBSeed = await harnessA.invoke(RPC_CHANNELS.knowledge.LIST_CONNECTIONS, {}) as KnowledgeConnection[]
    expect(listAAfterBSeed.some((connection) => connection.id === connB)).toBe(false)
    expect(listB.some((connection) => connection.id === connA)).toBe(false)

    await harnessB.invoke(RPC_CHANNELS.knowledge.USER_CREATE, {
      connectionId: connB,
      source: 'navigator',
      op: 'document',
      notebookId: LOCAL_MARKDOWN_NOTEBOOK_ID,
      path: '/',
      title: 'Only In Workspace B',
    })
    const pageB = await harnessB.invoke(RPC_CHANNELS.knowledge.SEARCH, {
      connectionId: connB,
      input: { query: 'Only In Workspace B' },
    }) as SearchPage
    const pageA = await harnessA.invoke(RPC_CHANNELS.knowledge.SEARCH, {
      connectionId: connA,
      input: { query: 'Only In Workspace B' },
    }) as SearchPage
    expect(pageB.items).toHaveLength(1)
    expect(pageA.items).toHaveLength(0)
    await expect(
      harnessB.invoke(RPC_CHANNELS.knowledge.SEARCH, {
        connectionId: connA,
        input: { query: 'Only In Workspace B' },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REF' })
    await expect(
      harnessB.invoke(RPC_CHANNELS.knowledge.LIST_NOTEBOOKS, { connectionId: connA }),
    ).rejects.toMatchObject({ code: 'INVALID_REF' })
    await expect(
      harnessB.invoke(RPC_CHANNELS.knowledge.USER_CREATE, {
        connectionId: connA,
        source: 'navigator',
        op: 'document',
        notebookId: LOCAL_MARKDOWN_NOTEBOOK_ID,
        path: '/',
        title: 'Should Not Land In Workspace A',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REF' })
    expect(existsSync(join(getDefaultWorkspacesDir(), 'ws1', 'notes', 'Should Not Land In Workspace A.md'))).toBe(false)
    expect(fetchCalls).toHaveLength(0)
  })

  it('fails closed for unscoped local Markdown calls when multiple workspaces exist', async () => {
    const workspaceRootB = mkdtempSync(join(tmpdir(), 'knowledge-test-ws2-'))
    extraWorkspaceRoots.set('ws2', workspaceRootB)
    const connA = localMarkdownConnectionId('ws1')
    const harnessA = createHarness({ workspaceId: 'ws1' })
    await harnessA.invoke(RPC_CHANNELS.knowledge.LIST_CONNECTIONS, {})
    const unscoped = createHarness()
    await expect(
      unscoped.invoke(RPC_CHANNELS.knowledge.SEARCH, {
        connectionId: connA,
        input: { query: 'x' },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REF' })
    expect(fetchCalls).toHaveLength(0)
  })

  it('keeps an old singleton local-markdown connection readable while seeding the scoped default', async () => {
    new KnowledgeConnectionsStore().save({
      id: LOCAL_MARKDOWN_CONNECTION_ID,
      provider: 'local-markdown',
      mode: 'external-local',
      baseUrl: LOCAL_MARKDOWN_BASE_URL,
      credentialRef: `source_bearer::ws1::${LOCAL_MARKDOWN_CONNECTION_ID}`,
      status: 'ok',
    })
    const { invoke } = createHarness()
    const list = await invoke(RPC_CHANNELS.knowledge.LIST_CONNECTIONS, {}) as KnowledgeConnection[]
    expect(list[0]?.id).toBe(LOCAL_WS1_CONNECTION_ID)
    expect(list.some((connection) => connection.id === LOCAL_MARKDOWN_CONNECTION_ID)).toBe(true)

    const result = await invoke(RPC_CHANNELS.knowledge.USER_CREATE, {
      connectionId: LOCAL_MARKDOWN_CONNECTION_ID,
      source: 'navigator',
      op: 'document',
      notebookId: LOCAL_MARKDOWN_NOTEBOOK_ID,
      path: '/',
      title: 'Legacy Singleton Note',
    }) as { id: string }
    expect(result.id).toBe('Legacy Singleton Note')
    expect(existsSync(join(getDefaultWorkspacesDir(), 'ws1', 'notes', 'Legacy Singleton Note.md'))).toBe(true)
    expect(fetchCalls).toHaveLength(0)
  })
})

describe('search', () => {
  it('serves the query through the real provider with the CredentialManager token', async () => {
    seedConnection('conn-1', { status: 'ok' })
    credentials.set('source_bearer::ws1::conn-1', { value: 'secret-token-1' })
    const { invoke } = createHarness()
    const page = (await invoke(RPC_CHANNELS.knowledge.SEARCH, { connectionId: 'conn-1', input: { query: 'kernel' } })) as SearchPage

    // Real adapter mapping of the kernel fixture (title from hPath leaf, markup stripped).
    expect(page.items).toHaveLength(1)
    expect(page.items[0]!.title).toBe('Kernel Guide')
    expect(page.items[0]!.snippet).toBe('the siyuan kernel contract')
    expect(page.items[0]!.ref).toEqual(DOC_REF)

    // End-to-end plumbing: exact kernel endpoint, bearer token at protocol layer, query passthrough.
    const call = fetchCalls.find((c) => c.url.endsWith('/api/search/fullTextSearchBlock'))!
    expect((call.init.headers as Record<string, string>)['Authorization']).toBe('Token secret-token-1')
    expect((JSON.parse(String(call.init.body)) as Record<string, unknown>)['query']).toBe('kernel')
  })

  it('rejects an unknown connectionId with CodedError NOT_FOUND before touching the kernel', async () => {
    const { invoke } = createHarness()
    await expect(
      invoke(RPC_CHANNELS.knowledge.SEARCH, { connectionId: 'conn-missing', input: { query: 'x' } }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(fetchCalls).toHaveLength(0)
  })

  it('keeps SiYuan disabled by default: no bootstrap/client/fetch before CAPABILITY_DISABLED', async () => {
    delete process.env.ROX_ENABLE_SIYUAN_KNOWLEDGE
    seedConnection('conn-1', { status: 'ok' })
    credentials.set('source_bearer::ws1::conn-1', { value: 'secret-token-1' })
    const { invoke } = createHarness()
    await expect(
      invoke(RPC_CHANNELS.knowledge.SEARCH, { connectionId: 'conn-1', input: { query: 'kernel' } }),
    ).rejects.toMatchObject({ code: 'CAPABILITY_DISABLED' })
    await expect(
      invoke(RPC_CHANNELS.knowledge.LIST_NOTEBOOKS, { connectionId: 'conn-1' }),
    ).rejects.toMatchObject({ code: 'CAPABILITY_DISABLED' })
    await expect(
      invoke(RPC_CHANNELS.knowledge.USER_CREATE, {
        connectionId: 'conn-1',
        source: 'navigator',
        op: 'document',
        notebookId: 'nb-1',
        path: '/',
        title: 'Should Not Reach Kernel',
      }),
    ).rejects.toMatchObject({ code: 'CAPABILITY_DISABLED' })
    const status = await invoke(RPC_CHANNELS.knowledge.ENGINE_STATUS, { connectionId: 'conn-1' }) as Record<string, unknown>
    expect(status).toMatchObject({ running: false, reason: 'CAPABILITY_DISABLED' })
    await expect(invoke(RPC_CHANNELS.knowledge.ENGINE_START, { connectionId: 'conn-1' })).rejects.toMatchObject({
      code: 'CAPABILITY_DISABLED',
    })
    await expect(invoke(RPC_CHANNELS.knowledge.DETECT_ENGINE, {})).rejects.toMatchObject({
      code: 'CAPABILITY_DISABLED',
    })
    expect(fetchCalls).toHaveLength(0)
  })
})

describe('migrateNotes guards', () => {
  it('keeps SiYuan migration disabled by default before token/client/fetch work', async () => {
    delete process.env.ROX_ENABLE_SIYUAN_KNOWLEDGE
    seedConnection('conn-1', { status: 'ok' })
    credentials.set('source_bearer::ws1::conn-1', { value: 'secret-token-1' })
    const { invoke } = createHarness({ workspaceId: 'ws1' })
    await expect(
      invoke(RPC_CHANNELS.knowledge.MIGRATE_NOTES, {
        workspaceId: 'ws1',
        connectionId: 'conn-1',
      }),
    ).rejects.toMatchObject({ code: 'CAPABILITY_DISABLED' })
    expect(fetchCalls).toHaveLength(0)
  })

  it('rejects local-markdown migration before any SiYuan client call', async () => {
    const { invoke } = createHarness({ workspaceId: 'ws1' })
    await invoke(RPC_CHANNELS.knowledge.LIST_CONNECTIONS, {})
    fetchCalls.length = 0
    await expect(
      invoke(RPC_CHANNELS.knowledge.MIGRATE_NOTES, {
        workspaceId: 'ws1',
        connectionId: LOCAL_WS1_CONNECTION_ID,
      }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' })
    expect(fetchCalls).toHaveLength(0)
  })

  it('rejects workspace mismatch before token/client/fetch work', async () => {
    const workspaceRootB = mkdtempSync(join(tmpdir(), 'knowledge-test-ws2-'))
    extraWorkspaceRoots.set('ws2', workspaceRootB)
    seedConnection('conn-1', { status: 'ok' })
    const { invoke } = createHarness({ workspaceId: 'ws2' })
    await expect(
      invoke(RPC_CHANNELS.knowledge.MIGRATE_NOTES, {
        workspaceId: 'ws2',
        connectionId: 'conn-1',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REF' })
    expect(fetchCalls).toHaveLength(0)
  })
})

// K-10 §3.1: registerKnowledgeHandlers publishes the KnowledgeToolRuntime consumed by
// the knowledge_search / knowledge_read / knowledge_get_backlinks session tools.
describe('knowledge session-tool runtime registration', () => {
  it('registers a runtime whose search flows through the same provider resolution as the RPC read channels', async () => {
    seedConnection('conn-1', { status: 'ok' })
    credentials.set('source_bearer::ws1::conn-1', { value: 'secret-token-1' })
    createHarness()
    const runtime = getKnowledgeToolRuntime()
    expect(runtime).not.toBeNull()
    const page = await runtime!.search({ input: { query: 'kernel' } })
    expect(page.items).toHaveLength(1)
    expect(page.items[0]!.ref).toEqual(DOC_REF)
    const call = fetchCalls.find((c) => c.url.endsWith('/api/search/fullTextSearchBlock'))!
    expect((call.init.headers as Record<string, string>)['Authorization']).toBe('Token secret-token-1')
  })

  it('resolves the default (first) connection when the tool call omits connectionId', async () => {
    seedConnection('conn-1', { status: 'ok' })
    credentials.set('source_bearer::ws1::conn-1', { value: 'secret-token-1' })
    createHarness()
    const runtime = getKnowledgeToolRuntime()!
    // No connectionId — the runtime must default to the only configured connection.
    const page = await runtime.search({ input: { query: 'kernel' } })
    expect(page.items).toHaveLength(1)
  })

  it('answers a typed CONNECTION_UNAVAILABLE when no connection is configured', async () => {
    createHarness()
    const runtime = getKnowledgeToolRuntime()!
    await expect(runtime.search({ input: { query: 'x' } })).rejects.toMatchObject({
      code: 'CONNECTION_UNAVAILABLE',
    })
    expect(fetchCalls).toHaveLength(0)
  })

  it('end-to-end: the knowledge_search handler returns bounded provenance-rich text via the registered runtime', async () => {
    seedConnection('conn-1', { status: 'ok' })
    credentials.set('source_bearer::ws1::conn-1', { value: 'secret-token-1' })
    createHarness()
    const result = await handleKnowledgeSearch({ sessionId: 'sess-1' } as never, { query: 'kernel' })
    expect(result.isError).toBeFalsy()
    const text = result.content.map((c) => c.text).join('\n')
    expect(text).toContain('Kernel Guide')
    expect(text).toContain('siyuan/document/doc-1')
    expect(text).toContain('siyuan://blocks/doc-1')
  })
})

describe('listNotebooks', () => {
  it('serves the kernel notebook list for a configured connection (navigator tree)', async () => {
    seedConnection('conn-1', { status: 'ok' })
    credentials.set('source_bearer::ws1::conn-1', { value: 'secret-token-1' })
    const { invoke } = createHarness()
    const notebooks = (await invoke(RPC_CHANNELS.knowledge.LIST_NOTEBOOKS, { connectionId: 'conn-1' })) as Array<Record<string, unknown>>
    expect(notebooks).toEqual([
      { id: 'nb-1', name: 'Research', icon: '1f4da', closed: false },
      { id: 'nb-2', name: 'Inbox', icon: '', closed: true },
    ])
    const call = fetchCalls.find((c) => c.url.endsWith('/api/notebook/lsNotebooks'))!
    expect((call.init.headers as Record<string, string>)['Authorization']).toBe('Token secret-token-1')
  })

  it('serves the workspace local Markdown notebook list without touching the SiYuan kernel', async () => {
    const { invoke } = createHarness()
    await invoke(RPC_CHANNELS.knowledge.LIST_CONNECTIONS, {})
    fetchCalls.length = 0
    const notebooks = (await invoke(RPC_CHANNELS.knowledge.LIST_NOTEBOOKS, {
      connectionId: LOCAL_WS1_CONNECTION_ID,
    })) as Array<Record<string, unknown>>
    expect(notebooks).toEqual([
      { id: LOCAL_MARKDOWN_NOTEBOOK_ID, name: 'Local Markdown', icon: '1f4dd', closed: false },
    ])
    expect(fetchCalls).toHaveLength(0)
  })

  it('rejects an unknown connectionId with CodedError NOT_FOUND before touching the kernel', async () => {
    const { invoke } = createHarness()
    await expect(
      invoke(RPC_CHANNELS.knowledge.LIST_NOTEBOOKS, { connectionId: 'conn-missing' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(fetchCalls).toHaveLength(0)
  })

  it('maps an unreachable kernel to a typed CONNECTION_UNAVAILABLE (never a raw throw)', async () => {
    seedConnection('conn-1', { status: 'ok' })
    credentials.set('source_bearer::ws1::conn-1', { value: 'secret-token-1' })
    kernelProbeError = new Error('connect ECONNREFUSED 127.0.0.1:6806')
    const { invoke } = createHarness()
    await expect(
      invoke(RPC_CHANNELS.knowledge.LIST_NOTEBOOKS, { connectionId: 'conn-1' }),
    ).rejects.toMatchObject({ code: 'CONNECTION_UNAVAILABLE' })
  })
})


describe('listTree', () => {
  it('returns kernel doc tree for a notebook', async () => {
    seedConnection('conn-1', { status: 'ok' })
    credentials.set('source_bearer::ws1::conn-1', { value: 'secret-token-1' })
    const { invoke } = createHarness()
    const tree = await invoke(RPC_CHANNELS.knowledge.LIST_TREE, {
      connectionId: 'conn-1',
      notebookId: 'nb-1',
    }) as { notebookId: string; nodes: Array<{ kind: string; id: string }> }
    expect(tree.notebookId).toBe('nb-1')
    expect(tree.nodes.map((n) => n.kind)).toEqual(['folder', 'document'])
  })

  it('returns local Markdown tree without touching the SiYuan kernel', async () => {
    const { invoke } = createHarness()
    await invoke(RPC_CHANNELS.knowledge.LIST_CONNECTIONS, {})
    await invoke(RPC_CHANNELS.knowledge.USER_CREATE, {
      connectionId: LOCAL_WS1_CONNECTION_ID,
      source: 'navigator',
      op: 'document',
      notebookId: LOCAL_MARKDOWN_NOTEBOOK_ID,
      path: '/',
      title: 'Local Tree Note',
    })
    fetchCalls.length = 0
    const tree = await invoke(RPC_CHANNELS.knowledge.LIST_TREE, {
      connectionId: LOCAL_WS1_CONNECTION_ID,
      notebookId: LOCAL_MARKDOWN_NOTEBOOK_ID,
    }) as { notebookId: string; nodes: Array<{ kind: string; id: string }> }
    expect(tree.notebookId).toBe(LOCAL_MARKDOWN_NOTEBOOK_ID)
    expect(tree.nodes.filter((n) => n.kind === 'document').map((n) => ({ kind: n.kind, id: n.id }))).toEqual([
      { kind: 'document', id: 'Local Tree Note' },
    ])
    expect(fetchCalls).toHaveLength(0)
  })
})

describe('localMarkdown safety', () => {
  it('rejects symlink escapes before reading a local Markdown note', async () => {
    const { invoke } = createHarness()
    await invoke(RPC_CHANNELS.knowledge.LIST_CONNECTIONS, {})
    const notesRoot = join(getDefaultWorkspacesDir(), 'ws1', 'notes')
    mkdirSync(notesRoot, { recursive: true })
    const outside = join(workspaceRoot, 'outside.md')
    writeFileSync(outside, '# outside secret\n', 'utf-8')
    symlinkSync(outside, join(notesRoot, 'Escape.md'))
    await expect(
      invoke(RPC_CHANNELS.knowledge.GET, {
        connectionId: LOCAL_WS1_CONNECTION_ID,
        ref: { scheme: 'local-note', kind: 'document', id: 'Escape' },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REF' })
    expect(fetchCalls).toHaveLength(0)
  })

  it('rejects symlinked directory ancestors in tree and create paths', async () => {
    const { invoke } = createHarness()
    await invoke(RPC_CHANNELS.knowledge.LIST_CONNECTIONS, {})
    const notesRoot = join(getDefaultWorkspacesDir(), 'ws1', 'notes')
    mkdirSync(notesRoot, { recursive: true })
    const outsideDir = mkdtempSync(join(tmpdir(), 'knowledge-test-outside-'))
    writeFileSync(join(outsideDir, 'Outside.md'), '# outside secret\n', 'utf-8')
    symlinkSync(outsideDir, join(notesRoot, 'Linked'))

    await expect(
      invoke(RPC_CHANNELS.knowledge.LIST_TREE, {
        connectionId: LOCAL_WS1_CONNECTION_ID,
        notebookId: LOCAL_MARKDOWN_NOTEBOOK_ID,
        path: '/Linked',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REF' })

    await expect(
      invoke(RPC_CHANNELS.knowledge.USER_CREATE, {
        connectionId: LOCAL_WS1_CONNECTION_ID,
        source: 'navigator',
        op: 'document',
        notebookId: LOCAL_MARKDOWN_NOTEBOOK_ID,
        path: '/Linked',
        title: 'Escaped Create',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REF' })
    expect(existsSync(join(outsideDir, 'Escaped Create.md'))).toBe(false)
    expect(fetchCalls).toHaveLength(0)
  })
})

describe('workspace read/watch guards', () => {
  it('does not expose or use another workspace SiYuan connection', async () => {
    const workspaceRootB = mkdtempSync(join(tmpdir(), 'knowledge-test-ws2-'))
    extraWorkspaceRoots.set('ws2', workspaceRootB)
    seedConnection('conn-ws1', { status: 'ok' })
    seedConnection('conn-ws2', {
      status: 'ok',
      credentialRef: 'source_bearer::ws2::conn-ws2',
    })
    credentials.set('source_bearer::ws1::conn-ws1', { value: 'token-before' })
    credentials.set('source_bearer::ws2::conn-ws2', { value: 'token-ws2' })
    const harnessB = createHarness({ workspaceId: 'ws2' })

    const connections = await harnessB.invoke(RPC_CHANNELS.knowledge.LIST_CONNECTIONS, {}) as KnowledgeConnection[]
    expect(connections.some((connection) => connection.id === 'conn-ws1')).toBe(false)
    expect(connections.some((connection) => connection.id === 'conn-ws2')).toBe(true)
    await expect(
      harnessB.invoke(RPC_CHANNELS.knowledge.SEARCH, {
        connectionId: 'conn-ws1',
        input: { query: 'kernel' },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REF' })
    await expect(
      harnessB.invoke(RPC_CHANNELS.knowledge.LIST_NOTEBOOKS, { connectionId: 'conn-ws1' }),
    ).rejects.toMatchObject({ code: 'INVALID_REF' })
    await expect(
      harnessB.invoke(RPC_CHANNELS.knowledge.UPDATE_CONNECTION, {
        connectionId: 'conn-ws1',
        baseUrl: 'http://127.0.0.1:6807',
        token: 'token-after',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REF' })
    expect(new KnowledgeConnectionsStore().get('conn-ws1')!.baseUrl).toBe('http://127.0.0.1:6806')
    expect(credentials.get('source_bearer::ws1::conn-ws1')?.value).toBe('token-before')
    expect(fetchCalls).toHaveLength(0)
  })

  it('does not expose another workspace proposal lifecycle', async () => {
    const workspaceRootB = mkdtempSync(join(tmpdir(), 'knowledge-test-ws2-'))
    extraWorkspaceRoots.set('ws2', workspaceRootB)
    const createdAt = new Date().toISOString()
    const proposal: KnowledgeProposalFileRecord = {
      id: 'p_ws1',
      connectionId: 'conn-ws1',
      targetRef: { scheme: 'siyuan', kind: 'block', id: 'blk-ws1' },
      ops: [{ op: 'updateBlock', blockId: 'blk-ws1', markdown: 'patched' }],
      selectionProofs: [],
      baseHash: 'base-ws1',
      baseReadAt: createdAt,
      preState: 'original',
      hashAlgorithm: 'sha256-canonical-v1',
      status: 'pending_review',
      statusHistory: [],
      createdAt,
      updatedAt: createdAt,
      actor: 'user',
    }
    new KnowledgeMutationProposalsStore(workspaceRoot).save(proposal)
    const harnessB = createHarness({ workspaceId: 'ws2' })

    await expect(
      harnessB.invoke(RPC_CHANNELS.knowledge.LIST_PROPOSALS, { workspaceId: 'ws1' }),
    ).rejects.toMatchObject({ code: 'INVALID_REF' })
    const visible = await harnessB.invoke(RPC_CHANNELS.knowledge.LIST_PROPOSALS, {}) as KnowledgeProposalFileRecord[]
    expect(visible).toEqual([])
    await expect(
      harnessB.invoke(RPC_CHANNELS.knowledge.GET_PROPOSAL, { proposalId: 'p_ws1' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(
      harnessB.invoke(RPC_CHANNELS.knowledge.APPROVE_PROPOSAL, { proposalId: 'p_ws1' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(
      harnessB.invoke(RPC_CHANNELS.knowledge.REJECT_PROPOSAL, { proposalId: 'p_ws1' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(
      harnessB.invoke(RPC_CHANNELS.knowledge.APPLY_PROPOSAL, {
        proposalId: 'p_ws1',
        workspaceId: 'ws1',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REF' })
    await expect(
      harnessB.invoke(RPC_CHANNELS.knowledge.ROLLBACK_PROPOSAL, { proposalId: 'p_ws1' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(new KnowledgeMutationProposalsStore(workspaceRoot).get('p_ws1')?.status).toBe('pending_review')
  })

  it('rejects publication distill when the loaded session belongs to another workspace', async () => {
    seedConnection('conn-ws1', { status: 'ok' })
    const sessionManager = {
      async getSession() {
        return {
          id: 'sess-ws2',
          workspaceId: 'ws2',
          messages: [{ id: 'm1', role: 'user', content: 'foreign workspace content' }],
        }
      },
    } as unknown as HandlerDeps['sessionManager']
    const harnessA = createHarness({ workspaceId: 'ws1', sessionManager })

    await expect(
      harnessA.invoke(RPC_CHANNELS.knowledge.PUBLISH_DISTILL, {
        connectionId: 'conn-ws1',
        sessionId: 'sess-ws2',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REF' })
  })

  it('rejects metrics and publication finalize for another workspace', async () => {
    const workspaceRootB = mkdtempSync(join(tmpdir(), 'knowledge-test-ws2-'))
    extraWorkspaceRoots.set('ws2', workspaceRootB)
    seedConnection('conn-ws1', { status: 'ok' })
    const harnessB = createHarness({ workspaceId: 'ws2' })

    await expect(
      harnessB.invoke(RPC_CHANNELS.knowledge.METRICS_GET, { workspaceId: 'ws1' }),
    ).rejects.toMatchObject({ code: 'INVALID_REF' })
    await expect(
      harnessB.invoke(RPC_CHANNELS.knowledge.PUBLISH_FINALIZE, {
        connectionId: 'conn-ws1',
        draftId: 'draft-ws1',
        proposalId: 'proposal-ws1',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REF' })
  })

  it('rejects snapshotGet when caller workspace does not match the requested workspace', async () => {
    const workspaceRootB = mkdtempSync(join(tmpdir(), 'knowledge-test-ws2-'))
    extraWorkspaceRoots.set('ws2', workspaceRootB)
    const ref: KnowledgeRef = { scheme: 'local-note', kind: 'document', id: 'Workspace A Note' }
    const snapshot = new KnowledgeContextSnapshotsStore(workspaceRoot).create({
      sessionId: 'sess-a',
      provider: 'local-markdown',
      ref,
      contentHash: 'hash-a',
      snapshot: {
        ref,
        mode: 'snapshot' as ContextMode,
        blockId: ref.id,
        content: 'workspace A content',
        children: [],
        backlinks: [],
        attributes: [],
        capturedAt: Date.now(),
        contentHash: 'hash-a',
      } satisfies ContextPayload,
    })

    const harnessB = createHarness({ workspaceId: 'ws2' })
    let error: unknown = null
    try {
      harnessB.invoke(RPC_CHANNELS.knowledge.SNAPSHOT_GET, {
        workspaceId: 'ws1',
        snapshotId: snapshot.id,
      })
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(CodedError)
    expect(error).toMatchObject({ code: 'INVALID_REF' })

    const harnessA = createHarness({ workspaceId: 'ws1' })
    const ownSnapshot = await harnessA.invoke(RPC_CHANNELS.knowledge.SNAPSHOT_GET, {
      workspaceId: 'ws1',
      snapshotId: snapshot.id,
    }) as { id: string }
    expect(ownSnapshot.id).toBe(snapshot.id)
    expect(fetchCalls).toHaveLength(0)
  })

  it('rejects unwatch when caller workspace does not match the connection/request workspace', async () => {
    const workspaceRootB = mkdtempSync(join(tmpdir(), 'knowledge-test-ws2-'))
    extraWorkspaceRoots.set('ws2', workspaceRootB)
    const harnessA = createHarness({ workspaceId: 'ws1' })
    await harnessA.invoke(RPC_CHANNELS.knowledge.LIST_CONNECTIONS, {})
    const harnessB = createHarness({ workspaceId: 'ws2' })

    await expect(
      harnessB.invoke(RPC_CHANNELS.knowledge.UNWATCH, {
        connectionId: LOCAL_WS1_CONNECTION_ID,
        workspaceId: 'ws1',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REF' })
    await expect(
      harnessB.invoke(RPC_CHANNELS.knowledge.UNWATCH, {
        connectionId: LOCAL_WS1_CONNECTION_ID,
        workspaceId: 'ws2',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REF' })
    expect(fetchCalls).toHaveLength(0)
  })
})

describe('userCreate', () => {
  it('rejects source agent with UNSUPPORTED_OPERATION', async () => {
    seedConnection('conn-1', { status: 'ok' })
    credentials.set('source_bearer::ws1::conn-1', { value: 'secret-token-1' })
    const { invoke } = createHarness()
    await expect(
      invoke(RPC_CHANNELS.knowledge.USER_CREATE, {
        connectionId: 'conn-1',
        source: 'agent',
        op: 'document',
        notebookId: 'nb-1',
        path: '/',
        title: 'Note',
      }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' })
    expect(fetchCalls.filter((c) => c.url.endsWith('/api/filetree/createDocWithMd'))).toHaveLength(0)
  })

  it('creates a document from the navigator', async () => {
    seedConnection('conn-1', { status: 'ok' })
    credentials.set('source_bearer::ws1::conn-1', { value: 'secret-token-1' })
    const { invoke } = createHarness()
    const result = await invoke(RPC_CHANNELS.knowledge.USER_CREATE, {
      connectionId: 'conn-1',
      source: 'navigator',
      op: 'document',
      notebookId: 'nb-1',
      path: '/',
      title: 'Note',
    }) as { id: string }
    expect(result.id).toBe('doc-created-1')
  })

  it('creates a local Markdown document through the safe notes path and never calls port 6806', async () => {
    const { invoke } = createHarness()
    await invoke(RPC_CHANNELS.knowledge.LIST_CONNECTIONS, {})
    fetchCalls.length = 0
    const result = await invoke(RPC_CHANNELS.knowledge.USER_CREATE, {
      connectionId: LOCAL_WS1_CONNECTION_ID,
      source: 'navigator',
      op: 'document',
      notebookId: LOCAL_MARKDOWN_NOTEBOOK_ID,
      path: '/',
      title: 'Local Note',
    }) as { id: string }
    const notePath = join(getDefaultWorkspacesDir(), 'ws1', 'notes', 'Local Note.md')
    expect(result.id).toBe('Local Note')
    expect(existsSync(notePath)).toBe(true)
    expect(readFileSync(notePath, 'utf-8')).toContain('title: Local Note')
    expect(fetchCalls).toHaveLength(0)
  })
})

describe('updateConnection', () => {
  it('updates baseUrl on an existing record and returns the contract connection (no credentialRef leak)', async () => {
    seedConnection('conn-1', { status: 'unknown' })
    const { invoke } = createHarness()
    const updated = (await invoke(RPC_CHANNELS.knowledge.UPDATE_CONNECTION, {
      connectionId: 'conn-1',
      baseUrl: 'http://127.0.0.1:6807/',
    })) as KnowledgeConnection
    expect(updated.baseUrl).toBe('http://127.0.0.1:6807')
    expect(updated.id).toBe('conn-1')
    expect('credentialRef' in updated).toBe(false)
    // The store persists the change.
    expect(new KnowledgeConnectionsStore().get('conn-1')!.baseUrl).toBe('http://127.0.0.1:6807')
    // A reachable kernel flips the cached probe status to ok → 'connected' on the wire.
    expect(updated.status).toBe('connected')
  })

  it('rejects a malformed baseUrl with typed INVALID_REF and leaves the record untouched', async () => {
    seedConnection('conn-1', { status: 'ok' })
    const { invoke } = createHarness()
    await expect(
      invoke(RPC_CHANNELS.knowledge.UPDATE_CONNECTION, { connectionId: 'conn-1', baseUrl: 'not a url' }),
    ).rejects.toMatchObject({ code: 'INVALID_REF' })
    await expect(
      invoke(RPC_CHANNELS.knowledge.UPDATE_CONNECTION, { connectionId: 'conn-1', baseUrl: 'ftp://example.com' }),
    ).rejects.toMatchObject({ code: 'INVALID_REF' })
    expect(new KnowledgeConnectionsStore().get('conn-1')!.baseUrl).toBe('http://127.0.0.1:6806')
  })

  it('rejects an unknown connectionId with CodedError NOT_FOUND', async () => {
    const { invoke } = createHarness()
    await expect(
      invoke(RPC_CHANNELS.knowledge.UPDATE_CONNECTION, { connectionId: 'conn-missing', baseUrl: 'http://127.0.0.1:6806' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('saves a provided token under the record credentialRef workspace (not the caller workspace)', async () => {
    // The record's credentialRef pins ws1; a caller from another workspace context must
    // still land the token where the read path resolves it (P2-12 semantics).
    seedConnection('conn-1', { status: 'unknown' })
    const { invoke } = createHarness()
    await invoke(RPC_CHANNELS.knowledge.UPDATE_CONNECTION, { connectionId: 'conn-1', token: 'fresh-token' })
    expect(credentials.get('source_bearer::ws1::conn-1')?.value).toBe('fresh-token')
  })

  it('keeps a legacy siyuan-local row updatable and survives an offline kernel (save still succeeds)', async () => {
    seedConnection('siyuan-local', { status: 'unknown' })
    const { invoke } = createHarness()
    kernelProbeError = new Error('connect ECONNREFUSED 127.0.0.1:6806')
    const updated = (await invoke(RPC_CHANNELS.knowledge.UPDATE_CONNECTION, {
      connectionId: 'siyuan-local',
      baseUrl: 'http://localhost:6807',
    })) as KnowledgeConnection
    expect(updated.id).toBe('siyuan-local')
    expect(updated.baseUrl).toBe('http://localhost:6807')
    // Probe failed → status 'failed' maps to 'offline' on the wire, but the save succeeded.
    expect(updated.status).toBe('offline')
  })
})

describe('engineStatus', () => {
  it('reports running with the kernel version when the probe answers', async () => {
    seedConnection('conn-1', { status: 'ok' })
    credentials.set('source_bearer::ws1::conn-1', { value: 'secret-token-1' })
    const { invoke } = createHarness()
    const status = await invoke(RPC_CHANNELS.knowledge.ENGINE_STATUS, { connectionId: 'conn-1' })
    expect(status).toMatchObject({ mode: 'external-local', running: true, version: '3.1.28' })
    expect(typeof (status as { binaryFound?: boolean }).binaryFound).toBe('boolean')
    expect(typeof (status as { installUrl?: string }).installUrl).toBe('string')
  })

  it('reports running:false when the kernel probe fails — probe semantics, never a throw', async () => {
    seedConnection('conn-1', { status: 'failed' })
    kernelProbeError = new Error('connect ECONNREFUSED 127.0.0.1:6806')
    const { invoke } = createHarness()
    const status = await invoke(RPC_CHANNELS.knowledge.ENGINE_STATUS, { connectionId: 'conn-1' })
    expect(status).toMatchObject({ mode: 'external-local', running: false })
  })

  it('seeds a default local connection via listConnections when empty', async () => {
    const { invoke } = createHarness()
    const list = await invoke(RPC_CHANNELS.knowledge.LIST_CONNECTIONS, {}) as KnowledgeConnection[]
    expect(list.length).toBeGreaterThanOrEqual(1)
    expect(list[0]).toMatchObject({
      id: LOCAL_WS1_CONNECTION_ID,
      provider: 'local-markdown',
      baseUrl: LOCAL_MARKDOWN_BASE_URL,
      status: 'connected',
    })
  })
})

// TC-3: handler-invoke error-shape contracts for the P3 proposal channels.
describe('proposals wire errors', () => {
  it('getProposal with an unknown id rejects with CodedError NOT_FOUND (no workspaces scanned)', async () => {
    const { invoke } = createHarness()
    await expect(
      invoke(RPC_CHANNELS.knowledge.GET_PROPOSAL, { proposalId: 'p_missing' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('listProposals returns [] when no workspaces are registered', async () => {
    const { invoke } = createHarness()
    const proposals = await invoke(RPC_CHANNELS.knowledge.LIST_PROPOSALS, {})
    expect(proposals).toEqual([])
  })

  it('proposeMutation with ops: [] rejects as typed INVALID_REF, never a generic 500', async () => {
    seedConnection('conn-1', { status: 'ok' })
    const { invoke } = createHarness()
    // Default permission mode is 'ask' (mode-manager), so the gate passes and
    // the empty-ops admission guard (validateOpsWhitelist 'empty-ops') is what fires.
    await expect(
      invoke(RPC_CHANNELS.knowledge.PROPOSE_MUTATION, {
        connectionId: 'conn-1',
        input: { targetRef: DOC_REF, ops: [] },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REF' })
  })

  it('proposeMutation with a missing targetRef rejects as typed INVALID_REF before touching the bridge', async () => {
    seedConnection('conn-1', { status: 'ok' })
    const { invoke } = createHarness()
    await expect(
      invoke(RPC_CHANNELS.knowledge.PROPOSE_MUTATION, {
        connectionId: 'conn-1',
        input: { ops: [{ op: 'updateBlock', blockId: 'b-1', markdown: 'x' }] },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REF' })
    expect(fetchCalls).toHaveLength(0)
  })

  it('proposeMutation without input rejects as typed INVALID_REF', async () => {
    seedConnection('conn-1', { status: 'ok' })
    const { invoke } = createHarness()
    await expect(
      invoke(RPC_CHANNELS.knowledge.PROPOSE_MUTATION, { connectionId: 'conn-1' }),
    ).rejects.toMatchObject({ code: 'INVALID_REF' })
  })

  it('proposeMutation with an unknown connectionId still rejects NOT_FOUND (unchanged precedence)', async () => {
    const { invoke } = createHarness()
    await expect(
      invoke(RPC_CHANNELS.knowledge.PROPOSE_MUTATION, {
        connectionId: 'conn-missing',
        input: { targetRef: DOC_REF, ops: [{ op: 'updateBlock', blockId: 'b-1', markdown: 'x' }] },
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('applyProposal guard mapping (§3.2 wire contract, P2-14)', () => {
  it('pre-sweep demotes approval-expired proposals (recorded) and answers apply with a typed HASH_CONFLICT + re-approval hint', async () => {
    const { invoke } = createHarness()
    const approvedAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()
    const expiredSeed: KnowledgeProposalFileRecord = {
      id: 'p_expired',
      connectionId: 'conn-1',
      targetRef: { scheme: 'siyuan', kind: 'block', id: 'blk-1' },
      ops: [{ op: 'updateBlock', blockId: 'blk-1', markdown: 'patched' }],
      selectionProofs: [],
      baseHash: 'deadbeef',
      baseReadAt: approvedAt,
      preState: 'original',
      hashAlgorithm: 'sha256-canonical-v1',
      status: 'approved',
      statusHistory: [{ from: 'pending_review', to: 'approved', at: approvedAt, actor: 'user' }],
      createdAt: approvedAt,
      updatedAt: approvedAt,
      actor: 'user',
      approvedBy: 'user',
      approvedAt,
    }
    new KnowledgeMutationProposalsStore(workspaceRoot).save(expiredSeed)

    const error: unknown = await invoke(RPC_CHANNELS.knowledge.APPLY_PROPOSAL, {
      proposalId: 'p_expired',
      workspaceId: 'ws1',
    }).then(() => null, (caught: unknown) => caught)

    // Typed wire error — never a raw engine ProposalTransitionError stack.
    expect(error).toBeInstanceOf(CodedError)
    expect(error).toMatchObject({ code: 'HASH_CONFLICT' })
    expect((error as Error).message).toContain("beginApply")
    expect((error as Error).message).toContain('approve it again')
    // And the pre-sweep demotion was RECORDED (the informative UX state), not silently errored.
    const record = new KnowledgeMutationProposalsStore(workspaceRoot).get('p_expired')
    expect(record?.status).toBe('pending_review')
    expect(record?.approvedAt).toBeUndefined()
  })
})

describe('getExportPayload', () => {
  it('rejects connection/ref provider mismatches before touching any provider', async () => {
    seedConnection('conn-1', { status: 'ok' })
    const { invoke } = createHarness()
    await invoke(RPC_CHANNELS.knowledge.LIST_CONNECTIONS, {})
    fetchCalls.length = 0
    await expect(
      invoke(RPC_CHANNELS.knowledge.GET_EXPORT_PAYLOAD, {
        connectionId: LOCAL_WS1_CONNECTION_ID,
        ref: DOC_REF,
        formats: ['deepLink', 'id'],
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REF' })
    await expect(
      invoke(RPC_CHANNELS.knowledge.GET_EXPORT_PAYLOAD, {
        connectionId: 'conn-1',
        ref: { scheme: 'local-note', kind: 'document', id: 'Local Note' },
        formats: ['deepLink', 'id'],
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REF' })
    expect(fetchCalls).toHaveLength(0)
  })

  it('returns deepLink + id without kernel content when only those formats are requested', async () => {
    seedConnection('conn-1', { status: 'ok' })
    credentials.set('source_bearer::ws1::conn-1', { value: 'tok' })
    const { invoke } = createHarness()
    const result = await invoke(RPC_CHANNELS.knowledge.GET_EXPORT_PAYLOAD, {
      connectionId: 'conn-1',
      ref: DOC_REF,
      formats: ['deepLink', 'id'],
    }) as { id: string; deepLink?: string; markdown?: string }
    expect(result).toEqual({
      id: 'doc-1',
      deepLink: 'siyuan://blocks/doc-1',
    })
    // No content formats → no kernel get
    expect(fetchCalls.some((c) => c.url.includes('/api/export/') || c.url.includes('getBlockKramdown'))).toBe(false)
  })

  it('returns markdown + hPath + title for a document via provider.get', async () => {
    seedConnection('conn-1', { status: 'ok' })
    credentials.set('source_bearer::ws1::conn-1', { value: 'tok' })
    // Extend fetch seam for document get path used by real adapter
    const prevFetch = globalThis.fetch
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      const u = String(url)
      fetchCalls.push({ url: u, init: init as RequestInit })
      if (kernelProbeError) throw kernelProbeError
      if (u.endsWith('/api/system/version')) {
        return new Response(JSON.stringify({ code: 0, msg: '', data: '3.1.28' }), { status: 200 })
      }
      if (u.endsWith('/api/block/checkBlockExist')) {
        return new Response(JSON.stringify({ code: 0, msg: '', data: true }), { status: 200 })
      }
      if (u.endsWith('/api/export/exportMdContent')) {
        return new Response(JSON.stringify({
          code: 0, msg: '', data: { hPath: '/Research/Kernel Guide', content: '# Kernel Guide\n\nbody' },
        }), { status: 200 })
      }
      if (u.endsWith('/api/block/getDocInfo')) {
        return new Response(JSON.stringify({
          code: 0, msg: '', data: {
            id: 'doc-1', rootID: 'doc-1', name: 'Kernel Guide', refCount: 0, subFileCount: 0,
            refIDs: [], ial: {}, icon: '', attrViews: [],
          },
        }), { status: 200 })
      }
      if (u.endsWith('/api/attr/getBlockAttrs')) {
        return new Response(JSON.stringify({ code: 0, msg: '', data: { updated: '20260807120000' } }), { status: 200 })
      }
      if (u.endsWith('/api/search/fullTextSearchBlock')) {
        return new Response(JSON.stringify(KERNEL_SEARCH_RESPONSE), { status: 200 })
      }
      throw new Error(`unmocked kernel endpoint: ${u}`)
    }) as unknown as typeof fetch

    try {
      const { invoke } = createHarness()
      const result = await invoke(RPC_CHANNELS.knowledge.GET_EXPORT_PAYLOAD, {
        connectionId: 'conn-1',
        ref: DOC_REF,
        formats: ['markdown', 'hPath', 'id', 'deepLink'],
      }) as {
        id: string
        deepLink?: string
        markdown?: string
        hPath?: string
        title?: string
      }
      expect(result.id).toBe('doc-1')
      expect(result.deepLink).toBe('siyuan://blocks/doc-1')
      expect(result.markdown).toBe('# Kernel Guide\n\nbody')
      expect(result.hPath).toBe('/Research/Kernel Guide')
      expect(result.title).toBe('Kernel Guide')
    } finally {
      globalThis.fetch = prevFetch
      installFetchSeam()
    }
  })

  it('for __full__ surface skips content formats and still returns deepLink + id', async () => {
    seedConnection('conn-1', { status: 'ok' })
    credentials.set('source_bearer::ws1::conn-1', { value: 'tok' })
    const { invoke } = createHarness()
    const result = await invoke(RPC_CHANNELS.knowledge.GET_EXPORT_PAYLOAD, {
      connectionId: 'conn-1',
      ref: { scheme: 'siyuan', kind: 'notebook', id: '__full__' },
      formats: ['markdown', 'hPath', 'deepLink', 'id'],
    }) as { id: string; deepLink?: string; markdown?: string; hPath?: string }
    expect(result).toEqual({
      id: '__full__',
      deepLink: 'siyuan://notebook/__full__',
    })
    expect(result.markdown).toBeUndefined()
    expect(result.hPath).toBeUndefined()
  })

  it('returns blockKramdown for block refs', async () => {
    seedConnection('conn-1', { status: 'ok' })
    credentials.set('source_bearer::ws1::conn-1', { value: 'tok' })
    const prevFetch = globalThis.fetch
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      const u = String(url)
      fetchCalls.push({ url: u, init: init as RequestInit })
      if (u.endsWith('/api/block/checkBlockExist')) {
        return new Response(JSON.stringify({ code: 0, msg: '', data: true }), { status: 200 })
      }
      if (u.endsWith('/api/block/getBlockKramdown')) {
        return new Response(JSON.stringify({ code: 0, msg: '', data: { id: 'blk-9', kramdown: 'block **md**' } }), { status: 200 })
      }
      if (u.endsWith('/api/block/getBlockInfo')) {
        return new Response(JSON.stringify({
          code: 0, msg: '', data: {
            box: 'nb-1', path: '/x.sy', rootID: 'doc-1', rootTitle: 'Doc',
            rootTitleEmpty: false, rootChildID: 'c', rootIcon: '',
          },
        }), { status: 200 })
      }
      if (u.endsWith('/api/attr/getBlockAttrs')) {
        return new Response(JSON.stringify({ code: 0, msg: '', data: { updated: '20260807120000' } }), { status: 200 })
      }
      if (u.endsWith('/api/filetree/getHPathByID')) {
        return new Response(JSON.stringify({ code: 0, msg: '', data: '/Research/Doc' }), { status: 200 })
      }
      throw new Error(`unmocked kernel endpoint: ${u}`)
    }) as unknown as typeof fetch

    try {
      const { invoke } = createHarness()
      const result = await invoke(RPC_CHANNELS.knowledge.GET_EXPORT_PAYLOAD, {
        connectionId: 'conn-1',
        ref: { scheme: 'siyuan', kind: 'block', id: 'blk-9' },
        formats: ['blockKramdown', 'markdown', 'hPath', 'deepLink'],
      }) as {
        deepLink?: string
        markdown?: string
        blockKramdown?: string
        hPath?: string
      }
      expect(result.deepLink).toBe('siyuan://blocks/blk-9')
      expect(result.markdown).toBe('block **md**')
      expect(result.blockKramdown).toBe('block **md**')
      expect(result.hPath).toBe('/Research/Doc')
    } finally {
      globalThis.fetch = prevFetch
      installFetchSeam()
    }
  })
})
