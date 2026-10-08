/**
 * CandidateValidator unit tests (PRD §37/§38): every deterministic pass in
 * isolation (failing + passing case), exact pass ordering, promotable gating
 * via thresholds, tolerance for missing evidence, judge JSON parsing +
 * judge-failure resilience, and the no-throw contract across corrupt inputs.
 *
 * Ports are local factories; no LLM, no filesystem, fixed literal timestamps.
 */
import { describe, expect, it } from 'bun:test'
import type {
  CandidateValidation,
  EvidenceRef,
  LearningCandidate,
  LearningEvidenceType,
  TaskOutcome,
  TaskOutcomeStatus,
  ValidationPassResult,
} from '@rox/shared/memory/learning'
import {
  DEFAULT_LEARNING_THRESHOLDS,
  DEFAULT_SKILLS_LEARNING_POLICY,
  computeConfidence,
} from '@rox/shared/memory/learning'
import { CandidateValidator, computeConfidenceComponents } from '../CandidateValidator'
import type { ValidateCandidateInput, ValidatorPorts } from '../learning-types'

const TS = '2026-10-08T00:00:00.000Z'

type EvidenceRow = ValidateCandidateInput['evidence'][number]

function makePorts(overrides: Partial<ValidatorPorts> = {}): ValidatorPorts {
  return {
    listExistingRules: () => [],
    readRepositorySignals: () => [],
    listOutcomesByFingerprint: () => [],
    readSkillsLearningPolicy: () => ({ ...DEFAULT_SKILLS_LEARNING_POLICY }),
    thresholds: { ...DEFAULT_LEARNING_THRESHOLDS },
    ...overrides,
  }
}

function makeCandidate(overrides: Partial<LearningCandidate> = {}): LearningCandidate {
  return {
    id: 'cand_1',
    fingerprint: 'fp_1',
    type: 'lesson',
    scope: 'workspace',
    hypothesis: 'Use bun for installs',
    payload: undefined,
    evidence: [],
    confidence: 0,
    confidenceComponents: {
      recurrence: 0,
      evidenceQuality: 0,
      userSignal: 0,
      repositorySupport: 0,
      outcomeSupport: 0,
      consistency: 0,
    },
    status: 'candidate',
    validation: { passes: [], promotable: false, checkedAt: TS },
    createdAt: TS,
    updatedAt: TS,
    ...overrides,
  }
}

function makeRef(evidenceId: string, type: LearningEvidenceType, weight = 1): EvidenceRef {
  return { evidenceId, type, ref: `ref:${evidenceId}`, weight }
}

function makeRow(evidenceId: string, type: LearningEvidenceType, weight = 1) {
  return { id: evidenceId, type, ref: `ref:${evidenceId}`, weight, ts: TS }
}

function makeOutcome(status: TaskOutcomeStatus, id = 'out_1'): TaskOutcome {
  return {
    id,
    sessionId: 'sess_1',
    taskFingerprint: 'fp_task',
    status,
    userCorrections: 0,
    memoryUsed: [],
    skillsUsed: [],
    errors: [],
    ts: TS,
  }
}

function makeInput(candidate: LearningCandidate, overrides: Partial<ValidateCandidateInput> = {}): ValidateCandidateInput {
  return { candidate, evidence: [], workspaceRoot: '/tmp/ws', ...overrides }
}

function passOf(validation: CandidateValidation, pass: ValidationPassResult['pass']): ValidationPassResult {
  const found = validation.passes.find(item => item.pass === pass)
  if (!found) throw new Error(`pass ${pass} missing`)
  return found
}

const PASS_ORDER: ValidationPassResult['pass'][] = [
  'duplicate',
  'contradiction',
  'scope',
  'sensitive',
  'evidence_count',
  'repository_evidence',
  'outcome_evidence',
  'consistency',
]

