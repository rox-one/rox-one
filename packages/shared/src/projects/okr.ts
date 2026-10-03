import { randomUUID } from 'crypto'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { atomicWriteFileSync } from '../utils/files.ts'
import { loadProjectConfig, getProjectPath } from './storage.ts'
import type {
  OkrEvidence,
  OkrCycle,
  OkrKeyResult,
  OkrMeasurement,
  OkrObjective,
  OkrProgress,
  ProjectOkrDocument,
} from './types.ts'

export interface OkrCycleInput {
  title: string
  startDate: string
  endDate: string
  timezone?: string
}

export interface OkrKeyResultCalculation {
  id: string
  score: number | null
  normalizedWeight: number
  progress: OkrProgress
}

export interface OkrObjectiveCalculation {
  id: string
  score: number | null
  normalizedWeight: number
  progress: OkrProgress
  keyResults: OkrKeyResultCalculation[]
}

export interface OkrCalculation {
  progress: OkrProgress
  objectives: OkrObjectiveCalculation[]
}

export class ProjectOkrConflictError extends Error {
  constructor(readonly expectedRevision: number, readonly actualRevision: number) {
    super(`Project OKR revision conflict: expected ${expectedRevision}, found ${actualRevision}`)
    this.name = 'ProjectOkrConflictError'
  }
}

export function createOkrCycle(projectId: string, input: OkrCycleInput): OkrCycle {
  if (!projectId.trim()) throw new Error('A project ID is required')
  validateDateRange(input.startDate, input.endDate)
  const timezone = input.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  validateTimezone(timezone)
  return {
    id: randomUUID(),
    projectId,
    title: input.title.trim(),
    startDate: input.startDate,
    endDate: input.endDate,
    timezone,
    status: 'draft',
    revision: 0,
    objectives: [],
  }
}

export function calculateOkrCycle(cycle: OkrCycle): OkrCalculation {
  validateCycle(cycle)
  const objectiveWeightTotal = sumWeights(cycle.objectives, `cycle ${cycle.id} objectives`)
  const objectives = cycle.objectives.map((objective) => {
    const keyResultWeightTotal = sumWeights(objective.keyResults, `objective ${objective.id} key results`)
    const keyResults = objective.keyResults.map((keyResult) => {
      const score = measurementScore(keyResult.measurement)
      const normalizedWeight = keyResult.weight / keyResultWeightTotal
      return {
        id: keyResult.id,
        score,
        normalizedWeight,
        progress: {
          knownContribution: score === null ? 0 : normalizedWeight * score,
          coverage: score === null ? 0 : normalizedWeight,
          score,
        },
      }
    })
    const progress = aggregate(keyResults.map((result) => ({
      weight: result.normalizedWeight,
      score: result.score,
    })))
    return {
      id: objective.id,
      score: progress.score,
      normalizedWeight: objective.weight / objectiveWeightTotal,
      progress,
      keyResults,
    }
  })
  const progress = aggregate(objectives.map((objective) => ({
    weight: objective.normalizedWeight,
    score: objective.score,
    knownContribution: objective.progress.knownContribution,
    coverage: objective.progress.coverage,
  })))
  return { progress, objectives }
}

/** Reads the canonical per-project file. Missing data is an empty revision-zero document. */
export function loadProjectOkr(workspaceRootPath: string, projectSlug: string): ProjectOkrDocument {
  const project = loadProjectConfig(workspaceRootPath, projectSlug)
  if (!project) throw new Error(`Project not found: ${projectSlug}`)
  const path = join(getProjectPath(workspaceRootPath, projectSlug), 'okr.json')
  if (!existsSync(path)) return { projectId: project.id, revision: 0, cycles: [] }

  const document = JSON.parse(readFileSync(path, 'utf8')) as ProjectOkrDocument
  validateDocument(document, project.id)
  return document
}

