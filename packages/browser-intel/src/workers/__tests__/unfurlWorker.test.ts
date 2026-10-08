import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { IntelligenceStore } from '../../db/repositories.ts'
import {
  DEFAULT_UNFURL_BATCH_DELAY_MS,
  DEFAULT_UNFURL_BATCH_SIZE,
  DEFAULT_UNFURL_MAX_BATCH_DELAY_MS,
  DEFAULT_UNFURL_TARGET_CPU_SHARE,
  runUnfurlBatches,
  type CpuUsage,
  type UnfurlProgressDetail,
} from '../unfurlWorker.ts'
import type { UnfurlGraph } from '../../types.ts'

const tempDirs: string[] = []

function makeStore(): { store: IntelligenceStore; dbPath: string; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'bi-unfurl-'))
  tempDirs.push(dir)
  const dbPath = join(dir, 'intelligence.db')
  return { store: new IntelligenceStore(dbPath), dbPath, dir }
}

function count(store: IntelligenceStore, sql: string, ...bindings: Array<string | number>): number {
  const row = store.db.prepare(sql).get(...bindings) as { total: number | bigint } | undefined
  return Number(row?.total ?? 0)
}

function bulkUrls(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `https://example.com/page/${index}?x=${index}`)
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('unfurlWorker defaults', () => {
  test('uses a batch size of 100 and a 150ms inter-batch delay', async () => {
    const claimed: number[] = []
    const delays: number[] = []
    let calls = 0
    const fake = {
      claimPendingUrls: (limit: number) => {
        claimed.push(limit)
        calls += 1
        return calls === 1
          ? [{ id: 1, url: 'https://example.com/', host: 'example.com', domain: 'example.com', attempts: 0 }]
          : []
      },
      saveUnfurl: () => {},
      failUnfurl: () => {},
      countPendingUrls: () => 0,
      close: () => {},
    } as unknown as IntelligenceStore

    await runUnfurlBatches({
      dbPath: ':memory:',
      store: fake,
      cpuUsage: () => ({ user: 0, system: 0 }),
      sleep: async (ms) => {
        delays.push(ms)
      },
    })

    expect(DEFAULT_UNFURL_BATCH_SIZE).toBe(100)
    expect(DEFAULT_UNFURL_BATCH_DELAY_MS).toBe(150)
    expect(DEFAULT_UNFURL_TARGET_CPU_SHARE).toBe(0.15)
    expect(DEFAULT_UNFURL_MAX_BATCH_DELAY_MS).toBe(5000)
    expect(claimed[0]).toBe(100)
    expect(delays).toEqual([150])
  })
})

describe('runUnfurlBatches adaptive throttle', () => {
  const row = { id: 1, url: 'https://example.com/', host: 'example.com', domain: 'example.com', attempts: 0 }

  function oneBatchStore(): IntelligenceStore {
    let calls = 0
    return {
      claimPendingUrls: () => {
        calls += 1
        return calls === 1 ? [row] : []
      },
      saveUnfurl: () => {},
      failUnfurl: () => {},
      countPendingUrls: () => 0,
      close: () => {},
    } as unknown as IntelligenceStore
  }

  /** First call is the pre-batch sample, the second the post-batch sample. */
  function meter(before: CpuUsage, after: CpuUsage): () => CpuUsage {
    let call = 0
    return () => {
      call += 1
      return call === 1 ? before : after
    }
  }

  test('sleeps max(floor, cpuMs * (1/share - 1)) for a busy batch', async () => {
    const delays: number[] = []
    const progress: UnfurlProgressDetail[] = []
    await runUnfurlBatches({
      dbPath: ':memory:',
      store: oneBatchStore(),
      targetCpuShare: 0.15,
      cpuUsage: meter({ user: 0, system: 0 }, { user: 80_000, system: 0 }),
      sleep: async (ms) => {
        delays.push(ms)
      },
      onProgress: (update) => progress.push(update as UnfurlProgressDetail),
    })

    const expected = 80 * (1 / 0.15 - 1)
    expect(delays).toHaveLength(1)
    expect(delays[0]).toBeCloseTo(expected, 1)
    expect(progress).toHaveLength(1)
    expect(progress[0].throttleMs).toBeCloseTo(expected, 1)
  })

  test('respects the 150ms floor for a cheap batch', async () => {
    const delays: number[] = []
    await runUnfurlBatches({
      dbPath: ':memory:',
      store: oneBatchStore(),
      targetCpuShare: 0.15,
      cpuUsage: meter({ user: 0, system: 0 }, { user: 5_000, system: 0 }),
      sleep: async (ms) => {
        delays.push(ms)
      },
    })
    expect(delays).toEqual([150])
  })

  test('targetCpuShare 0 restores the fixed delay', async () => {
    const delays: number[] = []
    await runUnfurlBatches({
      dbPath: ':memory:',
      store: oneBatchStore(),
      targetCpuShare: 0,
      cpuUsage: meter({ user: 0, system: 0 }, { user: 2_000_000, system: 0 }),
      sleep: async (ms) => {
        delays.push(ms)
      },
    })
    expect(delays).toEqual([150])
  })

  test('clamps the computed sleep to maxBatchDelayMs', async () => {
    const delays: number[] = []
    await runUnfurlBatches({
      dbPath: ':memory:',
      store: oneBatchStore(),
      targetCpuShare: 0.15,
      maxBatchDelayMs: 400,
      cpuUsage: meter({ user: 0, system: 0 }, { user: 2_000_000, system: 0 }),
      sleep: async (ms) => {
        delays.push(ms)
      },
    })
    expect(delays).toEqual([400])
  })
})