describe('CandidateValidator — pass order and always-emitted passes', () => {
  it('emits all eight passes in the PRD §37 order', async () => {
    const validator = new CandidateValidator(makePorts())
    const validation = await validator.validate(makeInput(makeCandidate()))

    expect(validation.passes.map(pass => pass.pass)).toEqual(PASS_ORDER)
    expect(validation.checkedAt).toBe(new Date(Date.parse(validation.checkedAt)).toISOString())
  })

  it('runs every pass even when an earlier one already failed', async () => {
    const validator = new CandidateValidator(makePorts({ listExistingRules: () => [{ rule: 'Use bun for installs', scope: 'workspace' }] }))
    const validation = await validator.validate(makeInput(makeCandidate({ hypothesis: 'Use bun for installs' })))

    expect(passOf(validation, 'duplicate').ok).toBe(false)
    expect(validation.passes).toHaveLength(8)
  })
})

describe('CandidateValidator — duplicate pass', () => {
  it('fails on a whitespace/case variant of an existing rule', async () => {
    const validator = new CandidateValidator(makePorts({ listExistingRules: () => [{ rule: 'Use bun for installs', scope: 'global' }] }))
    const validation = await validator.validate(makeInput(makeCandidate({ hypothesis: '  use   BUN For Installs ' })))

    const pass = passOf(validation, 'duplicate')
    expect(pass.ok).toBe(false)
    expect(pass.detail).toContain('Use bun for installs')
  })

  it('passes when no existing rule normalizes to the same text', async () => {
    const validator = new CandidateValidator(makePorts({ listExistingRules: () => [{ rule: 'Use pnpm for installs', scope: 'global' }] }))
    const validation = await validator.validate(makeInput(makeCandidate({ hypothesis: 'Use bun for installs' })))

    expect(passOf(validation, 'duplicate')).toEqual({ pass: 'duplicate', ok: true })
  })

  it('fails soft when the rule port throws', async () => {
    const validator = new CandidateValidator(makePorts({ listExistingRules: () => { throw new Error('store offline') } }))
    const validation = await validator.validate(makeInput(makeCandidate()))

    expect(passOf(validation, 'duplicate')).toEqual({ pass: 'duplicate', ok: false, detail: 'existing rules unavailable' })
    expect(passOf(validation, 'contradiction').ok).toBe(false)
  })
})

describe('CandidateValidator — contradiction pass', () => {
  it('fails on always/never polarity collision via detectProposalConflicts', async () => {
    const validator = new CandidateValidator(makePorts({ listExistingRules: () => [{ rule: 'Always run tests before commit', scope: 'global' }] }))
    const validation = await validator.validate(makeInput(makeCandidate({ hypothesis: 'Never run tests before commit' })))

    const pass = passOf(validation, 'contradiction')
    expect(pass.ok).toBe(false)
    expect(pass.detail).toContain('Always run tests before commit')
  })

  it('fails on same subject with opposite polarity in other phrasing', async () => {
    const validator = new CandidateValidator(makePorts({ listExistingRules: () => [{ rule: 'Do not use npm ci in CI', scope: 'global' }] }))
    const validation = await validator.validate(makeInput(makeCandidate({ hypothesis: 'Use npm ci in CI' })))

    expect(passOf(validation, 'contradiction').ok).toBe(false)
  })

  it('honours the stored negative flag even without negation words in the rule text', async () => {
    const validator = new CandidateValidator(makePorts({ listExistingRules: () => [{ rule: 'prefer npm ci in CI', scope: 'workspace', negative: true }] }))
    const validation = await validator.validate(makeInput(makeCandidate({ hypothesis: 'Prefer npm ci in CI' })))

    // Exact duplicate: duplicate pass owns it, contradiction must stay silent.
    expect(passOf(validation, 'duplicate').ok).toBe(false)
    expect(passOf(validation, 'contradiction').ok).toBe(true)
  })

  it('passes for same-subject same-polarity and for unrelated rules', async () => {
    const validator = new CandidateValidator(makePorts({
      listExistingRules: () => [
        { rule: 'Use bun for installs', scope: 'global' },
        { rule: 'Always run tests before commit', scope: 'global' },
      ],
    }))
    const validation = await validator.validate(makeInput(makeCandidate({ hypothesis: 'Prefer small commits' })))

    expect(passOf(validation, 'contradiction')).toEqual({ pass: 'contradiction', ok: true })
  })
})

