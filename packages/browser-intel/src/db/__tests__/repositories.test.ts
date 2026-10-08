import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { IntelligenceStore } from '../repositories.ts'
import type { ScannedBrowserProfile, VisitRecord } from '../../types.ts'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function openStore(): { store: IntelligenceStore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'bi-db-'))
  tempDirs.push(dir)
  return { store: new IntelligenceStore(join(dir, 'intelligence.db')), dir }
}

function profileFor(dir: string): ScannedBrowserProfile {
  return {
    profileId: 'chromium:Default',
    vendor: 'chrome',
    family: 'chromium',
    displayName: 'Chrome',
    name: 'Default',
    path: join(dir, 'Default'),
    lastUsedAt: null,
    state: 'ok',
    stores: { history: null, bookmarks: null, places: null, cookies: null },
  }
}

function visit(): VisitRecord {
  return {
    profileId: 'chromium:Default',
    url: 'https://example.com/page',
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
}

describe('intelligence database', () => {
  test('opens with WAL journaling and NORMAL synchronous mode', () => {
    const { store } = openStore()
    try {
      const mode = store.db.prepare('PRAGMA journal_mode').get() as { journal_mode: string }
      expect(String(mode.journal_mode).toLowerCase()).toBe('wal')
      const sync = store.db.prepare('PRAGMA synchronous').get() as { synchronous: number | bigint }
      // NORMAL is 1; FULL would be 2.
      expect(Number(sync.synchronous)).toBe(1)
    } finally {
      store.close()
    }
  })

  test('re-ingesting the same visit with a missing transition is idempotent', () => {
    const { store, dir } = openStore()
    try {
      store.upsertProfiles([profileFor(dir)])

      expect(store.insertVisits([visit()]).inserted).toBe(1)
      expect(store.insertVisits([visit()]).inserted).toBe(0)

      const row = store.db.prepare('SELECT COUNT(*) AS total FROM fact_visits').get() as {
        total: number | bigint
      }
      expect(Number(row.total)).toBe(1)
      const stored = store.db.prepare('SELECT transition_type FROM fact_visits').get() as {
        transition_type: string
      }
      expect(stored.transition_type).toBe('')
    } finally {
      store.close()
    }
  })
})