import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RPC_CHANNELS } from '@rox/shared/protocol'
import { resetFabricRuntime } from '../fabric-runtime'
import { HANDLED_CHANNELS, registerFabricHandlers } from '../fabric'

type Handler = (ctx: unknown, ...args: unknown[]) => unknown | Promise<unknown>

interface RecordedRequest {
  method: string
  url: string
  body: string | null
  authorization: string | null
}

interface FakeResponse {
  status: number
  body?: unknown
}

function createMockServer() {
  const handlers = new Map<string, Handler>()
  return {
    handlers,
    handle(channel: string, fn: Handler) {
      handlers.set(channel, fn)
    },
  }
}

/** Fake HTTP transport: records every request and answers from a router. */
function createFakeFetch(route: (request: RecordedRequest) => FakeResponse) {
  const requests: RecordedRequest[] = []
  const fn = (async (input: string | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    const headers = (init?.headers ?? {}) as Record<string, string>
    const request: RecordedRequest = {
      method: init?.method ?? 'GET',
      url,
      body: typeof init?.body === 'string' ? init.body : null,
      authorization: headers.Authorization ?? headers.authorization ?? null,
    }
    requests.push(request)
    const answer = route(request)
    const text = answer.body === undefined ? '' : typeof answer.body === 'string' ? answer.body : JSON.stringify(answer.body)
    return new Response(text, { status: answer.status, headers: { 'Content-Type': 'application/json' } })
  }) as unknown as typeof fetch
  return { fn, requests }
}

function register(logs?: string[]) {
  const server = createMockServer()
  const record = (...args: unknown[]) => {
    logs?.push(args.map((value) => String(value)).join(' '))
  }
  registerFabricHandlers(server as never, {
    platform: { logger: { info: record, error: record, warn: record, debug: record } },
  } as never)
  return server
}

