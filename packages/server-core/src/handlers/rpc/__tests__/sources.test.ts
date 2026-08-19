/**
 * P2-12 regression test — sources:saveCredentials knowledge fallback.
 *
 * When `sourceSlug` matches no regular source but IS a knowledge connection id,
 * the handler stores the bearer token under the CredentialManager key encoded in
 * the record's credentialRef (`source_bearer::{workspaceId}::{connectionId}`),
 * NOT under the active workspace of the invoking call. The read path
 * (handlers/rpc/knowledge.ts readToken) resolves the record's credentialRef
 * verbatim, so a token written under the wrong workspace is unreadable on
 * multi-workspace installs.
 *
 * Harness mirrors knowledge.test.ts / memory-io.test.ts: the workspace registry
 * and CredentialManager are module seams (bun's mock.module registry is
 * process-global in combined runs — using the real modules would receive THIS
 * directory's other suite's fixtures instead). The connections store runs real
 * against the sandboxed CRAFT_CONFIG_DIR (env-lazy store paths).
 */
import '../memory-test-setup' // must run before any module reading CRAFT_CONFIG_DIR
import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { CredentialId } from '@craft-agent/shared/credentials'
import type { HandlerFn, RequestContext, RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../../handler-deps'
import { KnowledgeConnectionsStore } from '../../../knowledge'
import { registerSourcesHandlers } from '../sources'
import {
  loadSource,
  saveSourceConfig,
  getSourceServerBuilder,
  type FolderSourceConfig,
} from '@craft-agent/shared/sources'
import { resolveStdioConfig } from '@craft-agent/shared/utils'

// Real log-scrub helper, imported by relative path so the barrel mock below
// doesn't shadow it — the handler must log THIS function's output.
import { formatMcpUrlForLog } from '../../../../../shared/src/mcp/client.ts'

// Captured constructor configs of CraftMcpClient (module seam below) — lets
// the GET_MCP_TOOLS tests assert exactly which client config the handler built
// without spawning real MCP servers.
const mcpClientConfigs: unknown[] = []

mock.module('@craft-agent/shared/mcp', () => ({
  CraftMcpClient: class MockCraftMcpClient {
    constructor(config: unknown) {
      mcpClientConfigs.push(config)
    }
    async listTools() {
      return []
    }
    async close() {}
  },
  formatMcpUrlForLog,
}))

// Credential id string ↔ in-memory store key (`type::workspaceId::sourceId`).
const credentials = new Map<string, { value: string }>()

mock.module('@craft-agent/shared/credentials', () => ({
  getCredentialManager: () => ({
    async get(id: CredentialId) {
      return credentials.get(`${id.type}::${id.workspaceId}::${id.sourceId}`) ?? null
    },
    async set(id: CredentialId, credential: { value: string }) {
      credentials.set(`${id.type}::${id.workspaceId}::${id.sourceId}`, credential)
    },
    async delete(id: CredentialId) {
      return credentials.delete(`${id.type}::${id.workspaceId}::${id.sourceId}`)
    },
  }),
}))

const mockWorkspaces = [
  { id: 'ws-owner', name: 'ws-owner', rootPath: '' },
  { id: 'ws-active', name: 'ws-active', rootPath: '' },
]

mock.module('@craft-agent/shared/config', () => ({
  getWorkspaceByNameOrId: (nameOrId: string) =>
    mockWorkspaces.find((w) => w.id === nameOrId || w.name === nameOrId) ?? null,
  getWorkspaces: () => [...mockWorkspaces],
}))

function createHarness(infoLog?: string[]) {
  const handlers = new Map<string, HandlerFn>()
  const server: RpcServer = {
    handle(channel, handler) { handlers.set(channel, handler) },
    push() {},
    async invokeClient() { return undefined },
    hasClientCapability() { return false },
    findClientsWithCapability() { return [] },
  }
  const deps: HandlerDeps = {
    sessionManager: {} as HandlerDeps['sessionManager'],
    oauthFlowStore: {} as HandlerDeps['oauthFlowStore'],
    platform: {
      appRootPath: '/',
      resourcesPath: '/',
      isPackaged: false,
      appVersion: '0.0.0-test',
      isDebugMode: true,
      logger: {
        info: (msg: unknown) => { infoLog?.push(String(msg)) },
        warn: () => {},
        error: () => {},
        debug: () => {},
      },
      imageProcessor: { getMetadata: async () => null, process: async () => Buffer.from('') },
    },
  }
  registerSourcesHandlers(server, deps)
  const invoke = (channel: string, ...args: unknown[]) => {
    const handler = handlers.get(channel)
    if (!handler) throw new Error(`No handler for ${channel}`)
    return handler({ clientId: 'c1', workspaceId: null } as unknown as RequestContext, ...args)
  }
  return { handlers, invoke }
}

beforeEach(() => {
  rmSync(join(process.env.CRAFT_CONFIG_DIR!, 'knowledge'), { recursive: true, force: true })
  credentials.clear()
  mockWorkspaces[0]!.rootPath = mkdtempSync(join(tmpdir(), 'sources-ws-owner-'))
  mockWorkspaces[1]!.rootPath = mkdtempSync(join(tmpdir(), 'sources-ws-active-'))
})

describe('sources:saveCredentials — knowledge-connection fallback (P2-12)', () => {
  it('stores the bearer token under the workspace encoded in the record credentialRef, not the active workspace', async () => {
    // Connection was registered while ws-owner was the active workspace;
    // the caller now invokes the save plumbing from ws-active.
    new KnowledgeConnectionsStore().save({
      id: 'conn-1',
      baseUrl: 'http://127.0.0.1:6806',
      credentialRef: 'source_bearer::ws-owner::conn-1',
    })
    const { invoke } = createHarness()

    await invoke(RPC_CHANNELS.sources.SAVE_CREDENTIALS, 'ws-active', 'conn-1', 'token-under-record-workspace')

    // The read path key (credentialIdFromRef in readToken) must resolve.
    expect(credentials.get('source_bearer::ws-owner::conn-1')?.value).toBe('token-under-record-workspace')
    // The active-workspace key stays empty — writing there was the unreadable-token bug.
    expect(credentials.get('source_bearer::ws-active::conn-1')).toBeUndefined()
  })

  it('still falls back to the arg workspaceId when the credentialRef is legacy/unparseable', async () => {
    // Legacy single-workspace record without an encoded workspace (ref not in
    // source_bearer::<workspaceId>::<connectionId> shape): the call-scope
    // workspaceId is the only workspace hint available.
    new KnowledgeConnectionsStore().save({
      id: 'conn-legacy',
      baseUrl: 'http://127.0.0.1:6806',
      credentialRef: 'conn-legacy',
    })
    const { invoke } = createHarness()

    await invoke(RPC_CHANNELS.sources.SAVE_CREDENTIALS, 'ws-active', 'conn-legacy', 'legacy-token')

    expect(credentials.get('source_bearer::ws-active::conn-legacy')?.value).toBe('legacy-token')
  })

  it('rejects a slug that is neither a source nor a knowledge connection — mistyped slugs fail loudly', async () => {
    const { invoke } = createHarness()
    await expect(
      invoke(RPC_CHANNELS.sources.SAVE_CREDENTIALS, 'ws-active', 'not-a-thing', 'tok'),
    ).rejects.toThrow('Source not found: not-a-thing')
  })
})

describe('sources:getMcpTools — stdio config normalization', () => {
  // Regression: the discovery path used to pass the raw source config to
  // CraftMcpClient, skipping resolveStdioConfig — so ${WORKSPACE}/${SOURCE_DIR}
  // expansion and platform.{win32,darwin,linux} overrides applied on the real
  // session path (server-builder buildMcpServer) were silently dropped here.

  const SLUG = 'stdio-vars'

  function writeStdioSource(rootPath: string): FolderSourceConfig {
    const config: FolderSourceConfig = {
      id: 'src-stdio-vars',
      name: 'Stdio Vars',
      slug: SLUG,
      enabled: true,
      provider: 'test',
      type: 'mcp',
      connectionStatus: 'connected',
      mcp: {
        transport: 'stdio',
        command: '${SOURCE_DIR}/bin/default-server',
        args: ['--root', '${WORKSPACE}', '--src', '${SOURCE_DIR}'],
        env: { DATA_DIR: '${WORKSPACE}/data', STATIC: 'keepme' },
        platform: {
          // Keyed by the test runner's platform so the override always applies.
          [process.platform]: {
            command: '${SOURCE_DIR}/bin/platform-server',
            env: { PLATFORM_OVERRIDE: 'yes' },
          },
        },
      },
    }
    saveSourceConfig(rootPath, config)
    return config
  }

  beforeEach(() => {
    mcpClientConfigs.length = 0
  })

  it('passes the resolved stdio config (variables + platform overrides) to CraftMcpClient', async () => {
    const rootPath = mockWorkspaces[1]!.rootPath // ws-active
    writeStdioSource(rootPath)
    const { invoke } = createHarness()

    const result = (await invoke(RPC_CHANNELS.sources.GET_MCP_TOOLS, 'ws-active', SLUG)) as {
      success: boolean
      error?: string
    }

    expect(result.success).toBe(true)
    expect(mcpClientConfigs).toHaveLength(1)

    const expected = resolveStdioConfig(
      {
        command: '${SOURCE_DIR}/bin/default-server',
        args: ['--root', '${WORKSPACE}', '--src', '${SOURCE_DIR}'],
        env: { DATA_DIR: '${WORKSPACE}/data', STATIC: 'keepme' },
        platform: {
          [process.platform]: {
            command: '${SOURCE_DIR}/bin/platform-server',
            env: { PLATFORM_OVERRIDE: 'yes' },
          },
        },
      },
      rootPath,
      join(rootPath, 'sources', SLUG),
    )!

    if (!expected.env) throw new Error('test setup: expected resolved env to be defined')
    const expectedEnv: Record<string, string> = expected.env

    const captured = mcpClientConfigs[0] as {
      transport: string
      command: string
      args: string[]
      env: Record<string, string>
    }
    expect(captured.transport).toBe('stdio')
    expect(captured.command).toBe(expected.command)
    expect(captured.args).toEqual(expected.args)
    expect(captured.env).toEqual(expectedEnv)
    // No unexpanded variables may survive into the client config.
    expect(captured.command).not.toContain('${')
    expect(captured.args.join(' ')).not.toContain('${')
  })

  it('matches the config the real session path builds (buildMcpServer parity)', async () => {
    const rootPath = mockWorkspaces[1]!.rootPath
    writeStdioSource(rootPath)
    const { invoke } = createHarness()

    const result = (await invoke(RPC_CHANNELS.sources.GET_MCP_TOOLS, 'ws-active', SLUG)) as {
      success: boolean
    }
    expect(result.success).toBe(true)

    const loaded = loadSource(rootPath, SLUG)!
    const built = getSourceServerBuilder().buildMcpServer(loaded, null)
    expect(built).not.toBeNull()
    if (built?.type !== 'stdio') throw new Error('expected stdio server config')

    const captured = mcpClientConfigs[0] as {
      command: string
      args: string[]
      env: Record<string, string> | undefined
    }
    expect({ command: captured.command, args: captured.args, env: captured.env }).toEqual({
      command: built.command,
      args: built.args ?? [],
      env: built.env,
    })
  })

  it('returns the typed missing-command error when stdio config has no command', async () => {
    const rootPath = mockWorkspaces[1]!.rootPath
    // saveSourceConfig's zod schema refuses command-less stdio configs, so
    // write config.json directly — this simulates a hand-edited file.
    const { mkdirSync, writeFileSync } = await import('fs')
    const dir = join(rootPath, 'sources', 'no-cmd')
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'config.json'),
      JSON.stringify({
        id: 'src-no-cmd',
        name: 'No Command',
        slug: 'no-cmd',
        enabled: true,
        provider: 'test',
        type: 'mcp',
        connectionStatus: 'connected',
        mcp: { transport: 'stdio' },
      }),
    )
    const { invoke } = createHarness()

    const result = (await invoke(RPC_CHANNELS.sources.GET_MCP_TOOLS, 'ws-active', 'no-cmd')) as {
      success: boolean
      error?: string
    }
    expect(result.success).toBe(false)
    expect(result.error).toContain('command')
    expect(mcpClientConfigs).toHaveLength(0)
  })
})

