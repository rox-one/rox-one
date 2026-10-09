import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { IntelligenceStore } from '../../db/repositories.ts'
import { handleUnfurlWorkerMessage, unfurlWorkerData } from '../unfurlWorker.ts'
import type { ScannedBrowserProfile, UnfurlWorkerMessage, VisitRecord } from '../../types.ts'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const VISIT: VisitRecord = {
  profileId: 'chromium:Default',
  url: 'https://example.com/r?u=aHR0cHM6Ly9leGFtcGxlLm9yZy9hP3Q9MTc4MzkwMTI0NzkzOA%3D%3D',
  title: null,
  visitTime: 1_700_000_000_000,
  transitionType: null,
  visitDuration: null,
  visitSource: null,
  visitCount: 1,
  typedCount: 0,
  searchQuery: null,
  isBookmark: false,
}

function makePendingStore(): { store: IntelligenceStore; dbPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'bi-worker-host-'))
  tempDirs.push(dir)
  const dbPath = join(dir, 'intelligence.db')
  const store = new IntelligenceStore(dbPath)
  const profile: ScannedBrowserProfile = {
    profileId: VISIT.profileId,
    vendor: 'chrome',
    family: 'chromium',
    displayName: 'Chrome',
    name: 'Default',
    path: join(dir, 'Default'),
    lastUsedAt: null,
    state: 'ok',
    stores: { history: null, bookmarks: null, places: null, cookies: null },
  }
  store.upsertProfiles([profile])
  store.insertVisits([VISIT])
  return { store, dbPath }
}

describe('unfurl worker host boundary', () => {
  test('workerData keeps only the structured-cloneable knobs', () => {
    // Mirrors the production options bag an in-process runner receives: a live
    // store handle must never reach `new Worker` (DataCloneError on Node).
    const store = { liveHandle: true }
    const data = unfurlWorkerData('C:/intelligence.db', {
      batchSize: 100,
      maxBatches: 2,
      onProgress: () => {},
      signal: new AbortController().signal,
      store,
    } as never)

    expect(data.dbPath).toBe('C:/intelligence.db')
    expect(data.options).toEqual({ batchSize: 100, maxBatches: 2 })
    expect('store' in data.options).toBe(false)
    expect(() => structuredClone(data)).not.toThrow()
  })

  test('the worker-side protocol runs the loop and posts progress then done', async () => {
    const { store, dbPath } = makePendingStore()
    try {
      const posted: UnfurlWorkerMessage[] = []
      await handleUnfurlWorkerMessage(
        { type: 'start', dbPath, options: { batchSize: 10, batchDelayMs: 0, maxBatches: 1 } },
        { post: (message) => posted.push(message), dbPathFromWorkerData: () => undefined },
      )

      expect(posted.some((message) => message.type === 'progress')).toBe(true)
      const done = posted.at(-1)
      expect(done?.type).toBe('done')
      if (done?.type !== 'done') throw new Error('worker did not post a done message')
      expect(done.outcome.processed).toBeGreaterThanOrEqual(1)

      // The decoded URL is persisted as a graph the main process can read.
      const row = store.db.prepare('SELECT COUNT(*) AS total FROM unfurl_details').get() as {
        total: number | bigint
      }
      expect(Number(row.total)).toBe(1)
    } finally {
      store.close()
    }
  })

  test('a start without a resolvable dbPath reports an error instead of throwing', async () => {
    const posted: UnfurlWorkerMessage[] = []
    await handleUnfurlWorkerMessage(
      { type: 'start', dbPath: '' },
      { post: (message) => posted.push(message), dbPathFromWorkerData: () => undefined },
    )
    expect(posted).toEqual([{ type: 'error', message: 'unfurl worker was started without a dbPath' }])
  })
})