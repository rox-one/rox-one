import { describe, expect, it } from 'bun:test'
import { ensureRoxRuntimeDefault, type RoxRuntimeDefaultApi } from '../rox-runtime-default'
import type { StartupRuntimeSummary } from '@rox/shared/protocol'

type Conn = { slug: string; providerType?: string; isDefault?: boolean }

function fakeApi(connections: Conn[], opts: { setupFails?: boolean; listThrows?: boolean } = {}) {
  const calls = { setup: [] as unknown[], setDefault: [] as string[] }
  const api: RoxRuntimeDefaultApi = {
    async listLlmConnectionsWithStatus() {
      if (opts.listThrows) throw new Error('ipc down')
      return connections
    },
    async setupLlmConnection(setup) {
      calls.setup.push(setup)
      return opts.setupFails ? { success: false, error: 'nope' } : { success: true }
    },
    async setDefaultLlmConnection(slug) {
      calls.setDefault.push(slug)
      return { success: true }
    },
  }
  return { api, calls }
}

describe('ensureRoxRuntimeDefault (first run → Rox runtime)', () => {
  it('keeps the seeded Rox default untouched', async () => {
    const { api, calls } = fakeApi([{ slug: 'rox-kimi', providerType: 'omp', isDefault: true }])
    expect(await ensureRoxRuntimeDefault(api)).toEqual({ status: 'already-default', slug: 'rox-kimi' })
    expect(calls.setup).toHaveLength(0)
    expect(calls.setDefault).toHaveLength(0)
  })

  it('preserves a custom default instead of replacing an existing user choice', async () => {
    const { api, calls } = fakeApi([
      { slug: 'claude-max', providerType: 'anthropic', isDefault: true },
      { slug: 'rox-kimi', providerType: 'omp' },
    ])
    expect(await ensureRoxRuntimeDefault(api)).toEqual({ status: 'preserved-default', slug: 'claude-max' })
    expect(calls.setup).toHaveLength(0)
    expect(calls.setDefault).toHaveLength(0)
  })

  it('creates the same connection the old «Rox» provider option did when no default exists', async () => {
    const { api, calls } = fakeApi([{ slug: 'omp', providerType: 'pi' }])
    expect(await ensureRoxRuntimeDefault(api)).toEqual({ status: 'created', slug: 'omp-2' })
    expect(calls.setup).toEqual([{ slug: 'omp-2', name: 'Rox', providerType: 'omp' }])
    expect(calls.setDefault).toEqual(['omp-2'])
  })

  it('preserves the selected provider even when it is the only connection', async () => {
    const { api, calls } = fakeApi([{ slug: 'omp', providerType: 'pi', isDefault: true }])
    expect(await ensureRoxRuntimeDefault(api)).toEqual({ status: 'preserved-default', slug: 'omp' })
    expect(calls.setup).toHaveLength(0)
    expect(calls.setDefault).toHaveLength(0)
  })

  it('never throws: failures are reported so the app still opens', async () => {
    expect((await ensureRoxRuntimeDefault(fakeApi([], { setupFails: true }).api)).status).toBe('failed')
    expect((await ensureRoxRuntimeDefault(fakeApi([], { listThrows: true }).api)).status).toBe('failed')
  })
})

