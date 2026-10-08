/**
 * W1-06 (#1503) — MIG-04 / MIG-05: project `okr.json` and `roadmap.json`
 * milestones → the local work store (DATA-MODEL §6.2).
 *
 * - MIG-04: cycle → `okr-cycle` (`originProjectId`); objective → `goal`
 *   (`goalKind: 'objective'`, personal scope, weight); numeric KR →
 *   `goal-target` (baseline → from, target → to, current → value, unit,
 *   direction, evidence, measuredAt, freshness); binary KR → `goal-check`
 *   (achieved → done); goal → project `aligned-to` link, role `okr-of`.
 * - MIG-05: milestone → `milestone` (same id; planned / active / blocked →
 *   `pending` + `roadmapStatus`, done → `done`; dates and stages copied);
 *   `taskIds[]` → `milestoneId` + `projectId` on the PersonalTask v3 record.
 *
 * Gated: nothing runs while `goals.v1` is off. Idempotent: ids are
 * deterministic and an existing record is never overwritten (a re-run, or a
 * record already edited through the bus, is reported as `unchanged`). The
 * source files are only read; they stay on disk as the backup (the export
 * that regenerates them lands with the goals module).
 */

import { existsSync, mkdirSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { EntityRef } from '@rox/core/entities'
import type { WorkItem } from '@rox/core/tasks/personal'
import {
  loadProjectConfig, loadProjectRoadmap, readProjectOkrLenient,
  type OkrCycle, type OkrKeyResult, type OkrObjective, type ProjectConfig, type ProjectOkrDocument, type ProjectRoadmap, type RoadmapMilestone,
} from '@rox/shared/projects'
import type { PersonalTaskPersistStore } from '../../tasks/personal-persist'
import { LocalWorkStore, LOCAL_WORK_SCHEMA_VERSION } from '../local-work-store'
import { collectionSpec } from '../reference/collections'
import { deterministicId } from '../reference/engine'
import { refString } from '../reference/ops'
import type { RecordData } from '../reference/types'

export const GOALS_MIGRATION_FLAG = 'goals.v1'
export const GOALS_MIGRATION_ID = 'mig-04-05'

export interface MigratedRecord {
  collection: string
  id: string
  record: RecordData
}

export interface MilestoneTaskLink {
  taskId: string
  milestoneId: string
  projectId: string
}

export interface MappingContext {
  workspaceId: string
  /** ISO timestamp stamped as createdAt / updatedAt. */
  now: string
  actorId: string
}

type ProjectRef = Pick<ProjectConfig, 'id' | 'slug'>

const stamp = (ctx: MappingContext, migration: 'MIG-04' | 'MIG-05', projectId: string, sourceId: string): RecordData => ({
  createdAt: ctx.now,
  updatedAt: ctx.now,
  createdBy: ctx.actorId,
  origin: { migration, projectId, sourceId },
})

const sortKey = (index: number) => `a${index.toString(36).padStart(3, '0')}`
const date = (value: string | undefined) => (value && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : undefined)

function clean(record: RecordData): RecordData {
  for (const key of Object.keys(record)) if (record[key] === undefined) delete record[key]
  return record
}

/** Same id formula as the reference handlers' `addLink`, so a later `goals.unalign` finds it. */
export function linkId(workspaceId: string, from: EntityRef, to: EntityRef, relation: string): string {
  return deterministicId(workspaceId, 'link', refString(from), refString(to), relation)
}

function mapKeyResult(ctx: MappingContext, project: ProjectRef, goalId: string, kr: OkrKeyResult, index: number): MigratedRecord {
  const id = deterministicId('mig-04', project.id, 'key-result', kr.id)
  const base = { ...stamp(ctx, 'MIG-04', project.id, kr.id), goalId, name: kr.title, weight: kr.weight, sortKey: sortKey(index), ownerLabel: kr.owner, legacyStatus: kr.status }
  const m = kr.measurement
  if (m.kind === 'numeric') {
    return {
      collection: 'goal-target', id,
      record: clean({
        ...base, fromValue: m.baseline, toValue: m.target, value: m.current, unit: m.unit, direction: m.direction,
        evidence: m.evidence ?? [], source: m.source, measuredAt: m.measuredAt, freshness: m.freshness, freshnessCheckedAt: m.freshnessCheckedAt,
      }),
    }
  }
  return {
    collection: 'goal-check', id,
    record: clean({
      ...base, done: m.achieved === true, ...(m.achieved === null ? { achievedUnknown: true } : {}),
      evidence: m.evidence ?? [], source: m.source, measuredAt: m.measuredAt, freshness: m.freshness, freshnessCheckedAt: m.freshnessCheckedAt,
    }),
  }
}

function mapObjective(ctx: MappingContext, project: ProjectRef, cycle: OkrCycle, cycleId: string, objective: OkrObjective, index: number): MigratedRecord[] {
  const goalId = deterministicId('mig-04', project.id, 'objective', objective.id)
  const goal: MigratedRecord = {
    collection: 'goal', id: goalId,
    record: clean({
      ...stamp(ctx, 'MIG-04', project.id, objective.id),
      scope: 'personal', goalKind: 'objective', okrCycleId: cycleId, name: objective.title, description: objective.description,
      creatorId: ctx.actorId, ownerLabel: objective.owner, weight: objective.weight, sortKey: sortKey(index),
      startOn: date(cycle.startDate), dueOn: date(cycle.endDate), publishState: cycle.status === 'draft' ? 'draft' : 'published',
      ...(cycle.status === 'archived' ? { closedAt: cycle.archivedAt ?? ctx.now } : {}),
    }),
  }
  const from: EntityRef = { kind: 'goal', id: goalId }
  const to: EntityRef = { kind: 'project', id: project.id }
  const link: MigratedRecord = {
    collection: 'entity-link', id: linkId(ctx.workspaceId, from, to, 'aligned-to'),
    record: { ...stamp(ctx, 'MIG-04', project.id, objective.id), fromKind: 'goal', fromId: goalId, fromFragment: null, toKind: 'project', toId: project.id, toFragment: null, relation: 'aligned-to', role: 'okr-of', anchor: null },
  }
  return [goal, ...objective.keyResults.map((kr, krIndex) => mapKeyResult(ctx, project, goalId, kr, krIndex)), link]
}

/** MIG-04: pure mapping of one project's OKR document. */
export function mapProjectOkr(ctx: MappingContext, project: ProjectRef, document: ProjectOkrDocument): MigratedRecord[] {
  const out: MigratedRecord[] = []
  for (const cycle of document.cycles) {
    const cycleId = deterministicId('mig-04', project.id, 'cycle', cycle.id)
    out.push({
      collection: 'okr-cycle', id: cycleId,
      record: clean({
        ...stamp(ctx, 'MIG-04', project.id, cycle.id),
        name: cycle.title, startsOn: date(cycle.startDate), endsOn: date(cycle.endDate), timeZone: cycle.timezone, status: cycle.status,
        originProjectId: project.id, publishedAt: cycle.publishedAt, archivedAt: cycle.archivedAt,
      }),
    })
    cycle.objectives.forEach((objective, index) => out.push(...mapObjective(ctx, project, cycle, cycleId, objective, index)))
  }
  return out
}

function mapMilestone(ctx: MappingContext, project: ProjectRef, milestone: RoadmapMilestone, index: number): MigratedRecord {
  return {
    collection: 'milestone', id: milestone.id,
    record: clean({
      ...stamp(ctx, 'MIG-05', project.id, milestone.id),
      projectId: project.id, title: milestone.title, description: milestone.description || undefined,
      status: milestone.status === 'done' ? 'done' : 'pending', roadmapStatus: milestone.status,
      ...(milestone.status === 'done' ? { completedAt: ctx.now } : {}),
      startOn: date(milestone.startDate), dueOn: date(milestone.dueDate), stages: milestone.stages, sortKey: sortKey(index),
    }),
  }
}

/** MIG-05: pure mapping of one project's roadmap milestones (+ the task links to apply). */
export function mapProjectRoadmap(ctx: MappingContext, project: ProjectRef, roadmap: ProjectRoadmap): { records: MigratedRecord[]; taskLinks: MilestoneTaskLink[] } {
  const records = roadmap.milestones.map((milestone, index) => mapMilestone(ctx, project, milestone, index))
  const taskLinks = roadmap.milestones.flatMap(milestone => [...new Set(milestone.taskIds)].map(taskId => ({ taskId, milestoneId: milestone.id, projectId: project.id })))
  return { records, taskLinks }
}

export interface GoalsMigrationProjectReport {
  slug: string
  projectId: string
  created: Record<string, number>
  unchanged: number
  tasksLinked: number
  tasksMissing: string[]
  notes: string[]
  errors: string[]
}

export type GoalsMigrationReport =
  | { status: 'skipped'; reason: 'flag_off' }
  | { status: 'migrated'; migration: typeof GOALS_MIGRATION_ID; ranAt: string; created: number; unchanged: number; projects: GoalsMigrationProjectReport[] }

export interface GoalsMigrationOptions {
  workspaceRoot: string
  workspaceId: string
  isFlagEnabled(flag: string): boolean
  /** PersonalTask v3 store for MIG-05 task links (absent → links reported as missing). */
  tasks?: PersonalTaskPersistStore | null
  now?: () => Date
  actorId?: string
}

function projectSlugs(workspaceRoot: string): string[] {
  const dir = join(workspaceRoot, 'projects')
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort()
}

function writeIfAbsent(work: LocalWorkStore, item: MigratedRecord): boolean {
  const dir = collectionSpec(item.collection).localDir ?? item.collection
  if (work.get(dir, item.id)) return false
  work.write({ id: item.id, collection: dir, revision: 1, schemaVersion: LOCAL_WORK_SCHEMA_VERSION, record: { ...item.record, lastCommandId: GOALS_MIGRATION_ID } })
  return true
}

function linkTask(tasks: PersonalTaskPersistStore, link: MilestoneTaskLink): 'linked' | 'unchanged' | 'missing' {
  let current
  try { current = tasks.getWorkItem(link.taskId) } catch { return 'missing' }
  if (!current) return 'missing'
  // A task already placed in another milestone / project keeps the newer placement.
  if (current.item.milestoneId || current.item.projectId) return 'unchanged'
  const next: WorkItem = { ...current.item, milestoneId: link.milestoneId, projectId: link.projectId }
  const result = tasks.putWorkItem(next, current.revision)
  return result.status === 'accepted' ? 'linked' : 'unchanged'
}

export function goalsMigrationReportPath(workspaceRoot: string): string {
  return join(new LocalWorkStore({ workspaceRoot }).root, '.migrations', `${GOALS_MIGRATION_ID}.json`)
}

/** Runs MIG-04 + MIG-05 for every project of a workspace (no-op while `goals.v1` is off). */
export function runGoalsMigration(options: GoalsMigrationOptions): GoalsMigrationReport {
  if (!options.isFlagEnabled(GOALS_MIGRATION_FLAG)) return { status: 'skipped', reason: 'flag_off' }
  const ctx: MappingContext = { workspaceId: options.workspaceId, now: (options.now?.() ?? new Date()).toISOString(), actorId: options.actorId ?? 'local' }
  const work = new LocalWorkStore({ workspaceRoot: options.workspaceRoot })
  const projects: GoalsMigrationProjectReport[] = []
  for (const slug of projectSlugs(options.workspaceRoot)) {
    const config = loadProjectConfig(options.workspaceRoot, slug)
    if (!config) continue
    const project = { id: config.id, slug: config.slug || slug }
    const report: GoalsMigrationProjectReport = { slug, projectId: project.id, created: {}, unchanged: 0, tasksLinked: 0, tasksMissing: [], notes: [], errors: [] }
    const records: MigratedRecord[] = []
    let taskLinks: MilestoneTaskLink[] = []
    try {
      const okr = readProjectOkrLenient(options.workspaceRoot, slug)
      if (okr) {
        if (okr.lenient) report.notes.push('okr: strict validation failed; imported leniently')
        report.notes.push(...okr.dropped.map(note => `okr: ${note}`))
        records.push(...mapProjectOkr(ctx, project, okr.document))
      }
    } catch (error) { report.errors.push(`okr: ${(error as Error).message}`) }
    try {
      const loaded = loadProjectRoadmap(options.workspaceRoot, slug)
      if (loaded.corrupt) report.errors.push('roadmap: corrupt roadmap.json skipped')
      else if (loaded.exists) {
        const mapped = mapProjectRoadmap(ctx, project, loaded.roadmap)
        records.push(...mapped.records)
        taskLinks = mapped.taskLinks
      }
    } catch (error) { report.errors.push(`roadmap: ${(error as Error).message}`) }
    for (const item of records) {
      if (writeIfAbsent(work, item)) report.created[item.collection] = (report.created[item.collection] ?? 0) + 1
      else report.unchanged += 1
    }
    for (const link of taskLinks) {
      const outcome = options.tasks ? linkTask(options.tasks, link) : 'missing'
      if (outcome === 'linked') report.tasksLinked += 1
      else if (outcome === 'missing') report.tasksMissing.push(link.taskId)
    }
    projects.push(report)
  }
  const created = projects.reduce((sum, project) => sum + Object.values(project.created).reduce((a, b) => a + b, 0), 0)
  const result: GoalsMigrationReport = { status: 'migrated', migration: GOALS_MIGRATION_ID, ranAt: ctx.now, created, unchanged: projects.reduce((sum, p) => sum + p.unchanged, 0), projects }
  const path = goalsMigrationReportPath(options.workspaceRoot)
  mkdirSync(join(path, '..'), { recursive: true, mode: 0o700 })
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 })
  renameSync(tmp, path)
  return result
}

const ensured = new Set<string>()

/**
 * Runs the migration once per workspace root and process, when `goals.v1` is
 * on and no report exists yet. Never throws (a failed run is retried on the
 * next process start; the commands keep working).
 */
export function ensureGoalsMigrated(options: GoalsMigrationOptions): GoalsMigrationReport | null {
  if (!options.isFlagEnabled(GOALS_MIGRATION_FLAG) || ensured.has(options.workspaceRoot)) return null
  ensured.add(options.workspaceRoot)
  if (existsSync(goalsMigrationReportPath(options.workspaceRoot))) return null
  try { return runGoalsMigration(options) } catch { return null }
}

export function resetGoalsMigrationMemo(): void {
  ensured.clear()
}