describe('runUnfurlBatches', () => {
  test('unfurls every pending URL and persists a graph for each', async () => {
    const { store, dbPath } = makeStore()
    try {
      const urls = bulkUrls(250)
      store.upsertUrls(urls)
      expect(store.countPendingUrls()).toBe(250)

      const outcome = await runUnfurlBatches({ dbPath, store, batchSize: 100, batchDelayMs: 0, targetCpuShare: 0 })

      expect(outcome.batches).toBe(3)
      expect(outcome.processed).toBe(250)
      expect(outcome.failed).toBe(0)
      expect(outcome.pendingRemaining).toBe(0)

      expect(count(store, "SELECT COUNT(*) AS total FROM dim_urls WHERE unfurl_status = 'done'")).toBe(250)
      expect(store.countPendingUrls()).toBe(0)
      expect(count(store, 'SELECT COUNT(*) AS total FROM unfurl_details')).toBe(250)

      const rows = store.db.prepare('SELECT graph_json FROM unfurl_details ORDER BY url_id LIMIT 5').all() as Array<{
        graph_json: string
      }>
      for (const row of rows) {
        const graph = JSON.parse(row.graph_json) as UnfurlGraph
        expect(graph.nodes.length).toBeGreaterThan(0)
        expect(graph.nodes[0].id).toBe('1')
        expect(graph.edges.length).toBe(graph.nodes.length - 1)
      }
    } finally {
      store.close()
    }
  })

  test('parks a poison URL as error while the rest still complete', async () => {
    const { store, dbPath } = makeStore()
    try {
      store.upsertUrls(bulkUrls(249))
      // `http://[` is rejected by describeUrl, so `upsertUrls` cannot enqueue it;
      // insert it directly to exercise the decode-error path.
      store.db
        .prepare(
          `INSERT INTO dim_urls (url, raw_url, unfurl_status, first_seen_at, last_seen_at)
           VALUES (?, ?, 'pending', ?, ?)`,
        )
        .run('http://[', 'http://[', Date.now(), Date.now())

      expect(store.countPendingUrls()).toBe(250)

      const outcome = await runUnfurlBatches({ dbPath, store, batchSize: 100, batchDelayMs: 0, targetCpuShare: 0 })

      expect(outcome.processed).toBe(250)
      expect(outcome.failed).toBe(1)
      expect(outcome.pendingRemaining).toBe(0)

      const poison = store.db.prepare('SELECT unfurl_status, unfurl_error FROM dim_urls WHERE url = ?').get('http://[') as {
        unfurl_status: string
        unfurl_error: string | null
      }
      expect(poison.unfurl_status).toBe('error')
      expect(poison.unfurl_error).not.toBeNull()

      expect(count(store, "SELECT COUNT(*) AS total FROM dim_urls WHERE unfurl_status = 'done'")).toBe(249)
    } finally {
      store.close()
    }
  })
})