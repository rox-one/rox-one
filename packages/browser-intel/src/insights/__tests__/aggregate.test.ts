import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { IntelligenceStore } from '../../db/repositories.ts'
import { PROFILE_SLOT_IDS, type ScannedBrowserProfile, type VisitRecord } from '../../types.ts'
import { aggregateMetrics, deriveSlotCandidates } from '../aggregate.ts'

const DAY_MS = 86_400_000

function makeProfile(): ScannedBrowserProfile {
  return {
    profileId: 'chromium:/tmp/fixture-profile',
    vendor: 'chrome',
    family: 'chromium',
    displayName: 'Chrome',
    name: 'Default',
    path: '/tmp/fixture-profile',
    lastUsedAt: null,
    state: 'ok',
    stores: { history: null, bookmarks: null, places: null, cookies: null },
  }
}

function visit(overrides: Partial<VisitRecord> & Pick<VisitRecord, 'url' | 'visitTime'>): VisitRecord {
  return {
    profileId: makeProfile().profileId,
    title: null,
    transitionType: 'link',
    visitDuration: null,
    visitSource: null,
    visitCount: null,
    typedCount: null,
    isBookmark: false,
    searchQuery: null,
    ...overrides,
  }
}

function createFixtureStore(): { store: IntelligenceStore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'browser-intel-aggregate-'))
  const store = new IntelligenceStore(join(dir, 'intelligence.db'))
  const now = Date.now()
  store.upsertProfiles([makeProfile()], now)
  store.insertVisits(
    [
      // day 1: a developer bookmark with real dwell time
      visit({
        url: 'https://github.com/rox/one',
        title: 'rox/one',
        visitTime: now - 1 * DAY_MS,
        visitDuration: 60_000,
        isBookmark: true,
      }),
      // day 2: a problem search, English
      visit({
        url: 'https://github.com/issues',
        visitTime: now - 2 * DAY_MS,
        visitDuration: 30_000,
        searchQuery: 'typescript error ts2345',
      }),
      // day 3: a problem search, Cyrillic (also entertainment domain visit)
      visit({
        url: 'https://youtube.com/watch?v=abc',
        visitTime: now - 3 * DAY_MS,
        visitDuration: 120_000,
        searchQuery: 'не работает сборка',
      }),
      // day 3: an unmeasured visit
      visit({ url: 'https://example.com/', visitTime: now - 3 * DAY_MS + 60_000 }),
    ],
    now,
  )
  return { store, dir }
}

describe('aggregateMetrics', () => {
  test('computes exact totals, histogram shapes and top lists from seeded facts', () => {
    const { store, dir } = createFixtureStore()
    try {
      const metrics = aggregateMetrics(store, { now: Date.now() })

      expect(metrics.totalVisits).toBe(4)
      expect(metrics.totalUrls).toBe(4)
      expect(metrics.totalDomains).toBe(3)
      expect(metrics.totalBookmarks).toBe(1)
      expect(metrics.totalSearches).toBe(2)
      expect(metrics.totalDurationMs).toBe(210_000)
      expect(metrics.activeDays).toBe(3)

      expect(metrics.hourlyHistogram).toHaveLength(24)
      expect(metrics.hourlyHistogram.reduce((a, b) => a + b, 0)).toBe(4)
      expect(metrics.weekdayHistogram).toHaveLength(7)
      expect(metrics.weekdayHistogram.reduce((a, b) => a + b, 0)).toBe(4)

      expect(metrics.topDomains[0]?.domain).toBe('github.com')
      expect(metrics.topDomains[0]?.visits).toBe(2)
      expect(metrics.topSearches[0]?.query).toBe('typescript error ts2345')

      expect(metrics.topBookmarks).toHaveLength(1)
      expect(metrics.topBookmarks[0]?.url).toBe('https://github.com/rox/one')
      expect(metrics.topBookmarks[0]?.visits).toBe(1)
    } finally {
      store.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('derives one candidate per canonical slot with bounded confidence and quoted evidence', () => {
    const { store, dir } = createFixtureStore()
    try {
      const metrics = aggregateMetrics(store, { now: Date.now() })
      const candidates = deriveSlotCandidates(metrics)

      expect(candidates.map((candidate) => candidate.slot)).toEqual([...PROFILE_SLOT_IDS])
      for (const candidate of candidates) {
        expect(candidate.confidence).toBeGreaterThanOrEqual(0)
        expect(candidate.confidence).toBeLessThanOrEqual(1)
        expect(Array.isArray(candidate.evidence)).toBe(true)
        expect(candidate.evidence.length).toBeGreaterThanOrEqual(1)
        expect(candidate.evidence.length).toBeLessThanOrEqual(5)
        for (const line of candidate.evidence) expect(typeof line).toBe('string')
      }

      const tech = candidates.find((candidate) => candidate.slot === 'tech_stack')
      expect(JSON.stringify(tech?.evidence)).toContain('github.com')
      const humor = candidates.find((candidate) => candidate.slot === 'humor_slots')
      expect(JSON.stringify(humor?.evidence)).toContain('youtube.com')
    } finally {
      store.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('does not invent candidates when there is nothing to aggregate', () => {
    const dir = mkdtempSync(join(tmpdir(), 'browser-intel-aggregate-empty-'))
    const store = new IntelligenceStore(join(dir, 'intelligence.db'))
    try {
      const metrics = aggregateMetrics(store, { now: Date.now() })
      expect(metrics.totalVisits).toBe(0)
      const slots = deriveSlotCandidates(metrics).map((candidate) => candidate.slot)
      // Only the fixed conservative default survives an empty store.
      expect(slots).toEqual(['steer_policy'])
    } finally {
      store.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})