describe('fabric infisical keeper RPC', () => {
  let dir: string
  let prevConfig: string | undefined
  let prevToken: string | undefined
  let originalFetch: typeof fetch

  beforeEach(() => {
    resetFabricRuntime()
    dir = mkdtempSync(join(tmpdir(), 'craft-fabric-keeper-'))
    prevConfig = process.env.CRAFT_CONFIG_DIR
    prevToken = process.env.INFISICAL_TOKEN
    process.env.CRAFT_CONFIG_DIR = dir
    process.env.INFISICAL_TOKEN = 'infisical_keeper_token_do_not_leak'
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    resetFabricRuntime()
    globalThis.fetch = originalFetch
    if (prevConfig === undefined) delete process.env.CRAFT_CONFIG_DIR
    else process.env.CRAFT_CONFIG_DIR = prevConfig
    if (prevToken === undefined) delete process.env.INFISICAL_TOKEN
    else process.env.INFISICAL_TOKEN = prevToken
    rmSync(dir, { recursive: true, force: true })
  })

  it('registers the keeper channels', () => {
    const server = register()
    for (const channel of [
      RPC_CHANNELS.fabric.INFISICAL_LIST_PATHS,
      RPC_CHANNELS.fabric.INFISICAL_LIST_ITEMS,
      RPC_CHANNELS.fabric.INFISICAL_UPSERT_ITEM,
      RPC_CHANNELS.fabric.INFISICAL_DELETE_ITEM,
    ]) {
      expect(HANDLED_CHANNELS).toContain(channel)
      expect(server.handlers.has(channel)).toBe(true)
    }
  })

  it('listItems parses JSON-object values and marks everything else raw', async () => {
    const fake = createFakeFetch(() => ({
      status: 200,
      body: {
        secrets: [
          { secretKey: 'CFG', secretValue: JSON.stringify({ nested: { ok: true } }), updatedAt: '2026-01-02T03:04:05.000Z' },
          { secretKey: 'OPAQUE', secretValue: 'plain-text', updatedAt: '2026-01-02T03:04:06.000Z' },
          { secretKey: 'ARRAY', secretValue: '[1,2,3]' },
          { secretKey: 'BROKEN', secretValue: '{not json' },
        ],
      },
    }))
    globalThis.fetch = fake.fn

    const server = register()
    const list = server.handlers.get(RPC_CHANNELS.fabric.INFISICAL_LIST_ITEMS)!
    const result = (await list({}, { projectId: 'proj_1', environment: 'dev', secretPath: '/agents' })) as {
      items: Array<{ key: string; valueJson: unknown; raw: boolean; updatedAt: string | null }>
    }

    expect(result.items).toEqual([
      { key: 'CFG', valueJson: { nested: { ok: true } }, raw: false, updatedAt: '2026-01-02T03:04:05.000Z' },
      { key: 'OPAQUE', valueJson: null, raw: true, updatedAt: '2026-01-02T03:04:06.000Z' },
      { key: 'ARRAY', valueJson: null, raw: true, updatedAt: null },
      { key: 'BROKEN', valueJson: null, raw: true, updatedAt: null },
    ])

    const request = fake.requests[0]!
    expect(request.method).toBe('GET')
    expect(request.url).toContain('/api/v3/secrets/raw?')
    expect(request.url).toContain('workspaceId=proj_1')
    expect(request.url).toContain('environment=dev')
    expect(request.url).toContain('secretPath=%2Fagents')
    expect(request.authorization).toContain('Bearer ')
  })

  it('upsertItem sends the stringified payload and rejects invalid input', async () => {
    const fake = createFakeFetch(() => ({ status: 200, body: { secret: { secretKey: 'CFG' } } }))
    globalThis.fetch = fake.fn

    const server = register()
    const upsert = server.handlers.get(RPC_CHANNELS.fabric.INFISICAL_UPSERT_ITEM)!
    const result = await upsert(
      {},
      { projectId: 'proj_1', environment: 'dev', secretPath: '/agents', key: 'CFG', valueJson: { nested: { ok: true } } },
    )
    expect(result).toEqual({ key: 'CFG', created: true })

    expect(fake.requests).toHaveLength(1)
    const request = fake.requests[0]!
    expect(request.method).toBe('POST')
    expect(request.url).toContain('/api/v3/secrets/raw/CFG?')
    expect(JSON.parse(request.body ?? '{}')).toEqual({
      workspaceId: 'proj_1',
      environment: 'dev',
      secretPath: '/agents',
      secretValue: '{"nested":{"ok":true}}',
    })

    await expect(
      upsert({}, { projectId: 'proj_1', environment: 'dev', key: 'bad key!', valueJson: { a: 1 } }),
    ).rejects.toThrow()
    await expect(
      upsert({}, { projectId: 'proj_1', environment: 'dev', key: 'BIG', valueJson: { blob: 'x'.repeat(17 * 1024) } }),
    ).rejects.toThrow()
    await expect(
      upsert({}, { projectId: 'proj_1', environment: 'dev', key: 'NO_VALUE' }),
    ).rejects.toThrow()

    // Validation happens before any transport call.
    expect(fake.requests).toHaveLength(1)
  })

  it('upsertItem patches an existing secret on conflict', async () => {
    const fake = createFakeFetch((request) => ({
      status: request.method === 'POST' ? 409 : 200,
      body: {},
    }))
    globalThis.fetch = fake.fn

    const server = register()
    const upsert = server.handlers.get(RPC_CHANNELS.fabric.INFISICAL_UPSERT_ITEM)!
    const result = await upsert(
      {},
      { projectId: 'proj_1', environment: 'dev', secretPath: '/agents', key: 'CFG', valueJson: { a: 1 } },
    )

    expect(result).toEqual({ key: 'CFG', created: false })
    expect(fake.requests.map((request) => request.method)).toEqual(['POST', 'PATCH'])
    expect(fake.requests[1]!.url).toContain('/api/v3/secrets/raw/CFG?')
  })

  it('deleteItem calls the raw delete endpoint', async () => {
    const fake = createFakeFetch(() => ({ status: 200, body: { secret: {} } }))
    globalThis.fetch = fake.fn

    const server = register()
    const remove = server.handlers.get(RPC_CHANNELS.fabric.INFISICAL_DELETE_ITEM)!
    const result = await remove({}, { projectId: 'proj_1', environment: 'dev', secretPath: '/agents', key: 'CFG' })

    expect(result).toEqual({ key: 'CFG', deleted: true })
    const request = fake.requests[0]!
    expect(request.method).toBe('DELETE')
    expect(request.url).toContain('/api/v3/secrets/raw/CFG?')
    expect(JSON.parse(request.body ?? '{}')).toEqual({
      workspaceId: 'proj_1',
      environment: 'dev',
      secretPath: '/agents',
    })
  })

  it('listPaths derives sorted bounded folder paths from secret paths', async () => {
    const fake = createFakeFetch(() => ({
      status: 200,
      body: {
        secrets: [
          { secretKey: 'A', secretValue: '{}', secretPath: '/agents/sub' },
          { secretKey: 'B', secretValue: '{}', secretPath: '/agents' },
          { secretKey: 'C', secretValue: '{}', secretPath: '/agents' },
          { secretKey: 'D', secretValue: '{}', secretPath: '/' },
        ],
      },
    }))
    globalThis.fetch = fake.fn

    const server = register()
    const paths = server.handlers.get(RPC_CHANNELS.fabric.INFISICAL_LIST_PATHS)!
    const result = await paths({}, { projectId: 'proj_1', environment: 'dev' })

    expect(result).toEqual({ paths: ['/', '/agents', '/agents/sub'] })
    const request = fake.requests[0]!
    expect(request.url).toContain('/api/v3/secrets/raw?')
    expect(request.url).toContain('recursive=true')
  })

  it('never writes secret values to logs', async () => {
    const value = 'keeper-secret-value-marker-9f3d'
    const fake = createFakeFetch((request) => {
      if (request.method === 'GET') {
        return { status: 200, body: { secrets: [{ secretKey: 'CFG', secretValue: JSON.stringify({ token: value }) }] } }
      }
      return { status: 200, body: {} }
    })
    globalThis.fetch = fake.fn

    const logs: string[] = []
    const capture = (...args: unknown[]) => {
      logs.push(args.map((entry) => String(entry)).join(' '))
    }
    const originals = { log: console.log, error: console.error, warn: console.warn, info: console.info, debug: console.debug }
    console.log = capture as never
    console.error = capture as never
    console.warn = capture as never
    console.info = capture as never
    console.debug = capture as never

    try {
      const server = register(logs)
      const list = server.handlers.get(RPC_CHANNELS.fabric.INFISICAL_LIST_ITEMS)!
      const listed = (await list({}, { projectId: 'proj_1', environment: 'dev', secretPath: '/agents' })) as {
        items: Array<{ valueJson: unknown }>
      }
      // The value did flow to the explicit caller...
      expect(JSON.stringify(listed)).toContain(value)

      const upsert = server.handlers.get(RPC_CHANNELS.fabric.INFISICAL_UPSERT_ITEM)!
      await upsert({}, { projectId: 'proj_1', environment: 'dev', key: 'CFG', valueJson: { token: value } })
      // ...and a rejected payload does not echo the value in its error.
      await expect(
        upsert({}, { projectId: 'proj_1', environment: 'dev', key: 'bad key!', valueJson: { token: value } }),
      ).rejects.toThrow()
    } finally {
      console.log = originals.log
      console.error = originals.error
      console.warn = originals.warn
      console.info = originals.info
      console.debug = originals.debug
    }

    expect(logs.join('\n')).not.toContain(value)
  })
})