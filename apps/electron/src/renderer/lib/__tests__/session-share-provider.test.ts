import { describe, expect, it } from 'bun:test'
import { chooseShareProvider, createRoxIdShareProvider, createViewerShareProvider } from '../session-share-provider'

describe('session share providers', () => {
  it('rox-id is unavailable until the contract has share endpoints → viewer is chosen', () => {
    const viewer = createViewerShareProvider(async () => ({ success: true }))
    expect(chooseShareProvider([createRoxIdShareProvider({}), viewer])?.id).toBe('viewer')
    const roxId = createRoxIdShareProvider({ createShare: async () => ({ url: 'https://x' }), revokeShare: async () => {} })
    expect(chooseShareProvider([roxId, viewer])?.id).toBe('rox-id')
  })
  it('rox-id parses expiry and reports its id', async () => {
    const p = createRoxIdShareProvider({ createShare: async () => ({ url: 'https://rox.one/s/a', expiresAt: '2026-10-15T00:00:00Z' }), revokeShare: async () => {} })
    expect(await p.create('s1')).toEqual({ url: 'https://rox.one/s/a', expiresAt: Date.parse('2026-10-15T00:00:00Z'), provider: 'rox-id' })
  })
  it('viewer revoke surfaces a server failure', async () => {
    const calls: unknown[] = []
    const p = createViewerShareProvider(async (_id, cmd) => { calls.push(cmd); return { success: false, error: 'nope' } })
    await expect(p.revoke('s1')).rejects.toThrow('nope')
    expect(calls).toEqual([{ type: 'revokeShare' }])
  })
})
