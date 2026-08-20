import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { getFabricRuntime, resetFabricRuntime } from '../fabric-runtime'
import { HANDLED_CHANNELS, registerFabricHandlers } from '../fabric'

type Handler = (ctx: unknown, ...args: unknown[]) => unknown | Promise<unknown>

function createMockServer() {
  const handlers = new Map<string, Handler>()
  const pushes: Array<{ channel: string; target: unknown; args: unknown[] }> = []
  return {
    handlers,
    pushes,
    handle(channel: string, fn: Handler) {
      handlers.set(channel, fn)
    },
    push(channel: string, target: unknown, ...args: unknown[]) {
      pushes.push({ channel, target, args })
    },
  }
}

function register() {
  const server = createMockServer()
  registerFabricHandlers(server as never, {
    platform: { logger: { info() {}, error() {}, warn() {}, debug() {} } },
  } as never)
  return server
}

describe('fabric RPC handlers', () => {
  let dir: string
  let prevConfig: string | undefined
  let prevGh: string | undefined
  let prevGithub: string | undefined
  let prevInfisicalToken: string | undefined
  let prevInfisicalProject: string | undefined
  let prevInfisicalEnv: string | undefined
  let prevInfisicalPath: string | undefined
  let prevInfisicalKey: string | undefined

  beforeEach(() => {
    resetFabricRuntime()
    dir = mkdtempSync(join(tmpdir(), 'craft-fabric-rpc-'))
    prevConfig = process.env.CRAFT_CONFIG_DIR
    process.env.CRAFT_CONFIG_DIR = dir

    prevGh = process.env.GH_TOKEN
    prevGithub = process.env.GITHUB_TOKEN
    prevInfisicalToken = process.env.INFISICAL_TOKEN
    prevInfisicalProject = process.env.INFISICAL_PROJECT_ID
    prevInfisicalEnv = process.env.INFISICAL_ENVIRONMENT
    prevInfisicalPath = process.env.INFISICAL_SECRET_PATH
    prevInfisicalKey = process.env.INFISICAL_SECRET_KEY

    delete process.env.GH_TOKEN
    delete process.env.GITHUB_TOKEN
    delete process.env.INFISICAL_TOKEN
    delete process.env.INFISICAL_PROJECT_ID
    delete process.env.INFISICAL_ENVIRONMENT
    delete process.env.INFISICAL_SECRET_PATH
    delete process.env.INFISICAL_SECRET_KEY
  })

  afterEach(() => {
    resetFabricRuntime()
    if (prevConfig === undefined) delete process.env.CRAFT_CONFIG_DIR
    else process.env.CRAFT_CONFIG_DIR = prevConfig

    const restore = (key: string, value: string | undefined) => {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    restore('GH_TOKEN', prevGh)
    restore('GITHUB_TOKEN', prevGithub)
    restore('INFISICAL_TOKEN', prevInfisicalToken)
    restore('INFISICAL_PROJECT_ID', prevInfisicalProject)
    restore('INFISICAL_ENVIRONMENT', prevInfisicalEnv)
    restore('INFISICAL_SECRET_PATH', prevInfisicalPath)
    restore('INFISICAL_SECRET_KEY', prevInfisicalKey)

    rmSync(dir, { recursive: true, force: true })
  })

  it('registers every HANDLED_CHANNELS entry', () => {
    const server = register()
    expect(HANDLED_CHANNELS).toEqual([
      RPC_CHANNELS.fabric.LIST_CONNECTIONS,
      RPC_CHANNELS.fabric.CREATE_CONNECTION,
      RPC_CHANNELS.fabric.LIST_CREDENTIALS,
      RPC_CHANNELS.fabric.LIST_AUDIT,
      RPC_CHANNELS.fabric.DISCOVER,
      RPC_CHANNELS.fabric.PREVIEW,
      RPC_CHANNELS.fabric.COMMIT_IMPORT,
      RPC_CHANNELS.fabric.LIST_GRANTS,
      RPC_CHANNELS.fabric.PUT_GRANT,
      RPC_CHANNELS.fabric.ACQUIRE_LEASE,
      RPC_CHANNELS.fabric.REVOKE_CONNECTION,
      RPC_CHANNELS.fabric.GITHUB_STATUS,
      RPC_CHANNELS.fabric.INFISICAL_HEALTH,
    ])
    for (const ch of HANDLED_CHANNELS) {
      expect(server.handlers.has(ch)).toBe(true)
    }
  })

  it('listConnections accepts positional workspaceId', async () => {
    const server = register()
    const list = server.handlers.get(RPC_CHANNELS.fabric.LIST_CONNECTIONS)!
    const rows = (await list({}, 'ws-positional')) as unknown[]
    expect(Array.isArray(rows)).toBe(true)
    expect(rows).toEqual([])
  })

  it('discover dotenv positional (workspaceId, importerId) does not throw on args shape', async () => {
    const server = register()
    const discover = server.handlers.get(RPC_CHANNELS.fabric.DISCOVER)!
    const candidates = (await discover({}, 'local', 'dotenv')) as unknown[]
    expect(Array.isArray(candidates)).toBe(true)
  })

  it('discover infisical returns metadata-only env locator candidates', async () => {
    process.env.INFISICAL_PROJECT_ID = 'proj_test'
    process.env.INFISICAL_ENVIRONMENT = 'prod'
    process.env.INFISICAL_SECRET_PATH = '/agents'
    process.env.INFISICAL_SECRET_KEY = 'GH_TOKEN'
    process.env.INFISICAL_TOKEN = 'infisical_should_never_leak'

    const server = register()
    const discover = server.handlers.get(RPC_CHANNELS.fabric.DISCOVER)!
    const candidates = (await discover({}, 'local', 'infisical')) as Array<Record<string, unknown>>
    expect(candidates.length).toBe(1)
    expect(candidates[0]?.sourceId).toBe('infisical')
    expect(candidates[0]?.locator).toEqual({
      type: 'infisical',
      projectId: 'proj_test',
      environment: 'prod',
      secretPath: '/agents',
      secretKey: 'GH_TOKEN',
    })
    const serialized = JSON.stringify(candidates)
    expect(serialized).not.toContain('infisical_should_never_leak')
    expect(serialized).not.toContain('INFISICAL_TOKEN')
  })

  it('putGrant(workspaceId, grant) works after provider write + registry', async () => {
    const server = register()
    const runtime = getFabricRuntime()
    const locator = { type: 'dotenv' as const, path: '/tmp/.env', key: 'TEST_KEY' }
    const version = await runtime.provider.write({
      kind: 'api_key',
      mode: 'reference',
      locator,
      workspaceId: 'local',
      requestedBy: 'test',
    })
    runtime.registry.register({
      id: version.credentialRefId,
      kind: 'api_key',
      providerId: runtime.provider.id,
      locator,
    })

    const putGrant = server.handlers.get(RPC_CHANNELS.fabric.PUT_GRANT)!
    const grant = (await putGrant({}, 'local', {
      consumerId: 'agent_1',
      action: 'read',
      resource: 'repo:demo',
    })) as { consumerId: string; actions: string[]; resources: string[] }

    expect(grant.consumerId).toBe('agent_1')
    expect(grant.actions).toContain('read')
    expect(grant.resources).toContain('repo:demo')
  })

  it('githubStatus without token => available false / not-configured', async () => {
    const server = register()
    const status = server.handlers.get(RPC_CHANNELS.fabric.GITHUB_STATUS)!
    const result = (await status({})) as { available: boolean; reason?: string }
    expect(result).toEqual({ available: false, reason: 'not-configured' })
  })

  it('githubStatus with token and no probe reports env availability only', async () => {
    process.env.GH_TOKEN = 'ghp_testFabricStatusToken_doNotLeak'
    const server = register()
    const status = server.handlers.get(RPC_CHANNELS.fabric.GITHUB_STATUS)!
    const result = (await status({})) as { available: boolean; reason?: string; login?: string }
    expect(result).toEqual({ available: true, reason: 'env' })
    expect(result.login).toBeUndefined()
  })

  it('githubStatus probe with fake token + mocked fetch returns metadata only', async () => {
    const token = 'ghp_testFabricStatusToken_doNotLeak'
    process.env.GH_TOKEN = token

    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ login: 'rox-bot', id: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch

    try {
      const server = register()
      const status = server.handlers.get(RPC_CHANNELS.fabric.GITHUB_STATUS)!
      const result = (await status({}, { probe: true })) as {
        available: boolean
        login?: string
        connectionId?: string
        leaseId?: string
        credentialRefId?: string
        reason?: string
      }

      expect(result.available).toBe(true)
      expect(result.login).toBe('rox-bot')
      expect(result.connectionId).toMatch(/^conn_/)
      expect(result.leaseId).toMatch(/^lease_/)
      expect(result.credentialRefId).toMatch(/^cred_/)

      const serialized = JSON.stringify(result)
      expect(serialized).not.toContain(token)
      expect(serialized).not.toMatch(/ghp_/)
      expect('token' in result).toBe(false)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('githubStatus probe strips token from failure reason', async () => {
    const token = 'ghp_testFabricFailToken_doNotLeak'
    process.env.GH_TOKEN = token

    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => {
      throw new Error(`upstream failed for ${token}`)
    }) as typeof fetch

    try {
      const server = register()
      const status = server.handlers.get(RPC_CHANNELS.fabric.GITHUB_STATUS)!
      const result = (await status({}, { probe: true })) as { available: boolean; reason?: string }
      expect(result.available).toBe(false)
      expect(result.reason).toBeTruthy()
      expect(result.reason).not.toContain(token)
      expect(JSON.stringify(result)).not.toMatch(/ghp_/)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('infisicalHealth does not include INFISICAL_TOKEN in result', async () => {
    process.env.INFISICAL_TOKEN = 'infisical_secret_token_value'
    process.env.INFISICAL_PROJECT_ID = 'proj_health'
    const server = register()
    const health = server.handlers.get(RPC_CHANNELS.fabric.INFISICAL_HEALTH)!
    const result = (await health({})) as Record<string, unknown>
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('infisical_secret_token_value')
    expect(serialized).not.toContain('INFISICAL_TOKEN')
    expect(typeof result.available).toBe('boolean')
  })

  it('listAudit returns readable action/decision/consumer fields', async () => {
    const server = register()
    const runtime = getFabricRuntime()
    const locator = { type: 'dotenv' as const, path: '/tmp/.env', key: 'AUDIT_KEY' }
    const version = await runtime.provider.write({
      kind: 'api_key',
      mode: 'reference',
      locator,
      workspaceId: 'local',
      requestedBy: 'test',
    })
    runtime.registry.register({
      id: version.credentialRefId,
      kind: 'api_key',
      providerId: runtime.provider.id,
      locator,
    })
    const connection = await runtime.graph.createConnection({
      workspaceId: 'local',
      integrationId: 'audit-demo',
      credentialRefId: version.credentialRefId,
      storageMode: 'reference',
    })
    await runtime.graph.appendConnectionAudit({
      workspaceId: 'local',
      connectionId: connection.id,
      credentialRefId: version.credentialRefId,
      consumer: 'agent_audit',
      action: 'github.request',
      decision: 'allow',
      target: 'api.github.com/user',
    })

    const listAudit = server.handlers.get(RPC_CHANNELS.fabric.LIST_AUDIT)!
    const rows = (await listAudit({}, 'local')) as Array<{
      action: string
      decision: string
      consumer?: string
      payloadDigest: string
    }>
    expect(rows.length).toBeGreaterThan(0)
    const row = rows[0]!
    expect(row.action).toBe('github.request')
    expect(row.decision).toBe('allow')
    expect(row.consumer).toBe('agent_audit')
    expect(row.payloadDigest).toMatch(/^[0-9a-f]{64}$/)
  })
})
