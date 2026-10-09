import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { IntelligenceStore } from '../../db/repositories.ts'
import { PROFILE_SLOT_IDS, type ScannedBrowserProfile, type SynthesisCompletion } from '../../types.ts'
import { buildSynthesisPrompt, synthesizeSlots } from '../synthesis.ts'

const DAY_MS = 86_400_000
const PROFILE_ID = 'chromium:/tmp/synthesis-profile'

function seedStore(store: IntelligenceStore): void {
  const now = Date.now()
  const profile: ScannedBrowserProfile = {
    profileId: PROFILE_ID,
    vendor: 'chrome',
    family: 'chromium',
    displayName: 'Chrome',
    name: 'Default',
    path: '/tmp/synthesis-profile',
    lastUsedAt: null,
    state: 'ok',
    stores: { history: null, bookmarks: null, places: null, cookies: null },
  }
  store.upsertProfiles([profile], now)
  store.insertVisits(
    [
      {
        profileId: PROFILE_ID,
        url: 'https://github.com/rox/one',
        title: 'rox/one',
        visitTime: now - 1 * DAY_MS,
        transitionType: 'link',
        visitDuration: 60_000,
        visitSource: null,
        visitCount: null,
        typedCount: null,
        isBookmark: true,
        searchQuery: 'typescript error ts2345',
      },
      {
        profileId: PROFILE_ID,
        url: 'https://youtube.com/watch?v=abc',
        title: null,
        visitTime: now - 2 * DAY_MS,
        transitionType: 'link',
        visitDuration: 30_000,
        visitSource: null,
        visitCount: null,
        typedCount: null,
        isBookmark: false,
        searchQuery: null,
      },
    ],
    now,
  )
}

function makeStore(): { store: IntelligenceStore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'browser-intel-synthesis-'))
  const store = new IntelligenceStore(join(dir, 'intelligence.db'))
  seedStore(store)
  return { store, dir }
}

function dispose(store: IntelligenceStore, dir: string): void {
  store.close()
  rmSync(dir, { recursive: true, force: true })
}

const FENCED_REPLY = [
  'Sure — here is the profile:',
  '```json',
  JSON.stringify({
    tech_stack: { value: { families: ['developer tooling'] }, confidence: 0.9, evidence: ['github.com (1 visits)'] },
    pain_points_acute: { value: { queries: ['typescript error ts2345'] }, confidence: 0.8, evidence: ['search "typescript error ts2345"'] },
    communication_archetype: { value: 'latin-dominant', confidence: 0.7, evidence: ['search queries sampled: 1'] },
    humor_slots: { value: { domains: ['youtube.com'] }, confidence: 0.6, evidence: ['youtube.com (1 visits)'] },
    steer_policy: { value: 'concise-direct', confidence: 0.5, evidence: ['activity window: 30 days'] },
  }),
  '```',
  'That should be everything.',
].join('\n')

describe('buildSynthesisPrompt', () => {
  test('describes the five slot keys and embeds metrics + candidates', () => {
    const { store, dir } = makeStore()
    try {
      const { system, prompt } = buildSynthesisPrompt({
        generatedAt: 0,
        windowDays: 30,
        totalVisits: 1,
        totalUrls: 1,
        totalDomains: 1,
        totalBookmarks: 0,
        totalSearches: 1,
        totalDurationMs: 0,
        activeDays: 1,
        firstVisitAt: null,
        lastVisitAt: null,
        hourlyHistogram: new Array<number>(24).fill(0),
        weekdayHistogram: new Array<number>(7).fill(0),
        topDomains: [{ domain: 'github.com', visits: 1, bookmarkCount: 0 }],
        topSearches: [{ query: 'deploy error', count: 1 }],
        topBookmarks: [],
        daily: [],
        monthly: [],
        candidates: [{ slot: 'tech_stack', value: { families: ['developer tooling'] }, confidence: 0.5, evidence: ['github.com (1 visits)'] }],
      })
      for (const slot of PROFILE_SLOT_IDS) expect(system).toContain(slot)
      expect(prompt).toContain('github.com')
      expect(prompt).toContain('deploy error')
      expect(prompt).toContain('tech_stack')
    } finally {
      dispose(store, dir)
    }
  })
})

describe('synthesizeSlots', () => {
  test('degrades to deterministic candidates when no completion is supplied', async () => {
    const { store, dir } = makeStore()
    try {
      const result = await synthesizeSlots({ store })
      expect(result.degraded).toBe(true)
      expect(result.raw).toBeNull()
      expect(result.model).toBeNull()
      expect(result.slots.length).toBeGreaterThan(0)
      expect(result.slots.map((slot) => slot.slot)).toEqual([...PROFILE_SLOT_IDS])

      const persisted = store.readSlots()
      expect(persisted.map((slot) => slot.slot).sort()).toEqual([...PROFILE_SLOT_IDS].sort())
      for (const slot of persisted) {
        expect(slot.confidence).toBeGreaterThanOrEqual(0)
        expect(slot.confidence).toBeLessThanOrEqual(1)
      }
    } finally {
      dispose(store, dir)
    }
  })

  test('parses fenced model JSON, merges it over candidates and stamps the model', async () => {
    const { store, dir } = makeStore()
    try {
      const completion: SynthesisCompletion = async () => FENCED_REPLY
      const first = await synthesizeSlots({ store, completion, model: 'test-model' })
      expect(first.degraded).toBe(false)
      expect(first.errors).toEqual([])
      expect(first.raw).toBe(FENCED_REPLY)

      const tech = store.readSlots().find((slot) => slot.slot === 'tech_stack')
      expect(tech?.model).toBe('test-model')
      expect(tech?.confidence).toBeCloseTo(0.9, 5)
      expect(tech?.version).toBe(1)

      const second = await synthesizeSlots({ store, completion, model: 'test-model' })
      expect(second.degraded).toBe(false)
      const techAfter = store.readSlots().find((slot) => slot.slot === 'tech_stack')
      expect(techAfter?.version).toBe(2)
    } finally {
      dispose(store, dir)
    }
  })

  test('collects completion errors and still persists the deterministic candidates', async () => {
    const { store, dir } = makeStore()
    try {
      const completion: SynthesisCompletion = async () => {
        throw new Error('model offline')
      }
      const result = await synthesizeSlots({ store, completion, model: 'test-model' })
      expect(result.degraded).toBe(true)
      expect(result.errors.length).toBeGreaterThan(0)
      expect(result.errors.join(' ')).toContain('model offline')

      const persisted = store.readSlots()
      expect(persisted.map((slot) => slot.slot).sort()).toEqual([...PROFILE_SLOT_IDS].sort())
      expect(persisted.every((slot) => slot.model === null)).toBe(true)
    } finally {
      dispose(store, dir)
    }
  })

  test('tolerates prose without JSON and keeps candidates', async () => {
    const { store, dir } = makeStore()
    try {
      const completion: SynthesisCompletion = async () => 'I could not produce JSON today.'
      const result = await synthesizeSlots({ store, completion, model: 'test-model' })
      expect(result.degraded).toBe(true)
      expect(result.errors.length).toBeGreaterThan(0)
      expect(store.hasSlots()).toBe(true)
    } finally {
      dispose(store, dir)
    }
  })
})