describe('CandidateValidator — scope pass', () => {
  it('rejects a scope outside the union', async () => {
    const validator = new CandidateValidator(makePorts())
    const validation = await validator.validate(makeInput(makeCandidate({ scope: 'team' as LearningCandidate['scope'] })))

    expect(passOf(validation, 'scope').ok).toBe(false)
    expect(passOf(validation, 'scope').detail).toContain('team')
  })

  it('rejects session-scoped policies but allows session-scoped lessons', async () => {
    const validator = new CandidateValidator(makePorts())
    const sessionPolicy = await validator.validate(makeInput(makeCandidate({ type: 'policy', scope: 'session' })))
    expect(passOf(sessionPolicy, 'scope').ok).toBe(false)

    const sessionLesson = await validator.validate(makeInput(makeCandidate({ type: 'lesson', scope: 'session' })))
    expect(passOf(sessionLesson, 'scope').ok).toBe(true)

    const projectLesson = await validator.validate(makeInput(makeCandidate({ type: 'lesson', scope: 'project' })))
    expect(passOf(projectLesson, 'scope').ok).toBe(true)
  })
})

describe('CandidateValidator — sensitive pass', () => {
  it('flags secret-like hypotheses', async () => {
    const validator = new CandidateValidator(makePorts())
    const validation = await validator.validate(makeInput(makeCandidate({ hypothesis: 'Store the API key in the repo config' })))

    const pass = passOf(validation, 'sensitive')
    expect(pass.ok).toBe(false)
    expect(pass.detail).toContain('hypothesis')
  })

  it('flags secret-like payload paths', async () => {
    const validator = new CandidateValidator(makePorts())
    const validation = await validator.validate(makeInput(makeCandidate({
      hypothesis: 'Keep deploy credentials out of the repo',
      payload: { example: '/home/u/.ssh/id_rsa' },
    })))

    const pass = passOf(validation, 'sensitive')
    expect(pass.ok).toBe(false)
    expect(pass.detail).toContain('payload')
  })

  it('passes clean candidates and survives a circular payload', async () => {
    const validator = new CandidateValidator(makePorts())
    const clean = await validator.validate(makeInput(makeCandidate({
      hypothesis: 'Round change size to under 400 lines',
      payload: { category: 'style' },
    })))
    expect(passOf(clean, 'sensitive')).toEqual({ pass: 'sensitive', ok: true })

    const circular: Record<string, unknown> = { category: 'style' }
    circular.self = circular
    const guarded = await validator.validate(makeInput(makeCandidate({ payload: circular })))
    expect(passOf(guarded, 'sensitive').ok).toBe(true)
  })
})

