import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { IntelligenceStore } from '../../db/repositories.ts'
import { resolveBrowserIntelPaths } from '../../paths.ts'
import { COGNITIVE_PROFILE_BASENAME, DEFAULT_MIN_CONFIDENCE, buildCognitiveProfileBlock, clearCognitiveProfileCache, readCognitiveProfileCache, writeCognitiveProfileCache } from '../cognitiveProfile.ts'
import type { ProfileSlotRecord } from '../../types.ts'

function slot(slotId: string, value: unknown, confidence: number, evidence: unknown[] = ['ev']): ProfileSlotRecord {
  return { slot: slotId, value, confidence, evidence, updatedAt: 0, version: 1, model: null }
}

function fullSet(confidence = 0.8): ProfileSlotRecord[] {
  return [
    slot('tech_stack', { families: ['developer tooling'] }, confidence, ['github.com (4 visits)']),
    slot('pain_points_acute', { queries: ['deploy error'] }, confidence, ['search "deploy error" ×2']),
    slot('communication_archetype', 'latin-dominant', confidence, ['cyrillic share: 0%']),
    slot('humor_slots', { domains: ['youtube.com'] }, confidence, ['youtube.com (3 visits)']),
    slot('steer_policy', 'concise-direct', confidence, ['activity window: 30 days']),
  ]
}

describe('buildCognitiveProfileBlock', () => {
  test('renders the tags and one line per slot in canonical order', () => {
    const block = buildCognitiveProfileBlock(fullSet())
    expect(block.block.startsWith('<user_cognitive_profile>\n')).toBe(true)
    expect(block.block.endsWith('\n</user_cognitive_profile>')).toBe(true)
    expect(block.block.split('\n')).toHaveLength(7) // open + 5 lines + close
    for (const line of ['tech_stack', 'pain_points_acute', 'communication_archetype', 'humor_slots', 'steer_policy']) {
      expect(block.block).toContain(`- ${line}:`)
    }
    // Non-string values are JSON-stringified.
    expect(block.block).toContain('{"families":["developer tooling"]}')
    expect(block.slots).toHaveLength(5)
    expect(block.tokensEstimate).toBe(Math.ceil(block.block.length / 4))
  })

  test('omits slots below the confidence gate', () => {
    const slots = fullSet(0.9).map((record) =>
      record.slot === 'humor_slots' ? { ...record, confidence: DEFAULT_MIN_CONFIDENCE - 0.1 } : record,
    )
    const block = buildCognitiveProfileBlock(slots)
    expect(block.block).not.toContain('- humor_slots:')
    expect(block.block).toContain('- tech_stack:')
    expect(block.slots.map((record) => record.slot)).not.toContain('humor_slots')
  })

  test('trims under maxChars, dropping the lowest-confidence slots first', () => {
    const slots = fullSet().map((record, index) => ({
      ...record,
      value: `x${index}`.repeat(300),
    }))
    const block = buildCognitiveProfileBlock(slots, { maxChars: 400 })
    expect(block.block.length).toBeLessThanOrEqual(400)
    expect(block.block).toContain('…')
    expect(block.slots.length).toBeLessThanOrEqual(1)
  })
})

describe('cognitive profile cache', () => {
  test('writes, reads and clears the block through a temp config dir', () => {
    const dir = mkdtempSync(join(tmpdir(), 'browser-intel-profile-'))
    const paths = resolveBrowserIntelPaths(dir)
    const store = new IntelligenceStore(join(dir, 'intelligence.db'))
    try {
      store.upsertSlots(fullSet(), Date.now())
      const block = writeCognitiveProfileCache(store, paths)
      expect(block.block.length).toBeGreaterThan(0)

      const target = join(paths.intelligenceDir, COGNITIVE_PROFILE_BASENAME)
      expect(statSync(target).mode & 0o777).toBe(0o600)
      expect(readCognitiveProfileCache(paths)).toBe(block.block)

      clearCognitiveProfileCache(paths)
      expect(readCognitiveProfileCache(paths)).toBe('')
    } finally {
      store.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('returns an empty string for a missing cache file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'browser-intel-profile-empty-'))
    try {
      expect(readCognitiveProfileCache(resolveBrowserIntelPaths(dir))).toBe('')
      clearCognitiveProfileCache(resolveBrowserIntelPaths(dir)) // no-op, must not throw
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})