/** Synchronous compare-and-swap keeps read/compare/atomic replace indivisible in the local RPC process. */
export function saveProjectOkr(
  workspaceRootPath: string,
  projectSlug: string,
  expectedRevision: number,
  input: Pick<ProjectOkrDocument, 'cycles'>,
): ProjectOkrDocument {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw new Error('Expected project OKR revision must be a nonnegative integer')
  }
  const project = loadProjectConfig(workspaceRootPath, projectSlug)
  if (!project) throw new Error(`Project not found: ${projectSlug}`)
  const current = loadProjectOkr(workspaceRootPath, projectSlug)
  if (current.revision !== expectedRevision) {
    throw new ProjectOkrConflictError(expectedRevision, current.revision)
  }

  const seen = new Set<string>()
  for (const cycle of input.cycles) {
    validateCycle(cycle)
    if (cycle.projectId !== project.id) throw new Error('OKR cycle belongs to a different project')
    if (seen.has(cycle.id)) throw new Error(`Duplicate OKR cycle ID: ${cycle.id}`)
    seen.add(cycle.id)
  }
  const candidates = new Map(input.cycles.map((cycle) => [cycle.id, cycle]))
  for (const previous of current.cycles) {
    const candidate = candidates.get(previous.id)
    if (previous.status !== 'draft' && !candidate) {
      throw new Error('Published and archived OKR cycles cannot be deleted; archive them instead')
    }
    if (previous.status === 'archived' && candidate && !sameCycleContent(previous, candidate)) {
      throw new Error('Archived OKR cycles are immutable')
    }
    if (previous.status === 'published' && candidate && !sameCycleContent(previous, candidate)) {
      const archived = { ...candidate, status: 'published' as const, archivedAt: previous.archivedAt }
      if (candidate.status !== 'archived' || !sameCycleContent(previous, archived)) {
        throw new Error('Published OKR cycles are immutable; archive without editing instead')
      }
    }
  }
  const previousCycles = new Map(current.cycles.map((cycle) => [cycle.id, cycle]))
  const cycles = input.cycles.map((cycle) => {
    const previous = previousCycles.get(cycle.id)
    return {
      ...cycle,
      revision: previous
        ? previous.revision + (sameCycleContent(previous, cycle) ? 0 : 1)
        : 1,
    }
  })
  const next: ProjectOkrDocument = {
    projectId: project.id,
    revision: current.revision + 1,
    cycles,
  }
  validateDocument(next, project.id)
  atomicWriteFileSync(join(getProjectPath(workspaceRootPath, projectSlug), 'okr.json'), JSON.stringify(next, null, 2))
  return next
}

function validateDocument(document: ProjectOkrDocument, projectId: string): void {
  if (!document || document.projectId !== projectId || !Number.isSafeInteger(document.revision) || document.revision < 0 || !Array.isArray(document.cycles)) {
    throw new Error('Invalid project OKR document')
  }
  const ids = new Set<string>()
  for (const cycle of document.cycles) {
    validateCycle(cycle)
    if (cycle.projectId !== projectId || ids.has(cycle.id)) throw new Error('Invalid or duplicate project OKR cycle')
    ids.add(cycle.id)
  }
}

function validateCycle(cycle: OkrCycle): void {
  if (!cycle || typeof cycle.id !== 'string' || !cycle.id.trim() || typeof cycle.projectId !== 'string' || !cycle.projectId.trim()) {
    throw new Error('OKR cycle and project IDs are required')
  }
  if (typeof cycle.title !== 'string' || !cycle.title.trim()) throw new Error('OKR cycle title is required')
  validateDateRange(cycle.startDate, cycle.endDate)
  validateTimezone(cycle.timezone)
  if (!['draft', 'published', 'archived'].includes(cycle.status)) throw new Error('Invalid OKR cycle status')
  if (!Number.isSafeInteger(cycle.revision) || cycle.revision < 0 || !Array.isArray(cycle.objectives)) throw new Error('Invalid OKR cycle revision or objectives')
  const objectiveIds = new Set<string>()
  for (const objective of cycle.objectives) {
    validateItem(objective, objectiveIds, 'objective')
    if (!Array.isArray(objective.keyResults)) throw new Error(`Invalid key results for objective ${objective.id}`)
    const keyResultIds = new Set<string>()
    for (const keyResult of objective.keyResults) {
      validateItem(keyResult, keyResultIds, 'key result')
      validateMeasurement(keyResult.measurement)
    }
  }
  if (cycle.status === 'published' && (
    cycle.objectives.length === 0 || cycle.objectives.some((objective) => objective.keyResults.length === 0)
  )) {
    throw new Error('Published OKR cycles require at least one objective and one key result per objective')
  }
  if (cycle.status !== 'archived' && cycle.objectives.length) {
    sumWeights(cycle.objectives, `cycle ${cycle.id} objectives`)
    for (const objective of cycle.objectives) {
      if (objective.keyResults.length) sumWeights(objective.keyResults, `objective ${objective.id} key results`)
    }
  }
}

function validateItem(item: OkrObjective | OkrKeyResult, ids: Set<string>, label: string): void {
  if (!item || typeof item.id !== 'string' || !item.id.trim() || ids.has(item.id)) throw new Error(`Invalid or duplicate OKR ${label} ID`)
  if (typeof item.title !== 'string' || !item.title.trim()) throw new Error(`OKR ${label} title is required`)
  if (typeof item.weight !== 'number' || !Number.isFinite(item.weight) || item.weight < 0) throw new Error(`OKR ${label} weight must be finite and nonnegative`)
  ids.add(item.id)
}