describe('CandidateValidator — evidence_count pass', () => {
  it('enforces the per-type minimum from thresholds', async () => {
    const validator = new CandidateValidator(makePorts())
    const input = (rows: EvidenceRow[], type: LearningCandidate['type'] = 'lesson') =>
      validator.validate(makeInput(
        makeCandidate({ type, evidence: rows.map(row => makeRef(row.id, row.type)) }),
        { evidence: rows },
      ))

    const twoLessons = [makeRow('e1', 'session'), makeRow('e2', 'session')]
    expect(passOf(await input(twoLessons), 'evidence_count').ok).toBe(false)
    expect(passOf(await input(twoLessons), 'evidence_count').detail).toContain('has 2')

    const threeLessons = [...twoLessons, makeRow('e3', 'session')]
    expect(passOf(await input(threeLessons), 'evidence_count').ok).toBe(true)

    const twoSkills = [makeRow('s1', 'successful_outcome'), makeRow('s2', 'successful_outcome')]
    expect(passOf(await input(twoSkills, 'skill'), 'evidence_count').ok).toBe(true)
  })

  it('uses candidate refs when the evidence rows are missing (tolerant path)', async () => {
    const validator = new CandidateValidator(makePorts())
    const candidate = makeCandidate({
      evidence: [makeRef('e1', 'user_correction'), makeRef('e2', 'user_correction'), makeRef('e3', 'user_correction')],
    })
    const validation = await validator.validate(makeInput(candidate, { evidence: [] }))

    expect(passOf(validation, 'evidence_count').ok).toBe(true)
    // snapshot weights survive, so quality stays 1
    expect(passOf(validation, 'consistency').ok).toBe(true)
  })

  it('counts distinct evidence refs once each', async () => {
    const validator = new CandidateValidator(makePorts())
    const candidate = makeCandidate({
      evidence: [makeRef('e1', 'user_correction'), makeRef('e1', 'user_correction'), makeRef('e2', 'user_correction')],
    })
    const validation = await validator.validate(makeInput(candidate, { evidence: [makeRow('e1', 'user_correction')] }))

    expect(passOf(validation, 'evidence_count').ok).toBe(false)
    expect(passOf(validation, 'evidence_count').detail).toContain('has 2')
  })
})

describe('CandidateValidator — repository_evidence pass', () => {
  it('fails when the hypothesis names a stack term no repository signal confirms', async () => {
    const validator = new CandidateValidator(makePorts())
    const validation = await validator.validate(makeInput(makeCandidate({ hypothesis: 'Use bun add instead of bun install' })))

    const pass = passOf(validation, 'repository_evidence')
    expect(pass.ok).toBe(false)
    expect(pass.detail).toContain('bun')
  })

  it('passes when repository signals confirm the term', async () => {
    const validator = new CandidateValidator(makePorts({
      readRepositorySignals: () => ['package manager: bun', 'lockfile: bun.lock'],
    }))
    const validation = await validator.validate(makeInput(makeCandidate({ hypothesis: 'Use bun add instead of bun install' })))

    const pass = passOf(validation, 'repository_evidence')
    expect(pass.ok).toBe(true)
    expect(pass.detail).toContain('package manager: bun')
  })

  it('is not applicable when the hypothesis names no repository-checkable term', async () => {
    const validator = new CandidateValidator(makePorts())
    const validation = await validator.validate(makeInput(makeCandidate({ hypothesis: 'Ask before renaming public modules' })))

    expect(passOf(validation, 'repository_evidence')).toEqual({ pass: 'repository_evidence', ok: true, detail: 'not applicable' })
  })

  it('is not applicable for types the repository cannot confirm', async () => {
    const validator = new CandidateValidator(makePorts())
    const validation = await validator.validate(makeInput(makeCandidate({ type: 'skill', hypothesis: 'Use bun add instead of bun install' })))

    expect(passOf(validation, 'repository_evidence').ok).toBe(true)
    expect(passOf(validation, 'repository_evidence').detail).toBe('not applicable')
  })

  it('accepts a repository evidence row even when signals are unavailable', async () => {
    const validator = new CandidateValidator(makePorts({
      readRepositorySignals: () => { throw new Error('no fs') },
    }))
    const candidate = makeCandidate({
      hypothesis: 'Use bun add instead of bun install',
      evidence: [makeRef('e1', 'repository')],
    })
    const validation = await validator.validate(makeInput(candidate, { evidence: [makeRow('e1', 'repository')] }))

    expect(passOf(validation, 'repository_evidence').ok).toBe(true)
  })

  it('fails soft when signals are unavailable and no repository evidence exists', async () => {
    const validator = new CandidateValidator(makePorts({
      readRepositorySignals: () => { throw new Error('no fs') },
    }))
    const validation = await validator.validate(makeInput(makeCandidate({ hypothesis: 'Use bun add instead of bun install' })))

    expect(passOf(validation, 'repository_evidence')).toEqual({
      pass: 'repository_evidence',
      ok: false,
      detail: 'repository signals unavailable',
    })
  })
})

