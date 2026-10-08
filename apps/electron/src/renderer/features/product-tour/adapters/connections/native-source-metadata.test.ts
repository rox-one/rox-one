import { afterEach, expect, test } from 'bun:test'
import { chmodSync, existsSync, lstatSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
  const { nativeSources, projectNativeWorkspaceEvent } = await import('../../../../../../../../packages/server-core/src/handlers/rpc/native-session-scope')
  const { getLocalSourceFolderState, isSourceUsable, loadSource } = await import('../../../../../../../../packages/shared/src/sources/storage')
  const { RPC_CHANNELS } = await import('../../../../../../../../packages/shared/src/protocol')
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

  test('missing local configuration, absent folders and files cannot inherit saved connected readiness', () => {
    const { root, read } = workspace([
      config('fixture-no-path', { type: 'local' }),
      config('fixture-absent', { type: 'local', local: { path: '${WORKSPACE}/absent' } }),
      config('fixture-file', { type: 'local', local: { path: '${WORKSPACE}/ordinary-file' } }),
    ])
    writeFileSync(join(root, 'ordinary-file'), 'private file content')
    const before = files(root)
    for (const projected of read().filter(source => source.config.slug.startsWith('fixture-'))) {
      const loaded = loadSource(root, projected.config.slug)!
      expect(getLocalSourceFolderState(loaded).available).toBe(false)
      expect(isSourceUsable(loaded)).toBe(false)
      expect(sourceReadiness(projected)).toEqual({ state: 'unavailable', reason: 'not-connected' })
      expect(loaded.localFolderAvailable).toBe(false)
      expect(projected.localFolderAvailable).toBe(false)
      expect(sourceReadiness(projected)).toEqual({ state: 'unavailable', reason: 'not-connected' })
      expect(sourceReadiness(loaded)).toEqual({ state: 'unavailable', reason: 'not-connected' })
    }
    expect(existsSync(join(root, 'absent'))).toBe(false)
    expect(files(root)).toEqual(before)
  })

  test('actual folder availability survives native projection and changes on fresh reads without saving health', () => {
    const { root, read } = workspace([config('fixture-folder', {
      type: 'local', local: { path: '${SOURCE_DIR}/PRIVATE FIXTURE FOLDER' },
      connectionStatus: 'needs_auth', isAuthenticated: false,
      mcp: { transport: 'stdio', authType: 'bearer', command: 'PRIVATE FIXTURE COMMAND' },
    })])
    const folder = join(root, 'sources', 'fixture-folder', 'PRIVATE FIXTURE FOLDER')
    const configPath = join(root, 'sources', 'fixture-folder', 'config.json')
    const original = readFileSync(configPath, 'utf8')
    mkdirSync(folder)
    const before = files(root)
    const projected = read().find(source => source.config.slug === 'fixture-folder')!
    const loaded = loadSource(root, 'fixture-folder')!
    expect(isSourceUsable(loaded)).toBe(true)
    expect(sourceReadiness(projected, false)).toEqual({ state: 'ready' })
    expect(loaded.localFolderAvailable).toBe(true)
    expect(projected.localFolderAvailable).toBe(true)
    expect(sourceReadiness(projected, false)).toEqual({ state: 'ready' })
    expect(sourceReadiness(loaded, false)).toEqual({ state: 'ready' })
    const eventSources = nativeSources([loaded])
    expect(eventSources[0]?.localFolderAvailable).toBe(true)
    expect(sourceReadiness(eventSources[0]!)).toEqual({ state: 'ready' })
    expect(projectNativeWorkspaceEvent(RPC_CHANNELS.sources.CHANGED, [loaded.workspaceId, [loaded]], loaded.workspaceId, () => false)?.[1]).toEqual(eventSources)
    expect(projectNativeWorkspaceEvent(RPC_CHANNELS.sources.CHANGED, [loaded.workspaceId, [loaded]], 'foreign-workspace', () => false)).toBeNull()
    expect(connectionCapabilities({ sources: [projected], workspaceId: 'foreign-workspace', selectedSlugs: ['fixture-folder'] })['sources.ready']).toEqual({ state: 'unavailable', reason: 'missing-entity' })
    expect(connectionCapabilities({ sources: [projected], workspaceId: 'fixture-workspace', selectedSlugs: [] })['sources.ready']).toEqual({ state: 'unavailable', reason: 'missing-entity' })
    for (const payload of [projected, ...eventSources]) {
      expect(payload.config.local).toBeUndefined()
      expect(payload.config.mcp).toBeUndefined()
      expect(payload.guide).toBeNull()
      expect(JSON.stringify(payload)).not.toContain('PRIVATE FIXTURE')
      expect(JSON.stringify(payload)).not.toContain(root)
    }
    expect(files(root)).toEqual(before)
    // A folder disappearing after a saved connected result must not remain ready.
    writeFileSync(configPath, JSON.stringify({ ...JSON.parse(original), connectionStatus: 'connected' }))
    const saved = readFileSync(configPath, 'utf8')
    rmSync(folder, { recursive: true })
    const refreshed = read().find(source => source.config.slug === 'fixture-folder')!
    expect(refreshed.localFolderAvailable).toBe(false)
    expect(sourceReadiness(refreshed)).toEqual({ state: 'unavailable', reason: 'not-connected' })
    expect(loadSource(root, 'fixture-folder')?.localFolderAvailable).toBe(false)
    expect(readFileSync(configPath, 'utf8')).toBe(saved)
  })

  test.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('an actual unreadable local directory supplies no readiness', () => {
    const { root, read } = workspace([config('fixture-unreadable', { type: 'local', local: { path: '${WORKSPACE}/locked' } })])
    const locked = join(root, 'locked')
    mkdirSync(locked)
    const before = files(root)
    chmodSync(locked, 0)
    try {
      const loaded = loadSource(root, 'fixture-unreadable')!
      expect(getLocalSourceFolderState(loaded).available).toBe(false)
      const projected = read().find(source => source.config.slug === 'fixture-unreadable')!
      expect(sourceReadiness(projected)).toEqual({ state: 'unavailable', reason: 'not-connected' })
      expect(loaded.localFolderAvailable).toBe(false)
      expect(projected.localFolderAvailable).toBe(false)
      expect(sourceReadiness(projected)).toEqual({ state: 'unavailable', reason: 'not-connected' })
    } finally { chmodSync(locked, 0o755) }
    expect(files(root)).toEqual(before)
  })

  test('enabled and selected local sources need explicit backend availability; unknown and cross-type claims stay honest', () => {
    const { read } = workspace([config('fixture-local', { type: 'local' }), config('fixture-remote')])
    const { localFolderAvailable: _availability, ...local } = read().find(source => source.config.slug === 'fixture-local')!
    expect(sourceReadiness(local)).toEqual({ state: 'pending', reason: 'api-unavailable' })
    expect(sourceReadiness({ ...local, localFolderAvailable: false })).toEqual({ state: 'unavailable', reason: 'not-connected' })
    expect(sourceReadiness({ ...local, localFolderAvailable: true, config: { ...local.config, enabled: false } })).toEqual({ state: 'unavailable', reason: 'not-connected' })
    const remote = { ...read().find(source => source.config.slug === 'fixture-remote')!, localFolderAvailable: false }
    expect(sourceReadiness(remote)).toEqual({ state: 'ready' })
    expect(nativeSources([remote])[0]?.localFolderAvailable).toBeUndefined()
  })

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
