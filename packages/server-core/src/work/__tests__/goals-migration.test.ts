/**
 * W1-06 (#1503) — MIG-04 (project okr.json → okr-cycle / goal / goal-target /
 * goal-check + aligned-to link) and MIG-05 (roadmap.json milestones →
 * milestone + task placement): fixtures, golden output, idempotent re-run,
 * lenient reads, and the `goals.v1` gate.
 *
 * Golden: `fixtures/goals-migration/golden/work.json`. Regenerate with
 * `UPDATE_GOLDEN=1 bun test goals-migration` after an intentional change.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PersonalTaskPersistStore } from '../../tasks/personal-persist'
import { LocalWorkStore } from '../local-work-store'
import { GOALS_MIGRATION_FLAG, ensureGoalsMigrated, goalsMigrationReportPath, resetGoalsMigrationMemo, runGoalsMigration, type GoalsMigrationOptions } from '../migrations/goals-migration'
import { deterministicId } from '../reference/engine'
import { configureReferenceRuntime, resetReferenceRuntime } from '../reference/module'
import { SqliteCommandStore } from '../../commands/local-store'
import { createHarness } from './reference-harness'

const FIXTURES = join(import.meta.dir, 'fixtures', 'goals-migration')
const GOLDEN = join(FIXTURES, 'golden', 'work.json')
const update = process.env.UPDATE_GOLDEN === '1'
const NOW = new Date('2026-10-08T12:00:00.000Z')
const WS = 'ws-goals-migration'

let dir: string
let workspaceRoot: string
let tasks: PersonalTaskPersistStore

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'w1-06-mig45-'))
  workspaceRoot = join(dir, 'workspace')
  cpSync(join(FIXTURES, 'workspace'), workspaceRoot, { recursive: true })
  // A truncated roadmap (kept out of the fixture tree so JSON tooling never trips on it).
  writeFileSync(join(workspaceRoot, 'projects', 'gamma', 'roadmap.json'), '{ "schemaVersion": 1, "milestones": [ ')
  cpSync(join(FIXTURES, 'personal-tasks'), join(dir, 'config', 'personal-tasks'), { recursive: true })
  tasks = new PersonalTaskPersistStore(join(dir, 'config'))
  resetGoalsMigrationMemo()
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const options = (flags: string[] = [GOALS_MIGRATION_FLAG]): GoalsMigrationOptions => ({
  workspaceRoot, workspaceId: WS, isFlagEnabled: flag => flags.includes(flag), tasks, now: () => NOW, actorId: 'principal-mark',
})

/** Every work-store file, sorted, as one JSON document. */
function snapshot(): Record<string, unknown> {
  const root = join(workspaceRoot, 'work')
  const out: Record<string, unknown> = {}
  if (!existsSync(root)) return out
  for (const collection of readdirSync(root).filter(name => !name.startsWith('.')).sort()) {
    for (const file of readdirSync(join(root, collection)).sort()) out[`${collection}/${file}`] = JSON.parse(readFileSync(join(root, collection, file), 'utf8'))
  }
  return out
}