describe('CandidateValidator — outcome_evidence pass', () => {
  it('requires successful execution evidence for skills', async () => {
    const validator = new CandidateValidator(makePorts())
    const rows = [makeRow('e1', 'session'), makeRow('e2', 'session')]
    const candidate = makeCandidate({ type: 'skill', evidence: rows.map(row => makeRef(row.id, row.type)) })

    const weak = await validator.validate(makeInput(candidate, { evidence: rows }))
    expect(passOf(weak, 'outcome_evidence').ok).toBe(false)

    const strongRows = [...rows, makeRow('e3', 'successful_outcome')]
    const strong = await validator.validate(makeInput(
      makeCandidate({ type: 'skill', evidence: strongRows.map(row => makeRef(row.id, row.type)) }),
      { evidence: strongRows },
    ))
    expect(passOf(strong, 'outcome_evidence').ok).toBe(true)
  })

  it('accepts a user correction or two session observations for lessons', async () => {
    const validator = new CandidateValidator(makePorts())
    const oneCorrection = [makeRow('e1', 'user_correction')]
    const correction = await validator.validate(makeInput(
      makeCandidate({ evidence: oneCorrection.map(row => makeRef(row.id, row.type)) }),
      { evidence: oneCorrection },
    ))
    expect(passOf(correction, 'outcome_evidence').ok).toBe(true)
    expect(passOf(correction, 'outcome_evidence').detail).toBe('user correction evidence')

    const oneSession = [makeRow('e1', 'session')]
    const lone = await validator.validate(makeInput(
      makeCandidate({ evidence: oneSession.map(row => makeRef(row.id, row.type)) }),
      { evidence: oneSession },
    ))
    expect(passOf(lone, 'outcome_evidence').ok).toBe(false)

    const twoSessions = [makeRow('e1', 'session'), makeRow('e2', 'tool_trace')]
    const pair = await validator.validate(makeInput(
      makeCandidate({ evidence: twoSessions.map(row => makeRef(row.id, row.type)) }),
      { evidence: twoSessions },
    ))
    expect(passOf(pair, 'outcome_evidence').ok).toBe(false)

    const bothSessions = [makeRow('e1', 'session'), makeRow('e2', 'session')]
    const two = await validator.validate(makeInput(
      makeCandidate({ evidence: bothSessions.map(row => makeRef(row.id, row.type)) }),
      { evidence: bothSessions },
    ))
    expect(passOf(two, 'outcome_evidence').detail).toBe('2 session observations')
  })

  it('is not applicable for preferences', async () => {
    const validator = new CandidateValidator(makePorts())
    const validation = await validator.validate(makeInput(makeCandidate({ type: 'preference' })))

    expect(passOf(validation, 'outcome_evidence')).toEqual({ pass: 'outcome_evidence', ok: true, detail: 'not applicable' })
  })
})