describe('ensureRoxRuntimeDefault native configuration-only boundary', () => {
  function nativeApi(summary: unknown) {
    const calls: string[] = []
    const api: RoxRuntimeDefaultApi = {
      getOrgIdentity: async () => { calls.push('identity'); return { authority: 'native' } },
      // JSON RPC input is deliberately checked at runtime, including malformed payloads.
      getStartupRuntimeSummary: async () => { calls.push('summary'); return JSON.parse(JSON.stringify(summary)) },
      listLlmConnectionsWithStatus: async () => { calls.push('legacy-list'); throw Error('native must not read host account roster') },
      setupLlmConnection: async () => { calls.push('create'); throw Error('native must not create host connections') },
      setDefaultLlmConnection: async () => { calls.push('set-default'); throw Error('native must not change host default') },
    }
    return { api, calls }
  }
  it('observes exact OMP default using only identity and configuration metadata', async () => {
    const summary = { kind: 'configuration-only', slug: 'rox-kimi', providerType: 'omp', isDefault: true } satisfies StartupRuntimeSummary
    const { api, calls } = nativeApi(summary)
    expect(await ensureRoxRuntimeDefault(api)).toEqual({ status: 'already-default', slug: 'rox-kimi', runtimeSummary: summary })
    expect(calls).toEqual(['identity', 'summary'])
  })
  it('preserves a non-OMP host default without inspecting or changing its credentials', async () => {
    const summary = { kind: 'configuration-only', slug: 'selected-provider', providerType: 'pi', isDefault: true } satisfies StartupRuntimeSummary
    const { api, calls } = nativeApi(summary)
    expect(await ensureRoxRuntimeDefault(api)).toEqual({ status: 'preserved-default', slug: 'selected-provider', runtimeSummary: summary })
    expect(calls).toEqual(['identity', 'summary'])
  })
  for (const [name, summary] of [
    ['null', null], ['wrong projection', { kind: 'authenticated', slug: 'rox', providerType: 'omp', isDefault: true }],
    ['not default', { kind: 'configuration-only', slug: 'rox', providerType: 'omp', isDefault: false }],
    ['missing slug', { kind: 'configuration-only', providerType: 'omp', isDefault: true }],
    ['numeric slug', { kind: 'configuration-only', slug: 123, providerType: 'omp', isDefault: true }],
    ['blank slug', { kind: 'configuration-only', slug: '   ', providerType: 'omp', isDefault: true }],
    ['missing provider', { kind: 'configuration-only', slug: 'rox', isDefault: true }],
    ['numeric provider', { kind: 'configuration-only', slug: 'rox', providerType: 123, isDefault: true }],
    ['object provider', { kind: 'configuration-only', slug: 'rox', providerType: {}, isDefault: true }],
    ['unknown provider', { kind: 'configuration-only', slug: 'rox', providerType: 'unknown-runtime', isDefault: true }],
    ['nonboolean default', { kind: 'configuration-only', slug: 'rox', providerType: 'omp', isDefault: 'yes' }],
  ] as const) {
    it(`fails closed for ${name} summary without legacy fallback`, async () => {
      const { api, calls } = nativeApi(summary)
      expect(await ensureRoxRuntimeDefault(api)).toEqual({ status: 'failed', error: 'runtime-configuration-unavailable' })
      expect(calls).toEqual(['identity', 'summary'])
    })
  }
  it('fails closed if the native metadata API is absent or its request fails', async () => {
    const absent = nativeApi(null)
    delete absent.api.getStartupRuntimeSummary
    expect((await ensureRoxRuntimeDefault(absent.api)).status).toBe('failed')
    expect(absent.calls).toEqual(['identity'])
    const unavailable = nativeApi(null)
    unavailable.api.getStartupRuntimeSummary = async () => { throw Error('workspace permission changed') }
    expect(await ensureRoxRuntimeDefault(unavailable.api)).toEqual({ status: 'failed', error: 'workspace permission changed' })
    expect(unavailable.calls).toEqual(['identity'])
  })
  it('does not fall back to legacy host APIs for an unknown identity authority', async () => {
    const { api, calls } = nativeApi(null)
    api.getOrgIdentity = async () => { calls.push('identity'); return JSON.parse('{"authority":"unknown"}') }
    expect((await ensureRoxRuntimeDefault(api)).status).toBe('failed')
    expect(calls).toEqual(['identity'])
  })
  it('does not read host accounts when a present identity endpoint returns null', async () => {
    const { api, calls } = nativeApi(null)
    api.getOrgIdentity = async () => { calls.push('identity'); return JSON.parse('null') }
    expect((await ensureRoxRuntimeDefault(api)).status).toBe('failed')
    expect(calls).toEqual(['identity'])
  })
  it('retains the legacy setup behavior for a confirmed local identity', async () => {
    const { api, calls } = fakeApi([])
    api.getOrgIdentity = async () => ({ authority: 'local' })
    api.getStartupRuntimeSummary = async () => { throw Error('local branch must use legacy flow') }
    expect(await ensureRoxRuntimeDefault(api)).toEqual({ status: 'created', slug: 'omp' })
    expect(calls.setup).toEqual([{ slug: 'omp', name: 'Rox', providerType: 'omp' }])
    expect(calls.setDefault).toEqual(['omp'])
  })
})

describe('ensureRoxRuntimeDefault startup options (PERF-06)', () => {
  it('uses the caller identity, forwards list options and hands back an unchanged list', async () => {
    const connections = [{ slug: 'rox-kimi', providerType: 'omp', isDefault: true }]
    const listed: unknown[] = []
    let identityReads = 0
    const read: Array<ReadonlyArray<Conn>> = []
    const api: RoxRuntimeDefaultApi = {
      async getOrgIdentity() { identityReads++; return { authority: 'local' } },
      async listLlmConnectionsWithStatus(options) { listed.push(options); return connections },
      async setupLlmConnection() { return { success: true } },
      async setDefaultLlmConnection() { return { success: true } },
    }
    const result = await ensureRoxRuntimeDefault(api, {
      identity: { authority: 'local' },
      listOptions: { refresh: false },
      onConnectionsRead: list => { read.push(list) },
    })
    expect(result).toEqual({ status: 'already-default', slug: 'rox-kimi' })
    expect(identityReads).toBe(0)
    expect(listed).toEqual([{ refresh: false }])
    expect(read).toEqual([connections])
  })

  it('does not hand back a list it changed', async () => {
    const { api } = fakeApi([{ slug: 'omp', providerType: 'pi' }])
    const read: unknown[] = []
    expect((await ensureRoxRuntimeDefault(api, { onConnectionsRead: list => { read.push(list) } })).status).toBe('created')
    expect(read).toEqual([])
  })
})
