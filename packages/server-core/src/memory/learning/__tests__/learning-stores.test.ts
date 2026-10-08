/**
 * Learning storage layer tests: round-trips, ordering, corrupt-line
 * tolerance, atomic rewrites, idempotency and status transitions.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type {
  LearningCandidate,
  LearningExperiment,
  LearningMutation,
  LearningObservation,
  TaskOutcome,
  UserCorrection,
} from '@rox/shared/memory/learning'
import { LearningStore } from '../LearningStore'
import { ObservationStore } from '../ObservationStore'
import { CandidateStore } from '../CandidateStore'
import { EvidenceStore } from '../EvidenceStore'
import { OutcomeStore } from '../OutcomeStore'
import { MutationStore } from '../MutationStore'
import { ExperimentStore } from '../ExperimentStore'
import { LearningAudit } from '../LearningAudit'
import type { StoredEvidence } from '../learning-types'
import { learningDirFor } from '../learning-types'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'learning-stores-'))
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

function learningDir(): string {
  return learningDirFor(root)
}



function mkCorrection(id: string, ts: string, sessionId = 's1'): UserCorrection {
  return {
    id,
    sessionId,
    original: `original ${id}`,
    corrected: `corrected ${id}`,
    category: 'tool',
    confidence: 0.9,
    ts,
  }
}

function mkObservation(id: string, ts: string, corrections: UserCorrection[] = []): LearningObservation {
  return {
    id,
    sessionId: 's1',
    workspaceId: 'ws1',
    ts,
    execution: { tools: [], skills: [], models: [], delegated: false },
    outcome: { status: 'success' },
    signals: { userCorrections: corrections, errors: [], branches: 0, interruptions: 0 },
    memory: { lessonsInjected: [], episodesRecalled: [], skillsInjected: [] },
    artifacts: { filesChanged: 0 },
  }
}

function mkCandidate(id: string, fingerprint: string, status: LearningCandidate['status']): LearningCandidate {
  return {
    id,
    fingerprint,
    type: 'lesson',
    scope: 'workspace',
    hypothesis: `hypothesis ${id}`,
    payload: {},
    evidence: [],
    confidence: 0.8,
    confidenceComponents: {
      recurrence: 1,
      evidenceQuality: 1,
      userSignal: 1,
      repositorySupport: 1,
      outcomeSupport: 1,
      consistency: 1,
    },
    status,
    validation: { passes: [], promotable: true, checkedAt: '2026-10-01T00:00:00.000Z' },
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  }
}

function mkEvidence(id: string, ref = `ref-${id}`): StoredEvidence {
  return { id, type: 'session', ref, weight: 1, ts: '2026-10-01T00:00:00.000Z' }
}

function mkOutcome(id: string, ts: string, fingerprint: string): TaskOutcome {
  return {
    id,
    sessionId: 's1',
    taskFingerprint: fingerprint,
    status: 'success',
    userCorrections: 0,
    memoryUsed: [],
    skillsUsed: [],
    errors: [],
    ts,
  }
}

function mkMutation(id: string, candidateId: string, status: LearningMutation['status']): LearningMutation {
  return {
    id,
    candidateId,
    targetType: 'lesson',
    targetId: `target-${id}`,
    before: null,
    after: { rule: 'x' },
    rollbackAvailable: true,
    status,
    ts: '2026-10-01T00:00:00.000Z',
  }
}

function mkExperiment(id: string, candidateId: string): LearningExperiment {
  return {
    id,
    candidateId,
    baseline: { behavior: 'a', metrics: {} },
    treatment: { behavior: 'b', metrics: {} },
    sampleSize: 10,
    status: 'running',
    createdAt: '2026-10-01T00:00:00.000Z',
  }
}

describe('LearningStore (generic)', () => {
  interface Row {
    id: string
    value: number
  }
  const fileFor = () => join(root, 'nested', 'rows.jsonl')

  it('round-trips save/get/saveMany/remove and creates parent dirs on demand', () => {
    const store = new LearningStore<Row>(fileFor())
    expect(store.list()).toEqual([])
    expect(store.get('missing')).toBeNull()

    store.save({ id: 'a', value: 1 })
    store.saveMany([
      { id: 'b', value: 2 },
      { id: 'a', value: 10 },
    ])
    expect(store.list()).toEqual([
      { id: 'a', value: 10 },
      { id: 'b', value: 2 },
    ])
    expect(store.get('a')).toEqual({ id: 'a', value: 10 })

    expect(store.remove('a')).toBe(true)
    expect(store.remove('a')).toBe(false)
    expect(store.list()).toEqual([{ id: 'b', value: 2 }])

    const reloaded = new LearningStore<Row>(fileFor())
    expect(reloaded.list()).toEqual([{ id: 'b', value: 2 }])
  })

  it('skips corrupt lines and rows without a string id', () => {
    const store = new LearningStore<Row>(fileFor())
    store.save({ id: 'ok', value: 1 })
    const raw = readFileSync(fileFor(), 'utf8')
    writeFileSync(
      fileFor(),
      `${raw}not json at all\n${JSON.stringify({ value: 2 })}\n${JSON.stringify({ id: 42 })}\n{"broken"\n\n`,
    )
    expect(store.list()).toEqual([{ id: 'ok', value: 1 }])
  })

  it('rewrites atomically and leaves no .tmp behind', () => {
    const store = new LearningStore<Row>(fileFor())
    store.save({ id: 'a', value: 1 })
    store.save({ id: 'b', value: 2 })
    store.remove('a')
    expect(readdirSync(join(root, 'nested'))).toEqual(['rows.jsonl'])
  })
})

describe('ObservationStore', () => {
  it('appends, lists oldest-first, and reports the most recent N for a limit', () => {
    const store = new ObservationStore(root)
    store.append(mkObservation('o1', '2026-10-01T00:00:00.000Z'))
    store.append(mkObservation('o2', '2026-10-02T00:00:00.000Z'))
    store.append(mkObservation('o3', '2026-10-03T00:00:00.000Z'))

    expect(store.list().map((o) => o.id)).toEqual(['o1', 'o2', 'o3'])
    expect(store.list(2).map((o) => o.id)).toEqual(['o2', 'o3'])
    expect(store.list(0)).toEqual([])
    expect(store.get('o2')?.ts).toBe('2026-10-02T00:00:00.000Z')

    const reloaded = new ObservationStore(root)
    expect(reloaded.list()).toHaveLength(3)
  })

  it('filters by session and tolerates corrupt lines', () => {
    const store = new ObservationStore(root)
    store.append(mkObservation('o1', '2026-10-01T00:00:00.000Z'))
    const other = { ...mkObservation('o2', '2026-10-02T00:00:00.000Z'), sessionId: 's2' }
    store.append(other)
    writeFileSync(store.filePath, `${readFileSync(store.filePath, 'utf8')}garbage line\n`)

    expect(store.listBySession('s1').map((o) => o.id)).toEqual(['o1'])
    expect(store.listBySession('s2').map((o) => o.id)).toEqual(['o2'])
  })

  it('flattens corrections from every observation, newest first', () => {
    const store = new ObservationStore(root)
    store.append(
      mkObservation('o1', '2026-10-01T00:00:00.000Z', [
        mkCorrection('c1', '2026-10-01T01:00:00.000Z'),
        mkCorrection('c3', '2026-10-03T01:00:00.000Z'),
      ]),
    )
    store.append(mkObservation('o2', '2026-10-02T00:00:00.000Z', [mkCorrection('c2', '2026-10-02T01:00:00.000Z')]))
    store.append(mkObservation('o3', '2026-10-04T00:00:00.000Z'))

    expect(store.listCorrections().map((c) => c.id)).toEqual(['c3', 'c2', 'c1'])
  })
})

describe('CandidateStore', () => {
  it('round-trips candidates and finds by fingerprint', () => {
    const store = new CandidateStore(root)
    store.save(mkCandidate('c1', 'fp-1', 'candidate'))
    store.save(mkCandidate('c2', 'fp-2', 'active'))

    expect(store.get('c1')?.fingerprint).toBe('fp-1')
    expect(store.getByFingerprint('fp-2')?.id).toBe('c2')
    expect(store.getByFingerprint('nope')).toBeNull()
  })

  it('filters by status and lists active candidates', () => {
    const store = new CandidateStore(root)
    store.save(mkCandidate('c1', 'fp-1', 'candidate'))
    store.save(mkCandidate('c2', 'fp-2', 'active'))
    store.save(mkCandidate('c3', 'fp-3', 'rejected'))
    store.save(mkCandidate('c4', 'fp-4', 'active'))

    expect(store.listByStatus('candidate').map((c) => c.id)).toEqual(['c1'])
    expect(store.listByStatus('rejected').map((c) => c.id)).toEqual(['c3'])
    expect(store.listActive().map((c) => c.id)).toEqual(['c2', 'c4'])
  })

  it('upserts by id and skips corrupt lines', () => {
    const store = new CandidateStore(root)
    store.save(mkCandidate('c1', 'fp-1', 'candidate'))
    store.save({ ...mkCandidate('c1', 'fp-1', 'approved'), confidence: 0.95 })
    writeFileSync(store.filePath, `${readFileSync(store.filePath, 'utf8')}{oops\n`)

    expect(store.list()).toHaveLength(1)
    expect(store.get('c1')?.status).toBe('approved')
    expect(store.get('c1')?.confidence).toBe(0.95)
    expect(readdirSync(learningDir()).filter((n) => n.endsWith('.tmp'))).toEqual([])
  })
})

describe('EvidenceStore', () => {
  it('appends evidence and is idempotent by id', () => {
    const store = new EvidenceStore(root)
    const first = store.add(mkEvidence('e1', 'ref-first'))
    const second = store.add(mkEvidence('e1', 'ref-second'))

    expect(first.ref).toBe('ref-first')
    expect(second.ref).toBe('ref-first')
    expect(store.list()).toHaveLength(1)
  })

  it('addMany returns each stored row and listByIds preserves file order', () => {
    const store = new EvidenceStore(root)
    const added = store.addMany([mkEvidence('e1'), mkEvidence('e2'), mkEvidence('e1', 'other')])
    expect(added.map((e) => e.id)).toEqual(['e1', 'e2', 'e1'])
    expect(store.list()).toHaveLength(2)

    store.add(mkEvidence('e3'))
    expect(store.listByIds(['e3', 'missing', 'e1']).map((e) => e.id)).toEqual(['e1', 'e3'])
    expect(store.get('e2')?.id).toBe('e2')
  })
})

describe('OutcomeStore', () => {
  it('appends, orders oldest-first and supports limit', () => {
    const store = new OutcomeStore(root)
    store.append(mkOutcome('t1', '2026-10-01T00:00:00.000Z', 'fp-a'))
    store.append(mkOutcome('t2', '2026-10-02T00:00:00.000Z', 'fp-b'))
    store.append(mkOutcome('t3', '2026-10-03T00:00:00.000Z', 'fp-a'))

    expect(store.list().map((o) => o.id)).toEqual(['t1', 't2', 't3'])
    expect(store.list(1).map((o) => o.id)).toEqual(['t3'])
    expect(store.get('t2')?.taskFingerprint).toBe('fp-b')
  })

  it('filters by session and fingerprint', () => {
    const store = new OutcomeStore(root)
    store.append(mkOutcome('t1', '2026-10-01T00:00:00.000Z', 'fp-a'))
    store.append({ ...mkOutcome('t2', '2026-10-02T00:00:00.000Z', 'fp-a'), sessionId: 's2' })
    store.append(mkOutcome('t3', '2026-10-03T00:00:00.000Z', 'fp-b'))

    expect(store.listBySession('s1').map((o) => o.id)).toEqual(['t1', 't3'])
    expect(store.listByFingerprint('fp-a').map((o) => o.id)).toEqual(['t1', 't2'])
  })
})

describe('MutationStore', () => {
  it('saves, reads and filters by candidate/status', () => {
    const store = new MutationStore(root)
    store.save(mkMutation('m1', 'cand-1', 'applied'))
    store.save(mkMutation('m2', 'cand-1', 'confirmed'))
    store.save(mkMutation('m3', 'cand-2', 'reverted'))

    expect(store.get('m1')?.status).toBe('applied')
    expect(store.listByCandidate('cand-1').map((m) => m.id)).toEqual(['m1', 'm2'])
    expect(store.listApplied().map((m) => m.id)).toEqual(['m1'])
    expect(store.listActive().map((m) => m.id)).toEqual(['m1', 'm2'])
  })

  it('marks a mutation confirmed', () => {
    const store = new MutationStore(root)
    store.save(mkMutation('m1', 'cand-1', 'applied'))

    const confirmed = store.markConfirmed('m1')
    expect(confirmed?.status).toBe('confirmed')
    expect(new MutationStore(root).get('m1')?.status).toBe('confirmed')
    expect(store.markConfirmed('missing')).toBeNull()
    expect(store.listActive().map((m) => m.id)).toEqual(['m1'])
  })

  it('marks a mutation reverted with ts and reason', () => {
    const store = new MutationStore(root)
    store.save(mkMutation('m1', 'cand-1', 'applied'))

    const reverted = store.markReverted('m1', '2026-10-05T00:00:00.000Z', 'success dropped')
    expect(reverted?.status).toBe('reverted')
    expect(reverted?.revertedAt).toBe('2026-10-05T00:00:00.000Z')
    expect(reverted?.reason).toBe('success dropped')
    expect(store.listActive()).toEqual([])
    expect(store.markReverted('missing', '2026-10-05T00:00:00.000Z')).toBeNull()
  })
})

describe('ExperimentStore', () => {
  it('round-trips experiments and filters by candidate', () => {
    const store = new ExperimentStore(root)
    store.save(mkExperiment('x1', 'cand-1'))
    store.save(mkExperiment('x2', 'cand-2'))
    store.save({ ...mkExperiment('x1', 'cand-1'), status: 'passed' })

    expect(store.list()).toHaveLength(2)
    expect(store.get('x1')?.status).toBe('passed')
    expect(store.listByCandidate('cand-1').map((e) => e.id)).toEqual(['x1'])
  })
})

describe('LearningAudit', () => {
  it('appends entries as JSONL in order', () => {
    const audit = new LearningAudit(root)
    audit.append({ ts: '2026-10-01T00:00:00.000Z', actor: 'system', action: 'candidate.created', target: 'c1' })
    audit.append({
      ts: '2026-10-02T00:00:00.000Z',
      actor: 'user',
      action: 'candidate.approved',
      target: 'c1',
      detail: 'ok',
    })

    const lines = readFileSync(join(learningDir(), 'learning-audit.jsonl'), 'utf8').trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[0]).action).toBe('candidate.created')
    expect(JSON.parse(lines[1]).detail).toBe('ok')
  })

  it('never throws when the directory cannot be created', () => {
    writeFileSync(join(root, 'memory'), 'not a directory')
    const audit = new LearningAudit(root)
    expect(() => audit.append({ ts: 't', actor: 'a', action: 'x', target: 'y' })).not.toThrow()
    expect(existsSync(audit.filePath)).toBe(false)
  })
})