describe('CandidateValidator — consistency pass', () => {
  const evidence = [makeRow('e1', 'user_correction'), makeRow('e2', 'session'), makeRow('e3', 'repository')]

  function componentsFor(confidence: number, priorOutcomes: TaskOutcome[] = []) {
    const candidate = makeCandidate({ confidence, evidence: evidence.map(row => makeRef(row.id, row.type)) })
    return { candidate, priorOutcomes }
  }

  it('passes when the stored confidence matches the recomputed product', async () => {
    const { candidate } = componentsFor(0)
    const expected = computeConfidence(computeConfidenceComponents({
      candidate,
      evidence,
      repoSignals: ['lockfile: bun.lock'],
      priorOutcomes: [makeOutcome('success')],
    }))
    const validator = new CandidateValidator(makePorts({
      readRepositorySignals: () => ['lockfile: bun.lock'],
      listOutcomesByFingerprint: () => [makeOutcome('success')],
    }))
    const validation = await validator.validate(makeInput(
      { ...candidate, confidence: expected },
      { evidence, taskFingerprint: 'fp_task' },
    ))

    expect(expected).toBeGreaterThan(0)
    expect(passOf(validation, 'consistency').ok).toBe(true)
  })

  it('fails when the stored confidence was edited away from the product', async () => {
    const { candidate } = componentsFor(0.99)
    const validator = new CandidateValidator(makePorts())
    const validation = await validator.validate(makeInput(candidate, { evidence }))

    const pass = passOf(validation, 'consistency')
    expect(pass.ok).toBe(false)
    expect(pass.detail).toContain('stored confidence')
  })

  it('treats zero or non-finite stored confidence as "no prior confidence"', async () => {
    const validator = new CandidateValidator(makePorts())
    const zero = await validator.validate(makeInput(makeCandidate({ confidence: 0 })))
    expect(passOf(zero, 'consistency').detail).toBe('no prior confidence')

    const nan = await validator.validate(makeInput(makeCandidate({ confidence: Number.NaN })))
    expect(passOf(nan, 'consistency').detail).toBe('no prior confidence')
  })
})

describe('CandidateValidator — promotable gating', () => {
  const strongRows: EvidenceRow[] = [
    makeRow('e1', 'user_correction'),
    makeRow('e2', 'user_correction'),
    makeRow('e3', 'session'),
    makeRow('e4', 'repository'),
    makeRow('e5', 'successful_outcome'),
  ]
  const strongCandidate = makeCandidate({
    hypothesis: 'Use bun add instead of bun install for new dependencies',
    evidence: strongRows.map(row => makeRef(row.id, row.type)),
  })
  const strongPorts = (overrides: Partial<ValidatorPorts> = {}) => makePorts({
    readRepositorySignals: () => ['package manager: bun', 'lockfile: bun.lock'],
    listOutcomesByFingerprint: () => [makeOutcome('success')],
    ...overrides,
  })

  it('promotes when every pass agrees and recomputed confidence clears the threshold', async () => {
    const validation = await new CandidateValidator(strongPorts()).validate(
      makeInput(strongCandidate, { evidence: strongRows, taskFingerprint: 'fp_task' }),
    )

    expect(validation.passes.every(pass => pass.ok)).toBe(true)
    expect(validation.promotable).toBe(true)
  })

  it('refuses promotion when the threshold is raised above the recomputed confidence', async () => {
    const validation = await new CandidateValidator(strongPorts({
      thresholds: { ...DEFAULT_LEARNING_THRESHOLDS, lessonMinConfidence: 0.9 },
    })).validate(makeInput(strongCandidate, { evidence: strongRows, taskFingerprint: 'fp_task' }))

    expect(validation.passes.every(pass => pass.ok)).toBe(true)
    expect(validation.promotable).toBe(false)
  })

  it('refuses promotion when the confidence product is below the threshold even with all passes ok', async () => {
    const rows: EvidenceRow[] = [makeRow('e1', 'session'), makeRow('e2', 'session'), makeRow('e3', 'session')]
    const validation = await new CandidateValidator(makePorts()).validate(makeInput(
      makeCandidate({ hypothesis: 'Prefer small commits', evidence: rows.map(row => makeRef(row.id, row.type)) }),
      { evidence: rows },
    ))

    expect(validation.passes.every(pass => pass.ok)).toBe(true)
    expect(validation.promotable).toBe(false)
  })

  it('refuses promotion when a single deterministic pass fails', async () => {
    const thinRows = strongRows.slice(0, 2)
    const thinCandidate = makeCandidate({
      hypothesis: strongCandidate.hypothesis,
      evidence: thinRows.map(row => makeRef(row.id, row.type)),
    })
    const validation = await new CandidateValidator(strongPorts()).validate(
      makeInput(thinCandidate, { evidence: thinRows, taskFingerprint: 'fp_task' }),
    )

    expect(passOf(validation, 'evidence_count').ok).toBe(false)
    expect(validation.promotable).toBe(false)
  })

  it('lets a judge rejection veto an otherwise promotable candidate', async () => {
    const validation = await new CandidateValidator(strongPorts()).validate(
      makeInput(strongCandidate, {
        evidence: strongRows,
        taskFingerprint: 'fp_task',
        judge: async () => '{"verdict":"reject","rationale":"correlation only"}',
      }),
    )

    expect(validation.judged?.verdict).toBe('reject')
    expect(validation.passes.every(pass => pass.ok)).toBe(true)
    expect(validation.promotable).toBe(false)
  })

  it('keeps a promotable candidate promotable when the judge supports it', async () => {
    const validation = await new CandidateValidator(strongPorts()).validate(
      makeInput(strongCandidate, {
        evidence: strongRows,
        taskFingerprint: 'fp_task',
        judge: async () => '{"verdict":"support","rationale":"repeated correction"}',
      }),
    )

    expect(validation.promotable).toBe(true)
  })
})

