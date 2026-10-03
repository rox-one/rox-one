import { describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { calculateOkrCycle, createOkrCycle, saveProjectOkr, loadProjectOkr } from '../okr.ts'
import { createProject } from '../storage.ts'
import type { OkrCycle } from '../types.ts'

const kr = (id: string, weight: number, current: number | null, target: number, baseline = 0) => ({
  id, title: id, weight, measurement: { kind: 'numeric' as const, direction: 'increase' as const, baseline, target, current, unit: 'items' },
})

function cycle(objectives: OkrCycle['objectives']): OkrCycle {
  return { id: 'cycle-1', projectId: 'project-id', title: 'Q1', startDate: '2026-01-01', endDate: '2026-03-31', timezone: 'UTC', status: 'draft', revision: 0, objectives }
}

describe('project OKR calculation', () => {
  it('normalizes objective and KR weights independently and preserves partial unknown contribution', () => {
    const result = calculateOkrCycle(cycle([
      { id: 'a', title: 'A', weight: 3, keyResults: [kr('known', 3, 100, 100), kr('unknown', 1, null, 100)] },
      { id: 'b', title: 'B', weight: 1, keyResults: [kr('half', 1, 50, 100)] },
    ]))

    expect(result.objectives[0]?.progress).toEqual({ knownContribution: 0.75, coverage: 0.75, score: null })
    expect(result.progress).toEqual({ knownContribution: 0.6875, coverage: 0.8125, score: null })
    expect(result.objectives[0]?.keyResults.map((item) => item.normalizedWeight)).toEqual([0.75, 0.25])
  })

  it('calculates published weighted progress independently of input order', () => {
    const objectives = [
      { id: 'a', title: 'A', weight: 75, keyResults: [kr('full', 1, 100, 100)] },
      { id: 'b', title: 'B', weight: 25, keyResults: [kr('half', 1, 50, 100)] },
    ]
    const forward = calculateOkrCycle(cycle(objectives))
    const reversed = calculateOkrCycle(cycle([...objectives].reverse()))
    expect(forward.progress.score).toBe(0.875)
    expect(reversed.progress.score).toBe(0.875)
  })

  it('matches the 60/40 project oracle when objective scores are 87.5% and 50%', () => {
    const result = calculateOkrCycle(cycle([
      { id: 'a', title: 'A', weight: 60, keyResults: [
        kr('a-full', 75, 100, 100),
        kr('a-half', 25, 50, 100),
      ] },
      { id: 'b', title: 'B', weight: 40, keyResults: [kr('b-half', 1, 50, 100)] },
    ]))
    expect(result.objectives.map((objective) => objective.progress.score)).toEqual([0.875, 0.5])
    expect(result.progress.score).toBe(0.725)
  })

  it('scores decrease targets in the selected direction and rejects an opposing target', () => {
    const decreasing = {
      id: 'decrease',
      title: 'Reduce latency',
      weight: 1,
      keyResults: [{
        id: 'latency',
        title: 'Median latency',
        weight: 1,
        measurement: { kind: 'numeric' as const, direction: 'decrease' as const, baseline: 100, target: 50, current: 75, unit: 'ms' },
      }],
    }
    expect(calculateOkrCycle(cycle([decreasing])).progress.score).toBe(0.5)
    expect(() => calculateOkrCycle(cycle([{
      ...decreasing,
      keyResults: [{ ...decreasing.keyResults[0]!, measurement: { ...decreasing.keyResults[0]!.measurement, target: 110 } }],
    }]))).toThrow(/direction/i)
  })

  it('rejects invalid cycle dates and timezones', () => {
    expect(() => createOkrCycle('project', { title: 'Q1', startDate: '2026-04-01', endDate: '2026-03-31', timezone: 'UTC' })).toThrow()
    expect(() => createOkrCycle('project', { title: 'Q1', startDate: '2026-01-01', endDate: '2026-03-31', timezone: 'Not/A_Timezone' })).toThrow()
  })

  it('returns unknown for invalid weights, zero denominators, and missing binary evidence', () => {
    expect(() => calculateOkrCycle(cycle([{ id: 'a', title: 'A', weight: 0, keyResults: [kr('x', 1, 1, 2)] }]))).toThrow()
    expect(() => calculateOkrCycle(cycle([{ id: 'a', title: 'A', weight: 1, keyResults: [kr('x', 1, 1, 1, 1)] }]))).toThrow()
    const binaryResult = (achieved: boolean | null) => cycle([{ id: 'a', title: 'A', weight: 1, keyResults: [{ id: 'binary', title: 'Binary', weight: 1, measurement: { kind: 'binary' as const, achieved, evidence: [] } }] }])
    expect(() => calculateOkrCycle(binaryResult(true))).toThrow(/evidence/i)
    const result = calculateOkrCycle(binaryResult(null))
    expect(result.progress.score).toBeNull()
    expect(result.progress.coverage).toBe(0)
  })
})

describe('project OKR persistence', () => {
  it('survives reload with stable IDs and rejects a stale writer without replacing the winner', () => {
    const root = mkdtempSync(join(tmpdir(), 'project-okr-'))
    try {
      const project = createProject(root, { name: 'OKR project' })
      const initial = createOkrCycle(project.id, { title: 'Q1', startDate: '2026-01-01', endDate: '2026-03-31' })
      const saved = saveProjectOkr(root, project.slug, 0, { cycles: [initial] })
      expect(loadProjectOkr(root, project.slug)).toEqual(saved)
      const edited = { ...initial, title: 'Q1 revised' }
      const winner = saveProjectOkr(root, project.slug, 1, { cycles: [edited] })
      expect(() => saveProjectOkr(root, project.slug, 1, { cycles: [initial] })).toThrow(/conflict/i)
      expect(loadProjectOkr(root, project.slug)).toEqual(winner)
      expect(winner.cycles[0]?.id).toBe(initial.id)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('keeps published cycles immutable and retains them through archive instead of deletion', () => {
    const root = mkdtempSync(join(tmpdir(), 'project-okr-lifecycle-'))
    try {
      const project = createProject(root, { name: 'Lifecycle project' })
      const draft = {
        ...createOkrCycle(project.id, { title: 'Q1', startDate: '2026-01-01', endDate: '2026-03-31' }),
        objectives: [{ id: 'objective', title: 'Objective', weight: 1, keyResults: [kr('kr', 1, null, 100)] }],
      }
      const savedDraft = saveProjectOkr(root, project.slug, 0, { cycles: [draft] })
      const published = { ...savedDraft.cycles[0]!, status: 'published' as const, publishedAt: '2026-01-02T00:00:00.000Z' }
      const savedPublished = saveProjectOkr(root, project.slug, savedDraft.revision, { cycles: [published] })
      expect(() => saveProjectOkr(root, project.slug, savedPublished.revision, { cycles: [{ ...published, title: 'Mutated' }] })).toThrow(/immutable/i)
      expect(() => saveProjectOkr(root, project.slug, savedPublished.revision, { cycles: [] })).toThrow(/cannot be deleted/i)
      const archived = { ...published, status: 'archived' as const, archivedAt: '2026-01-03T00:00:00.000Z' }
      const savedArchived = saveProjectOkr(root, project.slug, savedPublished.revision, { cycles: [archived] })
      expect(loadProjectOkr(root, project.slug)).toEqual(savedArchived)
      expect(() => saveProjectOkr(root, project.slug, savedArchived.revision, { cycles: [{ ...archived, title: 'Changed archive' }] })).toThrow(/immutable/i)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
