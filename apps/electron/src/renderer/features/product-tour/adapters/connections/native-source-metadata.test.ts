import { afterEach, expect, test } from 'bun:test'
import { lstatSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runNativeBrowserProcess } from '../work/meetings-automations/native-browser-process'

// The real server producer imports configuration modules. Keep its cache and
// temporary config separate from renderer suites that replace those modules.
if (process.env.ROX_PRODUCT_TOUR_NATIVE_SOURCE_METADATA !== '1') {
  test('native source metadata preserves readiness policy without exposing connection configuration', async () => {
    const configRoot = mkdtempSync(join(tmpdir(), 'tour-native-source-config-'))
    try {
      await runNativeBrowserProcess([process.execPath, 'test', fileURLToPath(import.meta.url)], {
        label: 'native source metadata → readiness', deadlineMs: 10_000,
        env: { ...process.env, ROX_CONFIG_DIR: configRoot, CRAFT_CONFIG_DIR: configRoot, ROX_PRODUCT_TOUR_NATIVE_SOURCE_METADATA: '1' },
      })
    } finally { rmSync(configRoot, { recursive: true, force: true }) }
  }, 15_000)
} else {
  const { readNativeSourceMetadata } = await import('../../../../../../../../packages/server-core/src/handlers/rpc/native-source-metadata')
  const { connectionCapabilities, sourceReadiness } = await import('./index')
  const roots: string[] = []
  afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

  function workspace(configs: Record<string, unknown>[]) {
    const root = mkdtempSync(join(tmpdir(), 'tour-native-source-workspace-'))
    roots.push(root)
    for (const config of configs) {
      const folder = join(root, 'sources', String(config.slug))
      mkdirSync(folder, { recursive: true })
      writeFileSync(join(folder, 'config.json'), JSON.stringify(config))
      writeFileSync(join(folder, 'guide.md'), 'PRIVATE FIXTURE GUIDE')
    }
    return { root, read: () => readNativeSourceMetadata('fixture-workspace', root) }
  }
  const config = (slug: string, patch: Record<string, unknown> = {}) => ({
    id: slug, slug, name: 'Public fixture source', type: 'mcp', provider: 'fixture', enabled: true,
    connectionStatus: 'connected', isAuthenticated: true, ...patch,
  })
  function files(root: string): unknown {
    const stat = lstatSync(root)
    return [stat.mtimeMs, stat.isDirectory()
      ? readdirSync(root).sort().map(name => [name, files(join(root, name))])
      : readFileSync(root, 'utf8')]
  }

  test('actual projected stdio respects disabled and unknown local-MCP policy despite a saved connected status', () => {
    const { read } = workspace([
      config('fixture-stdio', { mcp: { transport: 'stdio', command: 'private-command' } }),
      config('fixture-http', { mcp: { transport: 'http', url: 'https://private.invalid' } }),
    ])
    const sources = read()
    const stdio = sources.find(source => source.config.slug === 'fixture-stdio')!
    expect(sourceReadiness(stdio, false)).toEqual({ state: 'unavailable', reason: 'not-connected' })
    expect(sourceReadiness(stdio, null)).toEqual({ state: 'pending', reason: 'api-unavailable' })
    expect(sourceReadiness(stdio, true)).toEqual({ state: 'ready' })
    for (const [policy, expected] of [[false, 'unavailable'], [null, 'pending'], [true, 'ready']] as const) {
      expect(connectionCapabilities({ sources, workspaceId: 'fixture-workspace', selectedSlugs: ['fixture-stdio'], localMcpEnabled: policy })['sources.ready']?.state).toBe(expected)
    }
    const remote = sources.find(source => source.config.slug === 'fixture-http')!
    expect(sourceReadiness(remote, false)).toEqual({ state: 'ready' })
    expect(sourceReadiness(remote, null)).toEqual({ state: 'ready' })
  })

  test('each recognized transport projects only its discriminator and keeps private configuration and files out of the payload', () => {
    const { root, read } = workspace(['stdio', 'http', 'sse'].map(transport => config(`fixture-${transport}`, {
      icon: '/PRIVATE FIXTURE ICON', privateField: 'PRIVATE FIXTURE EXTRA',
      mcp: {
        transport, command: 'PRIVATE FIXTURE COMMAND', args: ['PRIVATE FIXTURE ARGUMENT'],
        env: { TOKEN: 'PRIVATE FIXTURE ENV' }, cwd: '/PRIVATE FIXTURE CWD',
        url: 'https://private.invalid/PRIVATE FIXTURE URL', authType: 'bearer', clientId: 'PRIVATE FIXTURE CLIENT',
        headers: { Authorization: 'PRIVATE FIXTURE HEADER' }, headerNames: ['PRIVATE FIXTURE HEADER NAME'],
        platform: { linux: { command: 'PRIVATE FIXTURE PLATFORM' } },
      },
      api: { baseUrl: 'https://private.invalid/PRIVATE FIXTURE API', authType: 'bearer' },
      local: { path: '/PRIVATE FIXTURE LOCAL' },
    })))
    const before = files(root)
    const sources = read()
    for (const transport of ['stdio', 'http', 'sse'] as const) {
      const source = sources.find(source => source.config.slug === `fixture-${transport}`)!
      expect(source.config.mcp).toEqual({ transport })
      expect(source.config.api).toBeUndefined()
      expect(source.config.local).toBeUndefined()
      expect(source.config.icon).toBeUndefined()
      expect(source.guide).toBeNull()
      expect(source.folderPath).toBe('')
      expect(source.workspaceRootPath).toBe('')
    }
    expect(JSON.stringify(sources)).not.toContain('PRIVATE FIXTURE')
    expect(JSON.stringify(sources)).not.toContain(root)
    expect(JSON.stringify(sources)).not.toContain('private.invalid')
    expect(files(root)).toEqual(before)
  })

  test('unrecognized or cross-type transport values never become public configuration', () => {
    const { read } = workspace([
      ...['STDIO', 'https://private.invalid/token', { command: 'private-command' }, null, undefined].map((transport, index) => config(`fixture-invalid-${index}`, { mcp: { transport } })),
      config('fixture-api', { type: 'api', mcp: { transport: 'stdio', command: 'private-command' } }),
    ])
    for (const source of read().filter(source => source.config.slug.startsWith('fixture-'))) expect(source.config.mcp).toBeUndefined()
  })
}