describe('CandidateValidator — LLM judge', () => {
  it('records a parsed verdict and passes the hypothesis in the prompt', async () => {
    const prompts: string[] = []
    const validator = new CandidateValidator(makePorts())
    const validation = await validator.validate(makeInput(makeCandidate(), {
      judge: async prompt => {
        prompts.push(prompt)
        return 'Sure! {"verdict":"support","rationale":"evidence is strong"}'
      },
    }))

    expect(validation.judged).toEqual({ verdict: 'support', rationale: 'evidence is strong' })
    expect(prompts[0]).toContain('Use bun for installs')
    expect(prompts[0]).toContain('STRICT JSON')
  })

  it('parses fenced JSON and tolerates a missing rationale', async () => {
    const validator = new CandidateValidator(makePorts())
    const validation = await validator.validate(makeInput(makeCandidate(), {
      judge: async () => 'Here you go:\n```json\n{"verdict":"inconclusive"}\n```\n',
    }))

    expect(validation.judged).toEqual({ verdict: 'inconclusive' })
  })

  it('omits a malformed verdict instead of failing validation', async () => {
    const validator = new CandidateValidator(makePorts())
    const garbage = await validator.validate(makeInput(makeCandidate(), { judge: async () => 'maybe later' }))
    expect(garbage.judged).toBeUndefined()
    expect(garbage.passes).toHaveLength(8)

    const wrongEnum = await validator.validate(makeInput(makeCandidate(), { judge: async () => '{"verdict":"yes"}' }))
    expect(wrongEnum.judged).toBeUndefined()
  })

  it('omits the verdict when the judge throws and stays promotable', async () => {
    const validator = new CandidateValidator(makePorts())
    const validation = await validator.validate(makeInput(makeCandidate(), {
      judge: async () => { throw new Error('llm down') },
    }))

    expect(validation.judged).toBeUndefined()
    expect(validation.passes).toHaveLength(8)
  })

  it('does not call the judge when none was supplied', async () => {
    const validation = await new CandidateValidator(makePorts()).validate(makeInput(makeCandidate()))
    expect(validation.judged).toBeUndefined()
  })
})

