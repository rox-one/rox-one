import { describe, it, expect } from 'bun:test'
import type { LearningObservation, UserCorrection } from '@rox/shared/memory/learning'
import type { ReflectionContext } from '../learning-types'
import { ReflectionEngine, buildReflectionPrompt, parseReflectionResult } from '../ReflectionEngine'

const CORRECTION: UserCorrection = {
  id: 'corr-1',
  sessionId: 'session-1',
  original: 'use npm install',
  corrected: 'use pnpm add',
  category: 'workflow',
  confidence: 0.9,
  ts: '2026-10-01T10:00:00.000Z',
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

function makeContext(overrides: Partial<ReflectionContext> = {}): ReflectionContext {
  return { workspaceRoot: '/tmp/rox-workspace', workspaceId: 'workspace-1', ...overrides }
}

const VALID_REPLY = JSON.stringify({
  hypotheses: [
    {
      type: 'lesson',
      scope: 'workspace',
      hypothesis: 'Always run bun test before claiming a change is done',
      category: 'workflow',
      payload: { rule: 'Run bun test before done' },
      evidenceRefs: [
        { type: 'user_correction', ref: 'corr-1', weight: 1.5 },
        { type: 'test_result', ref: 'bun test', weight: -0.2 },
      ],
      confidence_estimate: 0.92,
    },
    {
      type: 'skill',
      scope: 'session',
      hypothesis: 'Prefer rg over grep for repo searches',
      evidenceRefs: [{ type: 'tool_trace', ref: 'rg', weight: 0.5 }],
      confidence_estimate: 1.4,
    },
    { type: 'bogus', scope: 'workspace', hypothesis: 'dropped: bad type', evidenceRefs: [] },
    { type: 'policy', scope: 'cosmos', hypothesis: 'dropped: bad scope', evidenceRefs: [] },
    { type: 'policy', scope: 'global', hypothesis: '   ', evidenceRefs: [] },
    'not an object',
  ],
  rejectedHypotheses: [
    { hypothesis: 'prefer tabs', reason: 'no evidence in this session' },
    { hypothesis: 'missing reason' },
    'nope',
  ],
})

describe('parseReflectionResult', () => {
  it('parses a fenced reply, clamps weights, and drops malformed hypotheses', () => {
    const result = parseReflectionResult('```json\n' + VALID_REPLY + '\n```')

    expect(result).not.toBeNull()
    expect(result?.hypotheses).toHaveLength(2)

    const [lesson, skill] = result?.hypotheses ?? []
    expect(lesson?.type).toBe('lesson')
    expect(lesson?.scope).toBe('workspace')
    expect(lesson?.hypothesis).toBe('Always run bun test before claiming a change is done')
    expect(lesson?.category).toBe('workflow')
    expect(lesson?.payload).toEqual({ rule: 'Run bun test before done' })
    expect(lesson?.evidenceRefs.map((ref) => ref.weight)).toEqual([1, 0])
    expect(lesson?.evidenceRefs[0]?.type).toBe('user_correction')
    expect(lesson?.modelConfidenceEstimate).toBe(0.92)

    expect(skill?.modelConfidenceEstimate).toBe(1)
    expect(skill?.category).toBeUndefined()

    expect(result?.rejectedHypotheses).toEqual([{ hypothesis: 'prefer tabs', reason: 'no evidence in this session' }])
  })

  it('returns null for anything that is not a reflection object', () => {
    expect(parseReflectionResult('not json')).toBeNull()
    expect(parseReflectionResult('')).toBeNull()
    expect(parseReflectionResult('{"foo":1}')).toBeNull()
    expect(parseReflectionResult('[1,2]')).toBeNull()
    expect(parseReflectionResult('null')).toBeNull()
  })

  it('accepts a reply carrying only one of the two lists', () => {
    const onlyHypotheses = parseReflectionResult(
      '{"hypotheses":[{"type":"skill","scope":"session","hypothesis":"use rg over grep","evidenceRefs":[]}]}',
    )
    expect(onlyHypotheses?.hypotheses).toHaveLength(1)
    expect(onlyHypotheses?.rejectedHypotheses).toEqual([])

    expect(parseReflectionResult('{"hypotheses":[],"rejectedHypotheses":[]}')).toEqual({
      hypotheses: [],
      rejectedHypotheses: [],
    })
  })
})

describe('buildReflectionPrompt', () => {
  it('renders every evidence section in order and ends with the strict JSON shape', () => {
    const observation = makeObservation({
      execution: { tools: ['bash'], skills: ['tdd'], models: ['m'], delegated: false },
      signals: { userCorrections: [CORRECTION], errors: [], branches: 0, interruptions: 0 },
      memory: {
        lessonsInjected: [{ rule: 'always run tests', scope: 'workspace' }],
        episodesRecalled: [{ id: 'ep-1', kind: 'failure' }],
        skillsInjected: ['tdd'],
      },
    })
    const context = makeContext({
      transcript: 'user: fix the failing build',
      runtimeTrace: 'step 1: read file',
      toolOutcomes: 'bash exit 1',
      gitDiffSummary: '1 file changed, 12 insertions',
      verification: { testsPassed: 3, testsFailed: 1 },
      userCorrections: [
        CORRECTION,
        { ...CORRECTION, id: 'corr-2', original: 'prefer tabs', corrected: 'use spaces', category: 'style' },
      ],
    })

    const prompt = buildReflectionPrompt({ observation, context })

    const headings = [
      'Session transcript:',
      'Runtime trace:',
      'Tool outcomes:',
      'Memory used:',
      'Skills used:',
      'User corrections:',
      'Verification:',
      'Git diff:',
    ]
    const positions = headings.map((heading) => prompt.indexOf(heading))
    expect(positions.every((position) => position >= 0)).toBe(true)
    expect(positions).toEqual([...positions].sort((a, b) => a - b))

    expect(prompt).toContain('user: fix the failing build')
    expect(prompt).toContain('step 1: read file')
    expect(prompt).toContain('bash exit 1')
    expect(prompt).toContain('- lesson [workspace] always run tests')
    expect(prompt).toContain('- episode failure: ep-1')
    expect(prompt).toContain('- skills injected: tdd')
    expect(prompt).toContain('- "use npm install" → "use pnpm add" (workflow)')
    expect(prompt).toContain('- "prefer tabs" → "use spaces" (style)')
    expect(prompt).toContain('- tests: 3 passed, 1 failed')
    expect(prompt).toContain('1 file changed, 12 insertions')
    expect(prompt).toContain('"rejectedHypotheses":[{"hypothesis":string,"reason":string}]')
    expect(prompt).toContain('"confidence_estimate"?:number')
    // The same correction arrives via the observation and the context: render once.
    expect(prompt.split('"use npm install"').length - 1).toBe(1)
  })

  it('skips absent sections and never renders undefined', () => {
    const prompt = buildReflectionPrompt({ observation: makeObservation(), context: makeContext() })

    expect(prompt).not.toContain('Session transcript:')
    expect(prompt).not.toContain('Memory used:')
    expect(prompt).not.toContain('User corrections:')
    expect(prompt).not.toContain('undefined')
    expect(prompt).toContain('Return ONLY valid JSON of the shape:')
  })
})

describe('ReflectionEngine', () => {
  it('returns the parsed result and forwards the session id', async () => {
    const calls: Array<{ prompt: string; sessionId?: string }> = []
    const engine = new ReflectionEngine({
      distiller: async (prompt, sessionId) => {
        calls.push({ prompt, sessionId })
        return VALID_REPLY
      },
    })

    const result = await engine.reflect({
      observation: makeObservation(),
      context: makeContext(),
      sessionId: 'session-42',
    })

    expect(result.hypotheses).toHaveLength(2)
    expect(result.rejectedHypotheses).toHaveLength(1)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.sessionId).toBe('session-42')
    expect(calls[0]?.prompt).toContain('Return ONLY valid JSON of the shape:')
  })

  it('retries once with a JSON-only reminder when the first reply is invalid', async () => {
    const prompts: string[] = []
    const engine = new ReflectionEngine({
      distiller: async (prompt) => {
        prompts.push(prompt)
        return prompts.length === 1 ? 'Sure! Here is my analysis...' : '```json\n' + VALID_REPLY + '\n```'
      },
    })

    const result = await engine.reflect({ observation: makeObservation(), context: makeContext() })

    expect(prompts).toHaveLength(2)
    expect(prompts[1]?.endsWith('Return only valid JSON')).toBe(true)
    expect(prompts[1]?.startsWith(prompts[0] ?? '')).toBe(true)
    expect(result.hypotheses).toHaveLength(2)
  })

  it('returns an empty result and warns after two invalid replies', async () => {
    const warnings: string[] = []
    const engine = new ReflectionEngine({
      distiller: async () => 'still not json',
      logger: {
        warn: (message) => {
          warnings.push(message)
        },
      },
    })

    const result = await engine.reflect({
      observation: makeObservation(),
      context: makeContext(),
      sessionId: 'session-7',
    })

    expect(result).toEqual({ hypotheses: [], rejectedHypotheses: [] })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('invalid JSON twice')
    expect(warnings[0]).toContain('session-7')
  })

  it('warns once and returns empty when no distiller is configured', async () => {
    const warnings: string[] = []
    const engine = new ReflectionEngine({
      logger: {
        warn: (message) => {
          warnings.push(message)
        },
      },
    })
    const input = { observation: makeObservation(), context: makeContext() }

    expect(await engine.reflect(input)).toEqual({ hypotheses: [], rejectedHypotheses: [] })
    expect(await engine.reflect(input)).toEqual({ hypotheses: [], rejectedHypotheses: [] })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('no distiller')
  })

  it('never throws when the distiller rejects', async () => {
    const warnings: string[] = []
    const engine = new ReflectionEngine({
      distiller: async () => {
        throw new Error('provider offline')
      },
      logger: {
        warn: (message) => {
          warnings.push(message)
        },
      },
    })

    const result = await engine.reflect({
      observation: makeObservation(),
      context: makeContext(),
      sessionId: 'session-9',
    })

    expect(result).toEqual({ hypotheses: [], rejectedHypotheses: [] })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('reflection failed')
    expect(warnings[0]).toContain('session-9')
  })
})