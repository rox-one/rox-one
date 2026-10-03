import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ensureBuiltinSources } from '../builtin-sources.ts'
import { loadWorkspaceSources } from '../storage.ts'
import { SourceCredentialManager } from '../credential-manager.ts'
import { SourceServerBuilder } from '../server-builder.ts'
import { ApiSourcePoolClient } from '../../mcp/api-source-pool-client.ts'
import * as credentialsModule from '../../credentials/index.ts'

const ENV_NAMES = ['EXA_API_KEY', 'FIRECRAWL_API_KEY', 'BRAVE_API_KEY', 'E2B_API_KEY', 'ROX_SERVICE_SECRETS_FILE', 'CRAFT_EXA_API_KEY', 'ROX_EXA_API_KEY', 'CRAFT_FIRECRAWL_API_KEY', 'ROX_FIRECRAWL_API_KEY', 'ROX_BRAVE_API_KEY', 'ROX_E2B_API_KEY']

describe('default provider tools through the runtime MCP proxy', () => {
  let dir: string
  let previous: Record<string, string | undefined>
  let vaultSpy: ReturnType<typeof spyOn> | undefined
  let fetchSpy: ReturnType<typeof spyOn> | undefined
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rox-default-provider-runtime-'))
    previous = Object.fromEntries(ENV_NAMES.map((name) => [name, process.env[name]]))
    for (const name of ENV_NAMES) delete process.env[name]
    process.env.ROX_SERVICE_SECRETS_FILE = join(dir, 'absent.env')
  })
  afterEach(() => {
    vaultSpy?.mockRestore(); fetchSpy?.mockRestore()
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
    rmSync(dir, { recursive: true, force: true })
  })
  it('publishes all four tools for an existing unauthenticated workspace and resolves keys only on the backend', async () => {
    ensureBuiltinSources(dir)
    const sources = loadWorkspaceSources(dir)
    expect(sources.every((source) => source.config.isAuthenticated === false)).toBe(true)
    process.env.EXA_API_KEY = 'fixture-exa'
    process.env.FIRECRAWL_API_KEY = 'fixture-firecrawl'
    process.env.BRAVE_API_KEY = 'fixture-brave'
    process.env.E2B_API_KEY = 'fixture-e2b'
    vaultSpy = spyOn(credentialsModule, 'getCredentialManager').mockReturnValue({ get: async () => null } as unknown as ReturnType<typeof credentialsModule.getCredentialManager>)
    const requests: { url: string; headers: Headers; redirect: RequestInit['redirect'] }[] = []
    fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async (url: Parameters<typeof fetch>[0], options?: RequestInit) => {
      requests.push({ url: String(url), headers: new Headers(options?.headers), redirect: options?.redirect })
      return Response.json({ result: 'fixture-provider-result' })
    }) as typeof fetch)
    const manager = new SourceCredentialManager()
    const builder = new SourceServerBuilder()
    const built = await builder.buildAll(
      sources.map((source) => ({ source, credential: null })), undefined, undefined, undefined,
      (source) => () => manager.getApiCredential(source),
    )
    expect(built.errors).toEqual([])
    expect(Object.keys(built.apiServers).sort()).toEqual(['brave', 'e2b', 'exa', 'firecrawl'])
    for (const source of sources) {
      const client = new ApiSourcePoolClient(built.apiServers[source.config.slug]!.instance)
      try {
        const tools = await client.listTools()
        expect(tools.map((tool) => tool.name)).toContain(`api_${source.config.slug}`)
        const result = await client.callTool(`api_${source.config.slug}`, { path: source.config.slug === 'e2b' ? '/v2/sandboxes' : '/search', method: 'GET' })
        expect(JSON.stringify(result)).toContain('fixture-provider-result')
        expect(JSON.stringify(result)).not.toContain(`fixture-${source.config.slug}`)
      } finally { await client.close() }
    }
    expect(requests.every((request) => request.redirect === 'error')).toBe(true)
    expect(requests.find((request) => request.url.startsWith('https://api.exa.ai'))?.headers.get('x-api-key')).toBe('fixture-exa')
    expect(requests.find((request) => request.url.startsWith('https://api.firecrawl.dev'))?.headers.get('Authorization')).toBe('Bearer fixture-firecrawl')
    expect(requests.find((request) => request.url.startsWith('https://api.search.brave.com'))?.headers.get('X-Subscription-Token')).toBe('fixture-brave')
    expect(requests.find((request) => request.url.startsWith('https://api.e2b.dev'))?.headers.get('X-API-Key')).toBe('fixture-e2b')
    expect(JSON.stringify(sources)).not.toContain('fixture-')
    process.env.EXA_API_KEY = 'rotated-fixture-exa'
    expect(await manager.getApiCredential(sources.find((source) => source.config.slug === 'exa')!)).toBe('rotated-fixture-exa')
  })

  it('preserves a user-owned provider key and falls back when its vault slot is empty', async () => {
    process.env.EXA_API_KEY = 'fixture-shared'
    ensureBuiltinSources(dir)
    const source = loadWorkspaceSources(dir).find((source) => source.config.slug === 'exa')!
    let value = 'fixture-user-owned'
    vaultSpy = spyOn(credentialsModule, 'getCredentialManager').mockReturnValue({ get: async () => ({ value }) } as unknown as ReturnType<typeof credentialsModule.getCredentialManager>)
    const manager = new SourceCredentialManager()
    expect(await manager.getApiCredential(source)).toBe('fixture-user-owned')
    value = ''
    expect(await manager.getApiCredential(source)).toBe('fixture-shared')
  })
})
