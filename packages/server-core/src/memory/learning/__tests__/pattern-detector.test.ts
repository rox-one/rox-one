import { describe, it, expect } from 'bun:test'
import type { LearningObservation, UserCorrection } from '@rox/shared/memory/learning'
import { detectPatterns } from '../PatternDetector'

function makeCorrection(overrides: Partial<UserCorrection> = {}): UserCorrection {
  return {
    id: 'corr-1',
    sessionId: 'session-1',
    original: 'use npm install',
    corrected: 'use pnpm add',
    category: 'workflow',
    confidence: 0.9,
    ts: '2026-10-01T10:00:00.000Z',
    ...overrides,
  }
}

function makeObservation(overrides: Partial<LearningObservation> = {}): LearningObservation {
  const base: LearningObservation = {
    id: 'obs-1',
    sessionId: 'session-1',
    workspaceId: 'workspace-1',
    ts: '2026-10-01T10:00:00.000Z',
    execution: { tools: [], skills: [], models: [], delegated: false },
    outcome: { status: 'success' },
    signals: { userCorrections: [], errors: [], branches: 0, interruptions: 0 },
    memory: { lessonsInjected: [], episodesRecalled: [], skillsInjected: [] },
    artifacts: { filesChanged: 0 },
  }
  return { ...base, ...overrides }
}

