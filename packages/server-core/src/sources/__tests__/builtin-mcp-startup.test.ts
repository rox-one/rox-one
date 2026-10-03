import { afterEach, describe, expect, it } from 'bun:test'
import type { FolderSourceConfig, LoadedSource } from '@rox/shared/sources'
import { BuiltinMcpStartup, type BuiltinMcpStartupDependencies } from '../builtin-mcp-startup.ts'

const services: BuiltinMcpStartup[] = []
afterEach(async () => { await Promise.all(services.splice(0).map(service => service.stop())) })

function source(slug = 'deepwiki', extra: Partial<FolderSourceConfig> = {}): LoadedSource {
  return {
    config: {
      id: `builtin-mcp-${slug}`, slug, name: slug, provider: slug, type: 'mcp', enabled: true,
      mcp: { transport: 'http', url: 'https://example.com/mcp', authType: 'none' },
      connectionStatus: 'untested', isAuthenticated: false, ...extra,
    },
    folderPath: `/workspace/test/sources/${slug}`, workspaceRootPath: '/workspace/test',
    workspaceId: 'test', guide: null,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

function harness(sources: LoadedSource[] = [source()]) {
  const configs = new Map(sources.map(item => [item.config.slug, structuredClone(item.config)]))
  const counts = { installs: 0, builds: 0, lists: 0, closes: 0, calls: 0, seeds: 0 }
  const writes: FolderSourceConfig[] = []
  let runtimeReady: (() => void) | undefined
  const dependencies: BuiltinMcpStartupDependencies = {
    ensureSources: () => { counts.seeds++ },
    loadSources: () => sources.map(item => ({ ...item, config: configs.get(item.config.slug)! })),
    loadConfig: (_root, slug) => configs.get(slug) ?? null,
    saveConfig: (_root, config) => { writes.push(config); configs.set(config.slug, config) },
    readiness: () => ({ status: 'ready' }),
    isManaged: config => config.id === `builtin-mcp-${config.slug}`,
    localEnabled: () => true,
    ensureInstalled: async () => { counts.installs++ },
    installPlaywrightBrowser: async () => {},
    prepareQmd: async () => {},
    verifyEverything: async () => {},
    buildServers: async list => {
      counts.builds++
      return {
        mcpServers: Object.fromEntries(list.map(item => [item.config.slug, item.config.mcp?.transport === 'stdio'
          ? { type: 'stdio' as const, command: item.config.mcp.command!, args: item.config.mcp.args }
          : { type: 'http' as const, url: item.config.mcp!.url! }])),
        errors: [],
      }
    },
    createClient: () => ({
      listTools: async () => { counts.lists++; return [{ name: 'read', inputSchema: { type: 'object' } }] },
      callTool: async () => { counts.calls++; return {} },
      close: async () => { counts.closes++ },
    }),
    resolveExecutable: async command => `/managed/bin/${command}`,
    onRuntimeReady: listener => { runtimeReady = listener; return () => { runtimeReady = undefined } },
  }
  const create = (overrides: Partial<BuiltinMcpStartupDependencies> = {}, options = {}) => {
    const service = new BuiltinMcpStartup({
      timeoutMs: 40, retryDelayMs: 1, ...options,
      dependencies: { ...dependencies, ...overrides },
    })
    services.push(service)
    return service
  }
  return { create, dependencies, configs, counts, writes, runtimeReady: () => runtimeReady?.() }
}

describe('built-in MCP startup', () => {
  it('seeds and checks each launch, closes the probe, and does not invoke normal tools', async () => {
    const h = harness()
    const first = h.create()
    await first.ensureWorkspace('/workspace/test')
    expect(h.configs.get('deepwiki')?.connectionStatus).toBe('connected')
    expect(h.counts).toMatchObject({ lists: 1, closes: 1, calls: 0, installs: 1 })
    // Config watcher echo from own status save cannot start another installer.
    await first.ensureWorkspace('/workspace/test')
    expect(h.counts.lists).toBe(1)
    await first.stop()
    await h.create().ensureWorkspace('/workspace/test')
    expect(h.counts.lists).toBe(2)
  })

  it('preserves disabled and user-owned sources without starting processes', async () => {
    const disabled = source('deepwiki', { enabled: false, connectionStatus: 'failed', connectionError: 'user disabled' })
    const owned = source('custom', { id: 'my-own-id' })
    const h = harness([disabled, owned])
    await h.create().ensureWorkspace('/workspace/test')
    expect(h.counts.installs).toBe(0)
    expect(h.counts.builds).toBe(0)
    expect(h.writes).toEqual([])
    expect(h.configs.get('deepwiki')).toEqual(disabled.config)
  })

  it('does not overwrite connection settings edited while a handshake is in flight', async () => {
    const h = harness()
    const started = deferred<void>()
    const completed = deferred<[]>()
    const service = h.create({ createClient: () => ({
      listTools: () => { started.resolve(); return completed.promise },
      callTool: async () => ({}), close: async () => { h.counts.closes++ },
    }) })
    const run = service.ensureWorkspace('/workspace/test')
    await started.promise
    h.configs.set('deepwiki', { ...h.configs.get('deepwiki')!, enabled: false })
    completed.resolve([])
    await run
    expect(h.writes).toEqual([])
    expect(h.configs.get('deepwiki')?.enabled).toBe(false)
    expect(h.counts.closes).toBe(1)
  })

  it('checks edited settings in a follow-up pass when the previous handshake is still running', async () => {
    const h = harness()
    const started = deferred<void>()
    const firstDone = deferred<[]>()
    const urls: string[] = []
    const service = h.create({ createClient: config => {
      if (config.transport !== 'stdio') urls.push(config.url)
      const first = urls.length === 1
      return {
        listTools: () => { started.resolve(); return first ? firstDone.promise : Promise.resolve([]) },
        callTool: async () => ({}), close: async () => {},
      }
    } })
    const run = service.ensureWorkspace('/workspace/test')
    await started.promise
    h.configs.set('deepwiki', {
      ...h.configs.get('deepwiki')!,
      mcp: { transport: 'http', url: 'https://edited.example.com/mcp', authType: 'none' },
    })
    const followUp = service.ensureWorkspace('/workspace/test')
    firstDone.resolve([])
    await Promise.all([run, followUp])
    expect(urls).toEqual(['https://example.com/mcp', 'https://edited.example.com/mcp'])
    expect(h.writes).toHaveLength(1)
    expect(h.configs.get('deepwiki')?.connectionStatus).toBe('connected')
  })

  it('does not lose an explicit credential retry while the previous probe is finishing', async () => {
    const h = harness()
    const started = deferred<void>()
    const firstDone = deferred<[]>()
    const service = h.create({ createClient: () => ({
      listTools: async () => {
        h.counts.lists++
        if (h.counts.lists === 1) { started.resolve(); return firstDone.promise }
        return []
      },
      callTool: async () => ({}), close: async () => {},
    }) })
    const run = service.ensureWorkspace('/workspace/test')
    await started.promise
    const retry = service.retryWorkspace('/workspace/test')
    firstDone.resolve([])
    await Promise.all([run, retry])
    expect(h.counts.lists).toBe(2)
    expect(h.counts.builds).toBe(2)
    expect(h.configs.get('deepwiki')?.connectionStatus).toBe('connected')
  })

  it('bounds failed network installation retries and reports actual failure', async () => {
    const h = harness()
    await h.create({ createClient: () => ({
      listTools: async () => { h.counts.lists++; throw new Error('Network unavailable') },
      callTool: async () => ({}), close: async () => { h.counts.closes++ },
    }) }).ensureWorkspace('/workspace/test')
    expect(h.counts.lists).toBe(2)
    expect(h.counts.closes).toBe(2)
    expect(h.configs.get('deepwiki')?.connectionStatus).toBe('failed')
    expect(h.configs.get('deepwiki')?.isAuthenticated).toBe(false)
  })

  it('automatically retries a transient outage after the bounded launch attempts', async () => {
    const h = harness()
    let online = false
    const recovered = deferred<void>()
    const service = h.create({ createClient: () => ({
      listTools: async () => {
        h.counts.lists++
        if (!online) throw new Error('Network unavailable')
        recovered.resolve()
        return []
      },
      callTool: async () => ({}), close: async () => { h.counts.closes++ },
    }) }, { attempts: 1, retryIntervalMs: 5, maxRetryIntervalMs: 20 })
    await service.ensureWorkspace('/workspace/test')
    expect(h.configs.get('deepwiki')?.connectionStatus).toBe('failed')
    online = true
    await recovered.promise
    await service.ensureWorkspace('/workspace/test')
    expect(h.counts.lists).toBe(2)
    expect(h.counts.closes).toBe(2)
    expect(h.configs.get('deepwiki')?.connectionStatus).toBe('connected')
  })

  it('retries a failed native installation after network recovery', async () => {
    const h = harness()
    let online = false
    const recovered = deferred<void>()
    const service = h.create({
      ensureInstalled: async () => {
        h.counts.installs++
        if (!online) throw new Error('Download network unavailable')
      },
      createClient: () => ({
        listTools: async () => { h.counts.lists++; recovered.resolve(); return [] },
        callTool: async () => ({}), close: async () => {},
      }),
    }, { attempts: 1, retryIntervalMs: 5 })
    await service.ensureWorkspace('/workspace/test')
    expect(h.counts.lists).toBe(0)
    online = true
    await recovered.promise
    await service.ensureWorkspace('/workspace/test')
    expect(h.counts.installs).toBe(2)
    expect(h.configs.get('deepwiki')?.connectionStatus).toBe('connected')
  })

  it('waits for credential changes rather than repeatedly retrying unauthorized sources', async () => {
    const h = harness()
    const service = h.create({ createClient: () => ({
      listTools: async () => { h.counts.lists++; throw new Error('Unauthorized 401') },
      callTool: async () => ({}), close: async () => {},
    }) }, { attempts: 1, retryIntervalMs: 2 })
    await service.ensureWorkspace('/workspace/test')
    await new Promise(resolve => setTimeout(resolve, 15))
    expect(h.counts.lists).toBe(1)
    expect(h.configs.get('deepwiki')?.connectionStatus).toBe('needs_auth')
  })

  it('cancels scheduled retries when stopped or when the source is disabled', async () => {
    const h = harness()
    const service = h.create({ createClient: () => ({
      listTools: async () => { h.counts.lists++; throw new Error('Network unavailable') },
      callTool: async () => ({}), close: async () => {},
    }) }, { attempts: 1, retryIntervalMs: 5 })
    await service.ensureWorkspace('/workspace/test')
    h.configs.set('deepwiki', { ...h.configs.get('deepwiki')!, enabled: false })
    await service.ensureWorkspace('/workspace/test')
    await service.stop()
    await new Promise(resolve => setTimeout(resolve, 15))
    expect(h.counts.lists).toBe(1)
  })

  it('isolates readiness exceptions so unrelated sources still get checked', async () => {
    const h = harness([source('bad'), source('healthy')])
    const service = h.create({ readiness: loaded => {
      if (loaded.config.slug === 'bad') throw new Error('Credential store temporarily unavailable')
      return { status: 'ready' }
    } }, { concurrency: 1 })
    await service.ensureWorkspace('/workspace/test')
    expect(h.configs.get('bad')?.connectionStatus).toBe('failed')
    expect(h.configs.get('healthy')?.connectionStatus).toBe('connected')
    expect(h.counts.lists).toBe(1)
  })

  it('shutdown interrupts a stalled readiness lookup without a false failure', async () => {
    const h = harness()
    const started = deferred<void>()
    const service = h.create({ readiness: async () => { started.resolve(); return new Promise(() => {}) } }, { timeoutMs: 60_000 })
    const run = service.ensureWorkspace('/workspace/test')
    await started.promise
    await service.stop()
    await run
    expect(h.writes).toEqual([])
    expect(h.counts.lists).toBe(0)
  })

  it('shutdown interrupts a stalled server build before spawning a process', async () => {
    const h = harness()
    const started = deferred<void>()
    const service = h.create({ buildServers: async () => { started.resolve(); return new Promise(() => {}) } }, { timeoutMs: 60_000 })
    const run = service.ensureWorkspace('/workspace/test')
    await started.promise
    await service.stop()
    await run
    expect(h.writes).toEqual([])
    expect(h.counts.lists).toBe(0)
  })

  it('closes a stalled installation after its timeout', async () => {
    const h = harness()
    await h.create({ createClient: () => ({
      listTools: () => new Promise(() => {}), callTool: async () => ({}),
      close: async () => { h.counts.closes++ },
    }) }, { attempts: 1, timeoutMs: 10 }).ensureWorkspace('/workspace/test')
    expect(h.counts.closes).toBe(1)
    expect(h.configs.get('deepwiki')?.connectionStatus).toBe('failed')
    expect(h.configs.get('deepwiki')?.connectionError).toContain('timed out')
  })

  it('aborts outstanding transports and unsubscribes on shutdown without storing a false failure', async () => {
    const h = harness()
    const started = deferred<void>()
    const service = h.create({ createClient: () => ({
      listTools: () => { started.resolve(); return new Promise(() => {}) },
      callTool: async () => ({}), close: async () => { h.counts.closes++ },
    }) })
    const run = service.ensureWorkspace('/workspace/test')
    await started.promise
    await service.stop()
    await run
    expect(h.counts.closes).toBeGreaterThanOrEqual(1)
    expect(h.writes).toEqual([])
    h.runtimeReady()
    expect(h.counts.builds).toBe(1)
  })

  it('waits for managed package runners and retries after runtime installation completes', async () => {
    const local = source('codegraph', { mcp: { transport: 'stdio', command: 'uvx', args: ['--from', 'pinned==1.0'], authType: 'none' } })
    const h = harness([local])
    let installed = false
    const handshake = deferred<void>()
    const service = h.create({
      resolveExecutable: async () => installed ? '/managed/bin/uvx' : null,
      createClient: () => ({
        listTools: async () => { h.counts.lists++; handshake.resolve(); return [] },
        callTool: async () => ({}), close: async () => { h.counts.closes++ },
      }),
    })
    await service.ensureWorkspace('/workspace/test')
    expect(h.configs.get('codegraph')?.connectionStatus).toBe('untested')
    expect(h.counts.lists).toBe(0)
    installed = true
    h.runtimeReady()
    await handshake.promise
    await service.ensureWorkspace('/workspace/test')
    expect(h.configs.get('codegraph')?.connectionStatus).toBe('connected')
    expect(h.counts.lists).toBe(1)
  })

  it('passes the loaded source into credential-aware readiness and retries after a credential save', async () => {
    const h = harness()
    let authorized = false
    const service = h.create({ readiness: async loaded => {
      expect(loaded.workspaceId).toBe('test')
      return authorized ? { status: 'ready' } : { status: 'needs_auth', reason: 'Encrypted credential missing' }
    } })
    await service.ensureWorkspace('/workspace/test')
    expect(h.counts.lists).toBe(0)
    expect(h.configs.get('deepwiki')?.connectionStatus).toBe('needs_auth')
    authorized = true
    h.configs.set('deepwiki', { ...h.configs.get('deepwiki')!, isAuthenticated: true })
    await service.ensureWorkspace('/workspace/test')
    expect(h.configs.get('deepwiki')?.connectionStatus).toBe('connected')
    expect(h.counts.lists).toBe(1)
  })

  it('respects the workspace local MCP switch before native install or process startup', async () => {
    const h = harness([source('codegraph', { mcp: { transport: 'stdio', command: 'uvx', authType: 'none' } })])
    await h.create({ localEnabled: () => false }).ensureWorkspace('/workspace/test')
    expect(h.counts.installs).toBe(0)
    expect(h.counts.builds).toBe(0)
    expect(h.configs.get('codegraph')?.connectionStatus).toBe('local_disabled')
  })

  it('rechecks deferred stdio sources after the workspace local MCP switch is enabled', async () => {
    const h = harness([source('codegraph', { mcp: { transport: 'stdio', command: 'uvx', authType: 'none' } })])
    let enabled = false
    const service = h.create({ localEnabled: () => enabled })
    await service.ensureWorkspace('/workspace/test')
    expect(h.configs.get('codegraph')?.connectionStatus).toBe('local_disabled')
    enabled = true
    await service.ensureWorkspace('/workspace/test')
    expect(h.counts.lists).toBe(1)
    expect(h.configs.get('codegraph')?.connectionStatus).toBe('connected')
  })

  it('does not persist credential-bearing URL query strings in errors', async () => {
    const h = harness()
    await h.create({ createClient: () => ({
      listTools: async () => { throw new Error('Failed https://alice:secret@example.com/mcp?key=secret token=anothersecret') },
      callTool: async () => ({}), close: async () => {},
    }) }, { attempts: 1 }).ensureWorkspace('/workspace/test')
    expect(h.configs.get('deepwiki')?.connectionError).toBe('Failed https://example.com/mcp token=[redacted]')
  })

  it('provisions the pinned Playwright browser before recording a successful connection', async () => {
    const h = harness([source('playwright', {
      mcp: { transport: 'stdio', command: 'npx', args: ['-y', '@playwright/mcp@0.0.83', '--browser', 'chromium', '--headless'], authType: 'none' },
    })])
    let browserInstalls = 0
    await h.create({ installPlaywrightBrowser: async (server, signal) => {
      expect(server.args).toContain('@playwright/mcp@0.0.83')
      expect(signal.aborted).toBe(false)
      expect(h.configs.get('playwright')?.connectionStatus).toBe('untested')
      browserInstalls++
    } }).ensureWorkspace('/workspace/test')
    expect(browserInstalls).toBe(1)
    expect(h.configs.get('playwright')?.connectionStatus).toBe('connected')
    expect(h.counts.calls).toBe(0)
  })

  it('records failed browser provisioning instead of claiming Playwright is ready', async () => {
    const h = harness([source('playwright', {
      mcp: { transport: 'stdio', command: 'npx', args: ['-y', '@playwright/mcp@0.0.83'], authType: 'none' },
    })])
    await h.create({ installPlaywrightBrowser: async () => { throw new Error('Browser download unavailable') } }, { attempts: 1 })
      .ensureWorkspace('/workspace/test')
    expect(h.configs.get('playwright')?.connectionStatus).toBe('failed')
    expect(h.configs.get('playwright')?.connectionError).toBe('Browser download unavailable')
  })

  it('checks the Everything engine before advertising a connected file search server', async () => {
    const h = harness([source('everything-mcp', {
      mcp: { transport: 'stdio', command: 'bun', args: ['x', '@danielsimonjr/everything-mcp@3.2.0'], authType: 'none' },
    })])
    let checks = 0
    await h.create({ verifyEverything: async () => { checks++; throw new Error('Everything desktop service is unavailable') } }, { attempts: 1 })
      .ensureWorkspace('/workspace/test')
    expect(checks).toBe(1)
    expect(h.counts.lists).toBe(0)
    expect(h.configs.get('everything-mcp')?.connectionStatus).toBe('failed')
    expect(h.configs.get('everything-mcp')?.connectionError).toContain('desktop service')
  })

  it('prepares the pinned QMD collection once before its connection retries', async () => {
    const h = harness([source('qmd', { mcp: { transport: 'stdio', command: 'npx', args: ['-y', '@tobilu/qmd@2.8.3', 'mcp', '--index', 'rox'], authType: 'none' } })])
    let preparations = 0
    const service = h.create({
      prepareQmd: async (loaded, server, signal) => {
        expect(loaded.config.slug).toBe('qmd')
        expect(server.args).toContain('@tobilu/qmd@2.8.3')
        expect(signal.aborted).toBe(false)
        expect(h.counts.lists).toBe(0)
        preparations++
      },
      createClient: () => ({
        listTools: async () => { h.counts.lists++; if (h.counts.lists === 1) throw new Error('Connection closed'); return [] },
        callTool: async () => ({}), close: async () => {},
      }),
    })
    await service.ensureWorkspace('/workspace/test')
    expect(preparations).toBe(1)
    expect(h.counts.lists).toBe(2)
    expect(h.configs.get('qmd')?.connectionStatus).toBe('connected')
  })

  it('leaves custom QMD package commands untouched', async () => {
    const h = harness([source('qmd', { mcp: { transport: 'stdio', command: '/custom/qmd', args: ['mcp'], authType: 'none' } })])
    let preparations = 0
    await h.create({ prepareQmd: async () => { preparations++ } }).ensureWorkspace('/workspace/test')
    expect(preparations).toBe(0)
    expect(h.configs.get('qmd')?.connectionStatus).toBe('connected')
  })

  it('records failed QMD setup without repeating its updater or starting the server', async () => {
    const h = harness([source('qmd', { mcp: { transport: 'stdio', command: 'npx', args: ['-y', '@tobilu/qmd@2.8.3', 'mcp', '--index', 'rox'], authType: 'none' } })])
    let preparations = 0
    await h.create({ prepareQmd: async () => { preparations++; throw new Error('QMD update failed') } }).ensureWorkspace('/workspace/test')
    expect(preparations).toBe(1)
    expect(h.counts.lists).toBe(0)
    expect(h.configs.get('qmd')?.connectionStatus).toBe('failed')
  })
})
