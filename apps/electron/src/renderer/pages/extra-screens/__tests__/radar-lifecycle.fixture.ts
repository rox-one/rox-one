import { beforeEach, describe, expect, test } from 'bun:test'
import type { ElectronAPI } from '../../../../shared/types'
import { emptyRadarData, type RadarSweep } from '../radar/radar-model'

const memory = new Map<string, string>()
let owner = 'workspace-A'
let generation = 1
let creationGate: Promise<{ id: string }> | undefined
let readGate: Promise<unknown> | undefined
let snapshot: unknown = { isProcessing: true, messages: [] }
let failCreate = false
let failStorage = false
const calls: { name: string; args: unknown[] }[] = []
const api = {
  getWindowWorkspace: async () => owner,
  getSources: async () => [{ config: { slug: 'brave', name: 'Brave', enabled: true, connectionStatus: 'connected' } },
    { config: { slug: 'disabled', name: 'Disabled', enabled: false } }],
  feedList: async () => ({ items: [{ id: 'feed-evidence', tab: 'news', title: 'Real feed entry', url: 'https://feed.example.test/news', sourceTitle: 'Real feed source', at: Date.now() - 2000 }], sources: [], x: { state: 'disconnected' } }),
  async createSession(...args: unknown[]) {
    calls.push({ name: 'create', args })
    expect(loadRadar(owner).sweeps[0]?.status).toBe('starting')
    if (failCreate) throw new Error('Provider detail should stay private')
    return creationGate ?? { id: `session-${calls.filter(call => call.name === 'create').length}` }
  },
  async sendMessage(...args: unknown[]) {
    calls.push({ name: 'send', args })
    expect(loadRadar(owner).sweeps[0]).toMatchObject({ sessionId: args[0], status: 'running' })
  },
  async getSessionMessages(...args: unknown[]) { calls.push({ name: 'read', args }); return readGate ?? snapshot },
  async cancelProcessing(...args: unknown[]) { calls.push({ name: 'cancel', args }) },
} as unknown as ElectronAPI
Object.assign(globalThis, { window: { electronAPI: api, localStorage: {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem(key: string, value: string) { if (failStorage) throw new Error('Quota full'); memory.set(key, value) },
}, dispatchEvent() {} } })
const { loadRadar, saveRadar, runRadarSweep, syncRadarSweep } = await import('../radar/radar-store')
const base = () => ({ ...emptyRadarData(), topics: [{ id: 'topic-1', label: 'Rox', keywords: ['release'], kind: 'topic' as const, sourceSlugs: ['brave', 'disabled'], createdAt: 1 }] })
const current = (epoch = generation) => ({ isCurrent: () => owner === 'workspace-A' && generation === epoch })
function seedSweep(patch: Partial<RadarSweep> = {}) {
  const sweep: RadarSweep = { id: 'sweep', sessionId: 'session', startedAt: Date.now() - 20_000, date: '2026-10-03', trigger: 'manual', status: 'running', sourceSlugs: ['brave'], ...patch }
  saveRadar(owner, { ...base(), sweeps: [sweep] })
  return sweep
}
beforeEach(() => {
  memory.clear(); calls.length = 0; owner = 'workspace-A'; generation = 1; creationGate = undefined; readGate = undefined
  snapshot = { isProcessing: true, messages: [] }; failCreate = false; failStorage = false; saveRadar(owner, base())
})