describe('detectPatterns', () => {
  it('merges one correction recurring across sessions, keeping the earliest exemplar', () => {
    // The earliest observation comes last in the input to prove the exemplar is
    // chosen by timestamp, not by scan order.
    const late = makeObservation({
      id: 'obs-late',
      sessionId: 'session-c',
      ts: '2026-10-03T12:00:00.000Z',
      signals: {
        userCorrections: [makeCorrection({ id: 'c-late', original: 'USE NPM  install', corrected: 'USE pnpm add' })],
        errors: [],
        branches: 0,
        interruptions: 0,
      },
    })
    const middle = makeObservation({
      id: 'obs-mid',
      sessionId: 'session-b',
      ts: '2026-10-02T12:00:00.000Z',
      signals: {
        userCorrections: [makeCorrection({ id: 'c-mid', original: 'use  npm install', corrected: 'use pnpm  add' })],
        errors: [],
        branches: 0,
        interruptions: 0,
      },
    })
    const early = makeObservation({
      id: 'obs-early',
      sessionId: 'session-a',
      ts: '2026-10-01T12:00:00.000Z',
      signals: {
        userCorrections: [
          makeCorrection({ id: 'c-early', original: 'Use npm install', corrected: 'Use pnpm add', category: 'tool' }),
        ],
        errors: [],
        branches: 0,
        interruptions: 0,
      },
    })

    const patterns = detectPatterns([late, middle, early])

    expect(patterns).toHaveLength(1)
    const [pattern] = patterns
    expect(pattern?.kind).toBe('user_correction')
    expect(pattern?.key).toBe('correction:use npm install→use pnpm add')
    expect(pattern?.occurrences).toBe(3)
    expect(pattern?.observationIds).toEqual(['obs-late', 'obs-mid', 'obs-early'])
    expect(pattern?.sessionIds).toEqual(['session-c', 'session-b', 'session-a'])
    expect(pattern?.firstTs).toBe('2026-10-01T12:00:00.000Z')
    expect(pattern?.lastTs).toBe('2026-10-03T12:00:00.000Z')
    expect(pattern?.exemplar).toBe('Use npm install')
    expect(pattern?.category).toBe('tool')
  })

  it('groups tool failures by tool, deduping repeats inside one observation', () => {
    const first = makeObservation({
      id: 'obs-1',
      sessionId: 'session-1',
      ts: '2026-10-01T10:00:00.000Z',
      signals: {
        userCorrections: [],
        errors: [{ tool: 'bash', message: 'exit 1' }],
        branches: 0,
        interruptions: 0,
      },
    })
    const second = makeObservation({
      id: 'obs-2',
      sessionId: 'session-2',
      ts: '2026-10-02T10:00:00.000Z',
      signals: {
        userCorrections: [],
        errors: [
          { tool: 'bash', message: 'exit 2' },
          { tool: 'bash', message: 'exit 3' },
          { message: 'no tool recorded' },
        ],
        branches: 0,
        interruptions: 0,
      },
    })

    const patterns = detectPatterns([first, second])

    expect(patterns.map((pattern) => pattern.key)).toEqual(['tool_failure:bash'])
    const [bash] = patterns
    expect(bash?.kind).toBe('tool_failure')
    expect(bash?.occurrences).toBe(2)
    expect(bash?.exemplar).toBe('exit 1')
    expect(bash?.firstTs).toBe('2026-10-01T10:00:00.000Z')
    expect(bash?.lastTs).toBe('2026-10-02T10:00:00.000Z')

    const all = detectPatterns([first, second], { minOccurrences: 1 })
    expect(all.map((pattern) => pattern.key)).toEqual(['tool_failure:bash', 'tool_failure:unknown'])
    expect(all[1]?.exemplar).toBe('no tool recorded')
  })

  it('hides singletons by default and normalizes the minOccurrences option', () => {
    const solo = makeObservation({
      id: 'obs-solo',
      signals: {
        userCorrections: [makeCorrection({ id: 'c-solo' })],
        errors: [],
        branches: 0,
        interruptions: 0,
      },
    })

    expect(detectPatterns([solo])).toHaveLength(0)
    expect(detectPatterns([solo], { minOccurrences: 1 })).toHaveLength(1)
    expect(detectPatterns([solo], { minOccurrences: Number.NaN })).toHaveLength(0)
    expect(detectPatterns([solo], { minOccurrences: 0 })).toHaveLength(1)
    expect(detectPatterns([])).toEqual([])
  })

  it('sorts by occurrences, then most recent activity, then key', () => {
    const first = makeObservation({
      id: 'obs-1',
      ts: '2026-10-01T10:00:00.000Z',
    })
    const second = makeObservation({
      id: 'obs-2',
      ts: '2026-10-02T10:00:00.000Z',
      signals: {
        userCorrections: [],
        errors: [{ tool: 'bash', message: 'exit 1' }],
        branches: 0,
        interruptions: 0,
        verification: { testsPassed: 0, testsFailed: 0, lintPassed: false },
      },
    })
    const third = makeObservation({
      id: 'obs-3',
      ts: '2026-10-03T10:00:00.000Z',
      signals: {
        userCorrections: [],
        errors: [{ tool: 'zsh', message: 'exit 1' }],
        branches: 0,
        interruptions: 0,
        verification: { testsPassed: 0, testsFailed: 0, lintPassed: false },
      },
    })

    // verify:lint has 2 occurrences; the two tool failures tie at 1 but zsh is
    // more recent, so recency must beat the alphabetical key order.
    const patterns = detectPatterns([first, second, third], { minOccurrences: 1 })
    expect(patterns.map((pattern) => pattern.key)).toEqual(['verify:lint', 'tool_failure:zsh', 'tool_failure:bash'])

    // Full tie (same occurrences, same lastTs) falls back to key order.
    const tied = detectPatterns(
      [
        makeObservation({
          id: 'obs-tie',
          ts: '2026-10-01T10:00:00.000Z',
          signals: {
            userCorrections: [],
            errors: [
              { tool: 'zsh', message: 'exit 1' },
              { tool: 'bash', message: 'exit 1' },
            ],
            branches: 0,
            interruptions: 0,
          },
        }),
      ],
      { minOccurrences: 1 },
    )
    expect(tied.map((pattern) => pattern.key)).toEqual(['tool_failure:bash', 'tool_failure:zsh'])
  })

  it('groups verification failures by channel', () => {
    const first = makeObservation({
      id: 'obs-1',
      ts: '2026-10-01T10:00:00.000Z',
      signals: {
        userCorrections: [],
        errors: [],
        branches: 0,
        interruptions: 0,
        verification: { testsPassed: 3, testsFailed: 0, buildPassed: false, lintPassed: false, typecheckPassed: true },
      },
    })
    const second = makeObservation({
      id: 'obs-2',
      ts: '2026-10-02T10:00:00.000Z',
      signals: {
        userCorrections: [],
        errors: [],
        branches: 0,
        interruptions: 0,
        verification: { testsPassed: 0, testsFailed: 2, lintPassed: false },
      },
    })

    const patterns = detectPatterns([first, second], { minOccurrences: 1 })

    expect(patterns.map((pattern) => pattern.key)).toEqual(['verify:lint', 'verify:tests', 'verify:build'])
    expect(patterns.map((pattern) => pattern.occurrences)).toEqual([2, 1, 1])
    expect(patterns.map((pattern) => pattern.kind)).toEqual([
      'verification_failure',
      'verification_failure',
      'verification_failure',
    ])
    expect(patterns[1]?.exemplar).toBe('tests failed (2)')
    expect(patterns[2]?.exemplar).toBe('build failed')
  })

  it('reads lesson conflicts when a producer attaches them, ignoring blank rules', () => {
    const withConflicts = (id: string, ts: string, rules: unknown[]): LearningObservation => {
      const observation = makeObservation({ id, sessionId: `session-${id}`, ts })
      const signals: LearningObservation['signals'] & { lessonConflicts: unknown[] } = {
        ...observation.signals,
        lessonConflicts: rules,
      }
      return { ...observation, signals }
    }

    const patterns = detectPatterns(
      [
        withConflicts('obs-1', '2026-10-01T10:00:00.000Z', [
          'Never force push',
          '   ',
          { rule: 'Always run tests' },
          { notARule: true },
        ]),
        withConflicts('obs-2', '2026-10-02T10:00:00.000Z', [{ rule: 'Never force push' }]),
      ],
      { minOccurrences: 1 },
    )

    expect(patterns.map((pattern) => pattern.key)).toEqual(['conflict:Never force push', 'conflict:Always run tests'])
    expect(patterns[0]?.kind).toBe('memory_conflict')
    expect(patterns[0]?.occurrences).toBe(2)
    expect(patterns[0]?.firstTs).toBe('2026-10-01T10:00:00.000Z')
    expect(patterns[1]?.occurrences).toBe(1)
  })

  it('skips observations without signals instead of throwing', () => {
    const partial = { id: 'obs-broken', sessionId: 'session-1', ts: '2026-10-01T10:00:00.000Z' } as LearningObservation
    expect(detectPatterns([partial])).toEqual([])
  })
})