describe('CandidateValidator — no-throw contract', () => {
  it('resolves with failed passes for a corrupt candidate and failing ports', async () => {
    const validator = new CandidateValidator({
      listExistingRules: () => { throw new Error('rules offline') },
      readRepositorySignals: () => { throw new Error('no fs') },
      listOutcomesByFingerprint: () => { throw new Error('outcomes offline') },
      readSkillsLearningPolicy: () => { throw new Error('config offline') },
      thresholds: { ...DEFAULT_LEARNING_THRESHOLDS },
    })
    const corrupt = {
      id: 'x',
      type: 'lesson',
      scope: 'team',
      hypothesis: 42,
      evidence: undefined,
      confidence: undefined,
    } as unknown as LearningCandidate

    const validation = await validator.validate({
      candidate: corrupt,
      evidence: undefined,
      workspaceRoot: undefined,
    } as unknown as ValidateCandidateInput)

    expect(validation.passes.map(pass => pass.pass)).toEqual(PASS_ORDER)
    expect(validation.promotable).toBe(false)
    expect(passOf(validation, 'scope').ok).toBe(false)
    expect(passOf(validation, 'duplicate').ok).toBe(false)
  })

  it('skips evidence rows with unusable weights instead of throwing', async () => {
    const validator = new CandidateValidator(makePorts())
    const rows = [
      { id: 'e1', type: 'user_correction', ref: 'ref:e1', weight: Number.NaN },
      { id: 'e2', type: 'session', ref: 'ref:e2', weight: 42 },
    ] as unknown as EvidenceRow[]
    const validation = await validator.validate(makeInput(
      makeCandidate({ evidence: [makeRef('e1', 'user_correction'), makeRef('e2', 'session', 0.5)] }),
      { evidence: rows },
    ))

    expect(validation.passes).toHaveLength(8)
  })
})

describe('computeConfidenceComponents', () => {
  it('saturates recurrence at five distinct evidence items and averages weights', () => {
    const evidence: EvidenceRow[] = Array.from({ length: 7 }, (_, index) => makeRow(`e${index}`, 'session', 0.5))
    const candidate = makeCandidate({ evidence: evidence.map(row => makeRef(row.id, row.type, row.weight)) })
    const components = computeConfidenceComponents({ candidate, evidence, repoSignals: [], priorOutcomes: [] })

    expect(components.recurrence).toBe(1)
    expect(components.evidenceQuality).toBe(0.5)
    expect(components.userSignal).toBe(0.6)
    expect(components.repositorySupport).toBe(0.5)
    expect(components.outcomeSupport).toBe(0.5)
    expect(components.consistency).toBe(1)
  })

  it('falls back to neutral values with no evidence and maps outcome statuses', () => {
    const candidate = makeCandidate()
    const empty = computeConfidenceComponents({ candidate, evidence: [], repoSignals: [], priorOutcomes: [] })
    expect(empty.recurrence).toBe(0)
    expect(empty.evidenceQuality).toBe(0.3)
    expect(empty.userSignal).toBe(0.3)
    expect(empty.outcomeSupport).toBe(0.5)

    const mixed = computeConfidenceComponents({
      candidate,
      evidence: [makeRow('e1', 'user_correction')],
      repoSignals: [],
      priorOutcomes: [makeOutcome('success'), makeOutcome('failure'), makeOutcome('partial'), makeOutcome('aborted')],
    })
    expect(mixed.outcomeSupport).toBeCloseTo(0.375, 6)
    expect(mixed.userSignal).toBe(1)
  })

  it('scales repository support with matching signals and halves consistency after a duplicate failure', () => {
    const candidate = makeCandidate({
      hypothesis: 'Use bun add instead of bun install',
      validation: { passes: [{ pass: 'duplicate', ok: false, detail: 'exists' }], promotable: false, checkedAt: TS },
    })
    const components = computeConfidenceComponents({
      candidate,
      evidence: [makeRow('e1', 'repository')],
      repoSignals: ['package manager: bun', 'lockfile: bun.lock', 'CI: .github'],
      priorOutcomes: [],
    })

    expect(components.repositorySupport).toBeCloseTo(0.4 + 0.2 * 2, 6)
    expect(components.consistency).toBe(0.5)
  })
})