describe('source-backed radar lifecycle', () => {
  test('manual and daily concurrent starts reserve one session, inherit workspace model, and use only enabled selected sources', async () => {
    const deferred = Promise.withResolvers<{ id: string }>(); creationGate = deferred.promise
    const manual = runRadarSweep(owner, 'manual', 'en', 'Radar', current())
    const daily = runRadarSweep(owner, 'daily', 'en', 'Radar', current())
    expect(manual).toBe(daily)
    await new Promise(resolve => setTimeout(resolve, 0)); deferred.resolve({ id: 'shared-run' })
    const sweep = await manual
    expect(await daily).toEqual(sweep)
    expect(calls.filter(call => call.name === 'create')).toHaveLength(1)
    expect(calls.filter(call => call.name === 'send')).toHaveLength(1)
    expect(calls.find(call => call.name === 'create')!.args[1]).toEqual({ name: 'Radar', permissionMode: 'safe', enabledSourceSlugs: ['brave'] })
    expect(sweep.feedItems?.[0]?.source).toBe('Real feed source')
    expect((await runRadarSweep(owner, 'manual', 'en', 'Radar', current())).id).toBe(sweep.id)
    expect(calls.filter(call => call.name === 'create')).toHaveLength(1)
  })
  test('a finished empty response becomes a persisted error and retry creates a new run', async () => {
    seedSweep(); snapshot = { isProcessing: false, messages: [] }
    expect(await syncRadarSweep(owner, 'sweep', current())).toBe('failed')
    expect(loadRadar(owner).sweeps[0]).toMatchObject({ error: 'empty-output', parseFailed: true })
    expect((await runRadarSweep(owner, 'manual', 'en', 'Retry', current())).sessionId).toBe('session-1')
  })
  test('processing remains running; missing and malformed sessions have specific retryable errors', async () => {
    seedSweep(); expect(await syncRadarSweep(owner, 'sweep', current())).toBe('running')
    expect(loadRadar(owner).sweeps[0].parsedAt).toBeUndefined()
    snapshot = null; expect(await syncRadarSweep(owner, 'sweep', current())).toBe('missing')
    expect(loadRadar(owner).sweeps[0].error).toBe('session-missing')
    seedSweep(); snapshot = { messages: [{ role: 'assistant', content: 'No valid JSON result' }] }
    expect(await syncRadarSweep(owner, 'sweep', current())).toBe('failed')
    expect(loadRadar(owner).sweeps[0].error).toBe('invalid-output')
  })
  test('preserves real source dates and buckets; rejects unselected/missing provenance, unsafe URLs and stale items', async () => {
    const originalAt = Date.now() - 60_000
    seedSweep({ feedItems: [{ url: 'https://feed.example.test/news', source: 'Verified feed', at: originalAt }] })
    snapshot = { messages: [{ role: 'assistant', content: JSON.stringify({ items: [
      { title: 'Source result', source: 'Brave', sourceSlug: 'brave', publishedAt: new Date(originalAt).toISOString(), bucket: 'reaction', url: 'https://real.example.test/news' },
      { title: 'Feed result', source: 'Made up', publishedAt: new Date().toISOString(), bucket: 'important', url: 'https://feed.example.test/news' },
      { title: 'No provenance', source: 'Invented', at: originalAt, url: 'https://no.example.test/news' },
      { title: 'Wrong source', source: 'Disabled', sourceSlug: 'disabled', at: originalAt, url: 'https://disabled.example.test/news' },
      { title: 'Unsafe', source: 'Brave', sourceSlug: 'brave', at: originalAt, url: 'https://user:pass@example.test/news' },
      { title: 'Stale', source: 'Brave', sourceSlug: 'brave', at: Date.now() - 48 * 3600_000, url: 'https://old.example.test/news' },
    ] }) }] }
    expect(await syncRadarSweep(owner, 'sweep', current())).toBe('done')
    const sweep = loadRadar(owner).sweeps[0]
    expect(sweep.items?.map(item => item.title)).toEqual(['Source result', 'Feed result'])
    expect(sweep.items?.map(item => item.at)).toEqual([originalAt, originalAt])
    expect(sweep.items?.[1]).toMatchObject({ source: 'Verified feed', bucket: 'important' })
    expect(sweep.error).toBe('unsupported-items')
  })
  test('local-only topic cannot admit agent inventions through a missing sourceSlug', async () => {
    seedSweep({ sourceSlugs: [] }); snapshot = { messages: [{ role: 'assistant', content: JSON.stringify({ items: [{ title: 'Invented', source: 'News', at: Date.now(), url: 'https://fake.example.test' }] }) }] }
    expect(await syncRadarSweep(owner, 'sweep', current())).toBe('done')
    expect(loadRadar(owner).sweeps[0].items).toEqual([])
  })
  test('turning workspace matches off excludes Feed evidence from the agent prompt', async () => {
    const data = base()
    saveRadar(owner, { ...data, topics: data.topics.map(topic => ({ ...topic, includeWorkspace: false, sourceSlugs: [] })) })
    const sweep = await runRadarSweep(owner, 'manual', 'en', 'Radar', current())
    expect(sweep.feedItems).toEqual([])
    expect(sweep.sourceSlugs).toEqual([])
    expect(calls.find(call => call.name === 'send')?.args[1]).not.toContain('Real feed entry')
  })
  test('quota failure cannot report a persisted digest as complete', async () => {
    seedSweep(); snapshot = { messages: [{ role: 'assistant', content: '{"items":[]}' }] }; failStorage = true
    await expect(syncRadarSweep(owner, 'sweep', current())).rejects.toThrow('storage-unavailable')
    expect(loadRadar(owner).sweeps[0].parsedAt).toBeUndefined()
  })
  test('A→B→A generation changes prevent a late created session from receiving a prompt', async () => {
    const deferred = Promise.withResolvers<{ id: string }>(); creationGate = deferred.promise
    const start = runRadarSweep(owner, 'manual', 'en', 'Radar', current())
    await new Promise(resolve => setTimeout(resolve, 0)); owner = 'workspace-B'; generation++; owner = 'workspace-A'; generation++
    deferred.resolve({ id: 'stale-created' })
    await expect(start).rejects.toThrow('workspace-changed')
    expect(calls.filter(call => call.name === 'send')).toEqual([])
  })
  test('late session reads cannot write a digest after a workspace switch', async () => {
    seedSweep(); const deferred = Promise.withResolvers<unknown>(); readGate = deferred.promise
    const sync = syncRadarSweep(owner, 'sweep', current()); await new Promise(resolve => setTimeout(resolve, 0))
    const before = memory.get('rox.radar.v1:workspace-A'); owner = 'workspace-B'; generation++
    deferred.resolve({ messages: [{ role: 'assistant', content: '{"items":[]}' }] })
    await expect(sync).rejects.toThrow('workspace-changed')
    expect(memory.get('rox.radar.v1:workspace-A')).toBe(before)
  })
  test('timeout cancels an old session before another run, and does not repeat cancellation after parsing', async () => {
    seedSweep({ startedAt: Date.now() - 16 * 60_000 })
    expect(await syncRadarSweep(owner, 'sweep', current())).toBe('failed')
    expect(await syncRadarSweep(owner, 'sweep', current())).toBe('failed')
    await runRadarSweep(owner, 'manual', 'en', 'Retry', current())
    expect(calls.map(call => call.name)).toEqual(['cancel', 'create', 'send'])
    expect(loadRadar(owner).sweeps[1].error).toBe('timeout')
  })
  test('retrying an expired run directly cancels it and preserves its terminal history', async () => {
    seedSweep({ startedAt: Date.now() - 16 * 60_000 })
    await runRadarSweep(owner, 'manual', 'en', 'Retry', current())
    expect(calls.map(call => call.name)).toEqual(['cancel', 'create', 'send'])
    expect(loadRadar(owner).sweeps[1]).toMatchObject({ status: 'failed', error: 'timeout', parseFailed: true })
  })
  test('provider startup errors are sanitized and persist a terminal failure', async () => {
    failCreate = true
    await expect(runRadarSweep(owner, 'manual', 'en', 'Radar', current())).rejects.toThrow('start-failed')
    expect(loadRadar(owner).sweeps[0]).toMatchObject({ status: 'failed', error: 'start-failed', parseFailed: true })
    expect(calls.filter(call => call.name === 'send')).toEqual([])
  })
})