describe('sources:getMcpTools — MCP URL log scrubbing', () => {
  it('logs only origin + pathname for a credentialed URL (no userinfo, no query)', async () => {
    const rootPath = mockWorkspaces[1]!.rootPath
    // Credentialed URLs are rejected by saveSourceConfig validation, so write
    // config.json directly — simulates a hand-edited or legacy file.
    const { mkdirSync, writeFileSync } = await import('fs')
    const dir = join(rootPath, 'sources', 'cred-url')
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'config.json'),
      JSON.stringify({
        id: 'src-cred-url',
        name: 'Credentialed URL',
        slug: 'cred-url',
        enabled: true,
        provider: 'test',
        type: 'mcp',
        connectionStatus: 'connected',
        mcp: {
          transport: 'http',
          url: 'http://user:pass@example.com:8080/mcp?apikey=secret123',
          authType: 'none',
        },
      }),
    )
    const infoLog: string[] = []
    const { invoke } = createHarness(infoLog)

    const result = (await invoke(RPC_CHANNELS.sources.GET_MCP_TOOLS, 'ws-active', 'cred-url')) as {
      success: boolean
      error?: string
    }
    expect(result.success).toBe(true)

    const fetchLines = infoLog.filter((l) => l.includes('Fetching MCP tools from'))
    expect(fetchLines).toHaveLength(1)
    expect(fetchLines[0]).toContain('http://example.com:8080/mcp')
    const allLogs = infoLog.join('\n')
    expect(allLogs).not.toContain('user:pass')
    expect(allLogs).not.toContain('apikey')
    expect(allLogs).not.toContain('secret123')
  })
})