function validateMeasurement(measurement: OkrMeasurement): void {
  if (measurement.kind === 'numeric') {
    if (![measurement.baseline, measurement.target].every(Number.isFinite)) throw new Error('Numeric baseline and target must be finite')
    if (measurement.current !== null && !Number.isFinite(measurement.current)) throw new Error('Numeric current measurement must be finite or unknown')
    if (measurement.baseline === measurement.target) throw new Error('Numeric target must differ from baseline')
    if (measurement.direction !== 'increase' && measurement.direction !== 'decrease') throw new Error('Invalid numeric measurement direction')
    if ((measurement.direction === 'increase' && measurement.target < measurement.baseline) || (measurement.direction === 'decrease' && measurement.target > measurement.baseline)) {
      throw new Error('Numeric target must follow the selected measurement direction')
    }
    if (typeof measurement.unit !== 'string' || !measurement.unit.trim()) throw new Error('Numeric measurements require a unit')
    if (measurement.evidence !== undefined) validateEvidence(measurement.evidence)
  } else if (measurement.kind === 'binary') {
    if (measurement.achieved !== null && typeof measurement.achieved !== 'boolean') throw new Error('Binary achievement must be true, false, or unknown')
    validateEvidence(measurement.evidence)
    if (measurement.achieved === true && measurement.evidence.length === 0) {
      throw new Error('Binary achievement requires evidence')
    }
  } else {
    throw new Error('Unknown OKR measurement kind')
  }
}

function validateEvidence(evidence: OkrEvidence[]): void {
  if (!Array.isArray(evidence)) throw new Error('Evidence must be an array')
  const ids = new Set<string>()
  for (const item of evidence) {
    if (!item.id.trim() || !item.label.trim() || ids.has(item.id)) throw new Error('Evidence requires unique IDs and labels')
    ids.add(item.id)
  }
}

function validateDateRange(startDate: string, endDate: string): void {
  const start = Date.parse(`${startDate}T00:00:00Z`)
  const end = Date.parse(`${endDate}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || !Number.isFinite(start) || !Number.isFinite(end) || new Date(start).toISOString().slice(0, 10) !== startDate || new Date(end).toISOString().slice(0, 10) !== endDate || end <= start) {
    throw new Error('OKR cycle end date must be later than its start date')
  }
}

function validateTimezone(timezone: string): void {
  if (typeof timezone !== 'string' || !timezone.trim()) throw new Error('OKR cycle timezone is required')
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone })
  } catch {
    throw new Error(`Invalid OKR cycle timezone: ${timezone}`)
  }
}

function sumWeights(items: Array<{ weight: number }>, label: string): number {
  let total = 0
  for (const item of items) {
    if (!Number.isFinite(item.weight) || item.weight < 0) throw new Error(`${label} weights must be finite and nonnegative`)
    total += item.weight
  }
  if (!Number.isFinite(total) || total <= 0) throw new Error(`${label} weights must have a positive finite sum`)
  return total
}

function measurementScore(measurement: OkrMeasurement): number | null {
  if (measurement.kind === 'numeric') {
    if (measurement.current === null) return null
    const numerator = measurement.direction === 'increase'
      ? measurement.current - measurement.baseline
      : measurement.baseline - measurement.current
    const denominator = measurement.direction === 'increase'
      ? measurement.target - measurement.baseline
      : measurement.baseline - measurement.target
    if ((measurement.direction === 'increase' && denominator <= 0) || (measurement.direction === 'decrease' && denominator <= 0)) {
      throw new Error('Numeric target must follow the selected measurement direction')
    }
    return clamp(numerator / denominator)
  }
  if (measurement.achieved === null || measurement.evidence.length === 0) return null
  return measurement.achieved ? 1 : 0
}

function aggregate(items: Array<{ weight: number; score: number | null; knownContribution?: number; coverage?: number }>): OkrProgress {
  let knownContribution = 0
  let coverage = 0
  for (const item of items) {
    if (item.knownContribution !== undefined && item.coverage !== undefined) {
      knownContribution += item.weight * item.knownContribution
      coverage += item.weight * item.coverage
    } else if (item.score !== null) {
      knownContribution += item.weight * item.score
      coverage += item.weight
    }
  }
  return {
    knownContribution,
    coverage,
    score: coverage >= 1 - Number.EPSILON * 8 ? roundProgressScore(knownContribution) : null,
  }
}

// Published scores are rounded to 12 decimal places; contributions retain full precision.
function roundProgressScore(score: number): number {
  const precision = 10 ** 12
  return Math.round(score * precision) / precision
}

function sameCycleContent(left: OkrCycle, right: OkrCycle): boolean {
  const { revision: _leftRevision, ...leftContent } = left
  const { revision: _rightRevision, ...rightContent } = right
  return JSON.stringify(leftContent) === JSON.stringify(rightContent)
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value))
}