describe('MIG-04 / MIG-05 (goals.v1)', () => {
  test('flag off: nothing is read or written', () => {
    expect(runGoalsMigration(options([]))).toEqual({ status: 'skipped', reason: 'flag_off' })
    expect(existsSync(join(workspaceRoot, 'work'))).toBe(false)
    expect(ensureGoalsMigrated(options([]))).toBeNull()
    expect(existsSync(goalsMigrationReportPath(workspaceRoot))).toBe(false)
  })

  test('migrates the fixtures to the golden work store and report', () => {
    const report = runGoalsMigration(options())
    if (report.status !== 'migrated') throw new Error('expected a run')
    const text = `${JSON.stringify({ report, work: snapshot() }, null, 2)}\n`
    if (update || !existsSync(GOLDEN)) { mkdirSync(join(GOLDEN, '..'), { recursive: true }); writeFileSync(GOLDEN, text) }
    expect(text).toBe(readFileSync(GOLDEN, 'utf8'))

    const alpha = report.projects.find(p => p.slug === 'alpha')!
    expect(alpha.created).toEqual({ 'okr-cycle': 1, goal: 2, 'goal-target': 2, 'goal-check': 1, 'entity-link': 2, milestone: 3 })
    expect(alpha.tasksLinked).toBe(2)
    expect(alpha.tasksMissing).toEqual(['task-missing'])
    const beta = report.projects.find(p => p.slug === 'beta')!
    expect(beta.notes[0]).toBe('okr: strict validation failed; imported leniently')
    expect(beta.created).toEqual({ 'okr-cycle': 1, goal: 1, 'goal-target': 1, 'entity-link': 1 })
    expect(report.projects.find(p => p.slug === 'gamma')!.errors).toEqual(['roadmap: corrupt roadmap.json skipped'])

    // Spot checks of the DATA-MODEL §6.2 mapping.
    const work = new LocalWorkStore({ workspaceRoot })
    const goal = work.get('goals', deterministicId('mig-04', 'proj-alpha', 'objective', 'obj-growth'))!.record
    expect(goal).toMatchObject({ goalKind: 'objective', scope: 'personal', name: 'Grow weekly active teams', weight: 2, publishState: 'published', okrCycleId: deterministicId('mig-04', 'proj-alpha', 'cycle', 'cycle-q4') })
    expect(work.get('goal-targets', deterministicId('mig-04', 'proj-alpha', 'key-result', 'kr-wat'))!.record).toMatchObject({ fromValue: 40, toValue: 100, value: 62, unit: 'teams', direction: 'increase', freshness: 'fresh' })
    expect(work.get('goal-checks', deterministicId('mig-04', 'proj-alpha', 'key-result', 'kr-launch'))!.record).toMatchObject({ done: true })
    expect(work.get('milestones', 'ms-beta')!.record).toMatchObject({ projectId: 'proj-alpha', status: 'pending', roadmapStatus: 'active', startOn: '2026-10-01', dueOn: '2026-11-15' })
    expect(work.get('milestones', 'ms-ga')!.record).toMatchObject({ status: 'done', roadmapStatus: 'done' })
    expect(tasks.getWorkItem('task-1')!.item).toMatchObject({ milestoneId: 'ms-beta', projectId: 'proj-alpha' })
    // The Tasks UI view is untouched (v2 task bytes unchanged; only the v3 work half moved).
    expect(tasks.get('task-1')!.task.title).toBe('Send invites')
    // Source files are only read.
    expect(readFileSync(join(workspaceRoot, 'projects', 'alpha', 'okr.json'), 'utf8')).toBe(readFileSync(join(FIXTURES, 'workspace', 'projects', 'alpha', 'okr.json'), 'utf8'))
  })

  test('re-run is idempotent and never overwrites edited records', () => {
    runGoalsMigration(options())
    const work = new LocalWorkStore({ workspaceRoot })
    const ms = work.get('milestones', 'ms-beta')!
    work.put('milestones', 'ms-beta', { ...ms.record, title: 'Edited' }, ms.revision)
    const before = snapshot()
    const taskRevision = tasks.getWorkItem('task-1')!.revision
    const again = runGoalsMigration(options())
    if (again.status !== 'migrated') throw new Error('expected a run')
    expect(again.created).toBe(0)
    expect(again.unchanged).toBe(Object.keys(before).length)
    expect(snapshot()).toEqual(before)
    expect(work.get('milestones', 'ms-beta')!.record.title).toBe('Edited')
    expect(tasks.getWorkItem('task-1')!.revision).toBe(taskRevision)
  })

  test('a task already placed in a project keeps its placement', () => {
    const placed = tasks.getWorkItem('task-2')!
    tasks.putWorkItem({ ...placed.item, projectId: 'proj-other' }, placed.revision)
    runGoalsMigration(options())
    expect(tasks.getWorkItem('task-2')!.item).toMatchObject({ projectId: 'proj-other' })
    expect(tasks.getWorkItem('task-2')!.item.milestoneId).toBeUndefined()
  })

  test('ensureGoalsMigrated runs once per workspace and skips when a report exists', () => {
    rmSync(join(workspaceRoot, 'projects', 'gamma', 'roadmap.json'))
    const first = ensureGoalsMigrated(options())
    expect(first).toMatchObject({ status: 'migrated', complete: true })
    expect(first?.status).toBe('migrated')
    expect(ensureGoalsMigrated(options())).toBeNull()
    resetGoalsMigrationMemo()
    expect(ensureGoalsMigrated(options())).toBeNull()
  })

  test('the first local command with goals.v1 on migrates, then goal commands edit the migrated records', async () => {
    rmSync(join(workspaceRoot, 'projects', 'gamma', 'roadmap.json'))
    const store = new SqliteCommandStore({ workspaceRoot })
    configureReferenceRuntime({ now: () => NOW, workspaceRoot: () => workspaceRoot, personalTaskStore: () => tasks, isFlagEnabled: () => true })
    try {
      const goalId = deterministicId('mig-04', 'proj-alpha', 'objective', 'obj-growth')
      const receipt = await createHarness({ local: store }).run({ type: 'goals.update_name', target: { kind: 'goal', id: goalId }, payload: { name: 'Grow active teams' } })
      expect(receipt).toMatchObject({ status: 'applied', revision: 2 })
      expect(existsSync(goalsMigrationReportPath(workspaceRoot))).toBe(true)
      expect(new LocalWorkStore({ workspaceRoot }).get('goals', goalId)!.record.name).toBe('Grow active teams')
    } finally {
      resetReferenceRuntime()
      store.close()
    }
  })

  test('a run with project errors writes no report, so the next start retries', () => {
    const first = ensureGoalsMigrated(options())
    expect(first).toMatchObject({ status: 'migrated', complete: false })
    expect(existsSync(goalsMigrationReportPath(workspaceRoot))).toBe(false)
    // Next process start: the corrupt roadmap was fixed.
    writeFileSync(join(workspaceRoot, 'projects', 'gamma', 'roadmap.json'), JSON.stringify(roadmap([{ id: 'ms-gamma', title: 'Gamma', status: 'planned', stages: [], taskIds: [] }])))
    resetGoalsMigrationMemo()
    const retried = ensureGoalsMigrated(options())
    expect(retried).toMatchObject({ status: 'migrated', complete: true })
    if (retried?.status !== 'migrated') throw new Error('expected a run')
    expect(retried.projects.find(p => p.slug === 'gamma')!.created).toEqual({ milestone: 1 })
    expect(retried.projects.find(p => p.slug === 'alpha')!.created).toEqual({})
    expect(existsSync(goalsMigrationReportPath(workspaceRoot))).toBe(true)
  })

  test('MIG-05: the same milestone id in two projects is reported, never merged', () => {
    tasks.put({ id: 'task-g', title: 'Gamma task', notes: '', list: 'inbox', tags: [], priority: 'none', evening: false, links: [], order: 1, createdAt: 1 })
    writeFileSync(join(workspaceRoot, 'projects', 'gamma', 'roadmap.json'), JSON.stringify(roadmap([{ id: 'ms-beta', title: 'Gamma beta', status: 'active', stages: [], taskIds: ['task-g'] }])))
    const report = runGoalsMigration(options())
    if (report.status !== 'migrated') throw new Error('expected a run')
    const gamma = report.projects.find(p => p.slug === 'gamma')!
    expect(gamma.errors).toEqual(['milestone ms-beta: id already used by proj-alpha; not imported'])
    expect(gamma.tasksLinked).toBe(0)
    expect(report.complete).toBe(false)
    expect(existsSync(goalsMigrationReportPath(workspaceRoot))).toBe(false)
    expect(new LocalWorkStore({ workspaceRoot }).get('milestones', 'ms-beta')!.record).toMatchObject({ projectId: 'proj-alpha', title: 'Public beta' })
    expect(tasks.getWorkItem('task-g')!.item.milestoneId).toBeUndefined()
    expect(tasks.getWorkItem('task-g')!.item.projectId).toBeUndefined()
  })
})

function roadmap(milestones: unknown[]): Record<string, unknown> {
  return { schemaVersion: 1, goal: 'Gamma', expectedResult: '', doneCriteria: [], inputs: [], requirements: [], risks: [], openQuestions: [], updatedAt: 1_790_000_000_000, milestones }
}
