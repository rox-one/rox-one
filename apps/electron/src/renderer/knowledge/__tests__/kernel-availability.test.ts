/**
 * kernel-availability.test.ts — tab-switch fast path for the Knowledge mode.
 *
 * Proves the fixed path no longer blocks when the SiYuan kernel is absent or
 * slow: a hanging backend resolves fast as unavailable, repeat tab switches
 * reuse the cached verdict without touching the backend, concurrent mounts
 * share one probe, and the navigator skips all ~21 kernel RPCs
 * (listNotebooks + per-envelope get) on the known-absent path while still
 * reading local stores (views/envelopes).
 */
import { describe, expect, it, beforeEach } from 'bun:test'
import {
  getKernelAvailability,
  isKernelKnownUnavailable,
  __resetKernelAvailabilityForTests,
  type KernelAvailabilityProbe,
} from '../kernel-availability'
import {
  loadKnowledgeNavigatorData,
  type KnowledgeNavigatorApi,
} from '../KnowledgeNotebookTree'

const tick = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function hangingProbe(): KernelAvailabilityProbe & { calls: number } {
  const state = { calls: 0 }
  return {
    calls: 0,
    async engineStatus() {
      state.calls += 1
      // Expose the counter through the returned object.
      ;(this as unknown as { calls: number }).calls = state.calls
      await tick(60_000)
      return { running: true }
    },
  }
}

function scriptedProbe(
  verdicts: Array<{ running: boolean; version?: string }>,
  delayMs = 0,
): KernelAvailabilityProbe & { calls: number } {
  let calls = 0
  const probe: KernelAvailabilityProbe & { calls: number } = {
    calls: 0,
    async engineStatus() {
      calls += 1
      probe.calls = calls
      if (delayMs > 0) await tick(delayMs)
      const verdict = verdicts[Math.min(calls - 1, verdicts.length - 1)]!
      return { ...verdict }
    },
  }
  return probe
}

beforeEach(() => {
  __resetKernelAvailabilityForTests()
})

describe('getKernelAvailability', () => {
  it('fast-fails a hanging backend within the renderer budget', async () => {
    const api = hangingProbe()
    const started = Date.now()
    const verdict = await getKernelAvailability(api, { timeoutMs: 25 })
    const elapsed = Date.now() - started
    expect(verdict.running).toBe(false)
    expect(elapsed).toBeLessThan(5_000)
  })

  it('dedupes concurrent mounts into a single backend probe', async () => {
    const api = scriptedProbe([{ running: false }], 30)
    const [a, b, c] = await Promise.all([
      getKernelAvailability(api, { timeoutMs: 2_000 }),
      getKernelAvailability(api, { timeoutMs: 2_000 }),
      getKernelAvailability(api, { timeoutMs: 2_000 }),
    ])
    expect(api.calls).toBe(1)
    expect(a.running).toBe(false)
    expect(b.running).toBe(false)
    expect(c.running).toBe(false)
  })

  it('serves repeat tab switches from cache without touching the backend', async () => {
    const api = scriptedProbe([{ running: false }], 5)
    const first = await getKernelAvailability(api, { timeoutMs: 2_000, ttlMs: 30_000 })
    expect(first.running).toBe(false)
    expect(api.calls).toBe(1)
    expect(isKernelKnownUnavailable()).toBe(true)

    const started = Date.now()
    const second = await getKernelAvailability(api, { timeoutMs: 2_000, ttlMs: 30_000 })
    const elapsed = Date.now() - started
    expect(second.running).toBe(false)
    expect(api.calls).toBe(1)
    expect(elapsed).toBeLessThan(100)
  })

  it('re-probes after the TTL expires', async () => {
    let now = 1_000_000
    const api = scriptedProbe([{ running: false }, { running: true, version: '3.1.0' }])
    const first = await getKernelAvailability(api, {
      timeoutMs: 2_000,
      ttlMs: 1_000,
      now: () => now,
    })
    expect(first.running).toBe(false)
    now += 1_001
    const second = await getKernelAvailability(api, {
      timeoutMs: 2_000,
      ttlMs: 1_000,
      now: () => now,
    })
    expect(api.calls).toBe(2)
    expect(second.running).toBe(true)
    expect(second.version).toBe('3.1.0')
  })

  it('treats backend errors as unavailable instead of throwing', async () => {
    const api: KernelAvailabilityProbe = {
      async engineStatus() {
        throw new Error('ECONNREFUSED 127.0.0.1:6806')
      },
    }
    const verdict = await getKernelAvailability(api, { timeoutMs: 2_000 })
    expect(verdict.running).toBe(false)
  })
})

describe('loadKnowledgeNavigatorData skipKernelReads', () => {
  function slowKernelApi(): KnowledgeNavigatorApi & { kernelCalls: number } {
    let kernelCalls = 0
    const api: KnowledgeNavigatorApi & { kernelCalls: number } = {
      kernelCalls: 0,
      async listConnections() {
        return [{ id: 'conn-1' }]
      },
      async listNotebooks() {
        kernelCalls += 1
        api.kernelCalls = kernelCalls
        await tick(60_000)
        return []
      },
      async viewsList() {
        return []
      },
      async envelopeList() {
        return [
          {
            knowledgeRef: { scheme: 'siyuan', kind: 'document', id: 'doc-1' },
            createdAt: 100,
            updatedAt: 300,
          },
          {
            knowledgeRef: { scheme: 'siyuan', kind: 'document', id: 'doc-2' },
            createdAt: 100,
            updatedAt: 200,
          },
        ]
      },
      async get() {
        kernelCalls += 1
        api.kernelCalls = kernelCalls
        await tick(60_000)
        throw new Error('unreachable')
      },
    }
    return api
  }

  it('resolves fast with unavailable notebooks and zero kernel RPCs', async () => {
    const api = slowKernelApi()
    const started = Date.now()
    const data = await loadKnowledgeNavigatorData(api, { skipKernelReads: true })
    const elapsed = Date.now() - started
    expect(data.notebooks).toEqual({ status: 'unavailable', items: [] })
    expect(api.kernelCalls).toBe(0)
    expect(elapsed).toBeLessThan(5_000)
    // Local stores still load: envelopes render without kernel title lookups.
    expect(data.recent).toHaveLength(2)
    expect(data.recent[0]?.envelope.knowledgeRef.id).toBe('doc-1')
    expect(data.recent[0]?.title).toBeUndefined()
    expect(data.favorites).toHaveLength(0)
  })

  it('still hits the kernel when not skipping (documents the old cost)', async () => {
    const api: KnowledgeNavigatorApi = {
      async listConnections() {
        return [{ id: 'conn-1' }]
      },
      async listNotebooks() {
        return [{ id: 'nb-1', name: 'Research', icon: '', closed: false }]
      },
      async viewsList() {
        return []
      },
      async envelopeList() {
        return []
      },
    }
    const data = await loadKnowledgeNavigatorData(api)
    expect(data.notebooks.status).toBe('ok')
    expect(data.notebooks.items).toHaveLength(1)
  })
})
