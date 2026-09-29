import { describe, expect, it } from 'bun:test'
import { ensureRoxRuntimeDefault, type RoxRuntimeDefaultApi } from '../rox-runtime-default'

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

  it('promotes an existing Rox connection over another default', async () => {
    const { api, calls } = fakeApi([
      { slug: 'claude-max', providerType: 'anthropic', isDefault: true },
      { slug: 'rox-kimi', providerType: 'omp' },
    ])
    expect(await ensureRoxRuntimeDefault(api)).toEqual({ status: 'set-default', slug: 'rox-kimi' })
    expect(calls.setDefault).toEqual(['rox-kimi'])
  })

  it('creates the same connection the old «Rox» provider option did', async () => {
    const { api, calls } = fakeApi([{ slug: 'omp', providerType: 'pi', isDefault: true }])
    expect(await ensureRoxRuntimeDefault(api)).toEqual({ status: 'created', slug: 'omp-2' })
    expect(calls.setup).toEqual([{ slug: 'omp-2', name: 'Rox', providerType: 'omp' }])
    expect(calls.setDefault).toEqual(['omp-2'])
  })

  it('never throws: failures are reported so the app still opens', async () => {
    expect((await ensureRoxRuntimeDefault(fakeApi([], { setupFails: true }).api)).status).toBe('failed')
    expect((await ensureRoxRuntimeDefault(fakeApi([], { listThrows: true }).api)).status).toBe('failed')
  })
})
