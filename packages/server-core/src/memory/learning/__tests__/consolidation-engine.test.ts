/**
 * ConsolidationEngine tests (PRD §10 Job 2 / §12 Job 4).
 *
 * The engine is pure: no clock, no fs, no LLM. Covers deterministic candidate
 * identity (`consolidationKey`), merging repeated corrections into ONE draft,
 * collision of differently-cased/whitespaced phrasings onto one normalized key,
 * singleton dropping, the `knownFingerprints` skip, and the class wrapper.
 */
import { describe, expect, it } from 'bun:test'
import { normalizeHypothesis, type LearningObservation, type UserCorrection } from '@rox/shared/memory/learning'
import type { DetectedPattern } from '../learning-types'
import {
  DEFAULT_CONSOLIDATION_MIN_OCCURRENCES,
  ConsolidationEngine,
  consolidateObservations,
  consolidationKey,
} from '../ConsolidationEngine'

function correction(over: Partial<UserCorrection> & Pick<UserCorrection, 'id' | 'original' | 'corrected'>): UserCorrection {
  return {
    sessionId: 's1',
    category: 'workflow',
    confidence: 0.9,
    ts: '2026-10-01T10:00:00.000Z',
    ...over,
  }
}

function observation(id: string, sessionId: string, corrections: UserCorrection[]): LearningObservation {
  return {
    id,
    sessionId,
    workspaceId: 'workspace-1',
    ts: '2026-10-01T10:00:00.000Z',
    execution: { tools: [], skills: [], models: [], delegated: false },
    outcome: { status: 'success' },
    signals: { userCorrections: corrections, errors: [], branches: 0, interruptions: 0 },
    memory: { lessonsInjected: [], episodesRecalled: [], skillsInjected: [] },
    artifacts: { filesChanged: 0 },
  }
}

const KEY = `correction:${normalizeHypothesis('use npm install→use pnpm add')}`

describe('consolidationKey', () => {
  it('is the pattern key verbatim and stable across calls', () => {
    const pattern: DetectedPattern = {
      key: KEY,
      occurrences: 3,
      observationIds: ['obs-1', 'obs-2', 'obs-3'],
      sessionIds: ['s1', 's2', 's3'],
      firstTs: '2026-10-01T10:00:00.000Z',
      lastTs: '2026-10-03T10:00:00.000Z',
      exemplar: 'use npm install',
      kind: 'user_correction',
      category: 'workflow',
    }
    expect(consolidationKey(pattern)).toBe(KEY)
    expect(consolidationKey(pattern)).toBe(consolidationKey({ ...pattern }))
  })
})

describe('consolidateObservations', () => {
  it('merges >= DEFAULT_CONSOLIDATION_MIN_OCCURRENCES observations into one draft', () => {
    const observations = [
      observation('obs-1', 's1', [correction({ id: 'c1', original: 'use npm install', corrected: 'use pnpm add' })]),
      observation('obs-2', 's2', [correction({ id: 'c2', original: 'use npm install', corrected: 'use pnpm add' })]),
    ]

    const drafts = consolidateObservations({ observations })

    expect(DEFAULT_CONSOLIDATION_MIN_OCCURRENCES).toBe(2)
    expect(drafts).toHaveLength(1)
    const draft = drafts[0]!
    expect(draft.pattern.key).toBe(KEY)
    expect(draft.pattern.occurrences).toBe(2)
    expect(draft.pattern.observationIds).toEqual(['obs-1', 'obs-2'])
    expect(draft.hypothesis.type).toBe('lesson')
    expect(draft.hypothesis.scope).toBe('workspace')
    expect(draft.hypothesis.evidenceRefs).toHaveLength(2)
    expect(draft.hypothesis.evidenceRefs.every((ref) => ref.type === 'recurrence')).toBe(true)

    // Deterministic: same input ⇒ same output, byte for byte.
    expect(consolidateObservations({ observations })).toEqual(drafts)
  })

  it('dedups differently-cased/whitespaced phrasings onto one normalized key', () => {
    const observations = [
      observation('obs-1', 's1', [correction({ id: 'c1', original: 'Use  npm   install', corrected: 'use pnpm add' })]),
      observation('obs-2', 's2', [correction({ id: 'c2', original: 'use npm install', corrected: 'USE PNPM ADD' })]),
    ]

    const drafts = consolidateObservations({ observations })
    expect(drafts).toHaveLength(1)
    expect(consolidationKey(drafts[0]!.pattern)).toBe(KEY)
    expect(drafts[0]!.pattern.occurrences).toBe(2)
  })

  it('drops singletons — a signal seen once is not a pattern', () => {
    const observations = [
      observation('obs-1', 's1', [correction({ id: 'c1', original: 'use npm install', corrected: 'use pnpm add' })]),
    ]
    expect(consolidateObservations({ observations })).toEqual([])
  })

  it('skips patterns already covered by knownFingerprints', () => {
    const observations = [
      observation('obs-1', 's1', [correction({ id: 'c1', original: 'use npm install', corrected: 'use pnpm add' })]),
      observation('obs-2', 's2', [correction({ id: 'c2', original: 'use npm install', corrected: 'use pnpm add' })]),
    ]
    expect(consolidateObservations({ observations, knownFingerprints: new Set([KEY]) })).toEqual([])
  })

  it('never lowers the threshold below 2, even when asked for 1', () => {
    const observations = [
      observation('obs-1', 's1', [correction({ id: 'c1', original: 'a', corrected: 'b' })]),
    ]
    expect(consolidateObservations({ observations, minOccurrences: 1 })).toEqual([])
  })
})

describe('ConsolidationEngine class', () => {
  it('runs the same pure pipeline and honours its configured minimum', () => {
    const observations = [
      observation('obs-1', 's1', [correction({ id: 'c1', original: 'a', corrected: 'b' })]),
      observation('obs-2', 's2', [correction({ id: 'c2', original: 'a', corrected: 'b' })]),
      observation('obs-3', 's3', [correction({ id: 'c3', original: 'a', corrected: 'b' })]),
    ]

    const engine = new ConsolidationEngine({ minOccurrences: 3 })
    const drafts = engine.run({ observations })
    expect(drafts).toHaveLength(1)
    expect(drafts[0]!.pattern.occurrences).toBe(3)

    expect(new ConsolidationEngine({ minOccurrences: 2 }).run({ observations })).toHaveLength(1)
  })
})