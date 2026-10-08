/**
 * W1-06 (#1503) — Reference handlers on the local authority: the SQLite
 * command store's transaction handle selects the local backend, tasks land
 * in the PersonalTask v3 store (visible to the existing Tasks UI through the
 * v2 view) and everything else under `{workspaceRoot}/work/`.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PersonalTask } from '@rox/core/tasks/personal'
import { SqliteCommandStore } from '../../commands/local-store'
import { PersonalTaskPersistStore } from '../../tasks/personal-persist'
import { configureReferenceRuntime, resetReferenceRuntime } from '../reference'
import { LocalWorkStore } from '../local-work-store'
import { createHarness } from './reference-harness'
import { ACTOR_ID, REFERENCE_SCENARIO, U } from './reference-scenario'

const NOW = new Date('2026-10-08T12:00:00.000Z')
let root: string
let store: SqliteCommandStore
let tasks: PersonalTaskPersistStore

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'rox-ref-local-'))
  store = new SqliteCommandStore({ workspaceRoot: root })
  tasks = new PersonalTaskPersistStore(join(root, 'config'))
  configureReferenceRuntime({ now: () => NOW, workspaceRoot: () => root, personalTaskStore: () => tasks, isFlagEnabled: () => true })
})
afterEach(() => {
  resetReferenceRuntime()
  store.close()
  rmSync(root, { recursive: true, force: true })
})

describe('reference handlers: local authority', () => {
  test('every local / by-target scenario command applies on the local backend', async () => {
    const harness = createHarness({ local: store })
    const failures: string[] = []
    let ran = 0
    let applied = 0
    let unavailable = 0
    for (const step of REFERENCE_SCENARIO) {
      const definition = harness.registry.get(step.type)!
      const receipt = await harness.run(step)
      if (definition.authority === 'workspace') {
        if (receipt.status !== 'rejected' || receipt.error?.code !== 'SERVER_REQUIRED') failures.push(`${step.type}: expected SERVER_REQUIRED`)
        continue
      }
      ran += 1
      if (receipt.status === 'applied') { applied += 1; continue }
      // Sections and list groups have no local store until TSK-1.
      if (/^task_(sections|list_groups)\./.test(step.type)) {
        if (receipt.error?.code !== 'UNAVAILABLE') failures.push(`${step.type}: expected UNAVAILABLE, got ${JSON.stringify(receipt.error ?? receipt)}`)
        unavailable += 1
        continue
      }
      // A record whose create is workspace-only (space, KPI, calendar, chat) was never made locally.
      if (receipt.error?.code === 'NOT_FOUND' && /^(space|kpi|calendar|calendar-event|channel) /.test(receipt.error.message)) continue
      failures.push(`${step.type}: ${JSON.stringify(receipt.error ?? receipt)}`)
    }
    expect(failures).toEqual([])
    expect(ran).toBeGreaterThan(100)
    expect(unavailable).toBe(7)
    expect(applied).toBeGreaterThan(ran - unavailable - 20)
  })

  test('tasks are PersonalTask v3 records the Tasks UI reads unchanged', async () => {
    const harness = createHarness({ local: store })
    expect(await harness.run({ type: 'tasks.create', payload: { id: U('t1'), title: 'Buy milk', priority: 'high', dueAt: '2026-10-09T00:00:00.000Z', duePrecision: 'day' } })).toMatchObject({ status: 'applied' })
    expect(await harness.run({ type: 'tasks.update_status', target: { kind: 'task', id: U('t1') }, payload: { statusKey: 'done' } })).toMatchObject({ status: 'applied' })
    const [legacy] = tasks.list()
    expect(legacy!.task).toMatchObject({ id: U('t1'), title: 'Buy milk', priority: 'high', completedAt: NOW.getTime(), dueAt: Date.parse('2026-10-09T00:00:00.000Z') })
    expect(tasks.getWorkItem(U('t1'))!.revision).toBe(2)
    expect(await harness.run({ type: 'tasks.delete', target: { kind: 'task', id: U('t1') }, payload: {} })).toMatchObject({ status: 'applied' })
    expect(tasks.getWorkItem(U('t1'))!.item.trashedAt).toBeTruthy()
  })

  test('other records are stored under {workspaceRoot}/work/', async () => {
    const harness = createHarness({ local: store })
    expect(await harness.run({ type: 'goals.create', payload: { id: U('g1'), name: 'Ship v3' } })).toMatchObject({ status: 'applied' })
    expect(existsSync(join(root, 'work'))).toBe(true)
    const dirs = readdirSync(join(root, 'work')).filter(name => !name.startsWith('.'))
    expect(dirs.length).toBeGreaterThan(0)
    const work = new LocalWorkStore({ workspaceRoot: root })
    const found = dirs.map(dir => work.get(dir, U('g1'))).find(Boolean)
    expect(found?.record).toMatchObject({ name: 'Ship v3' })
  })

  test('without a workspace root the command is NOT_FOUND', async () => {
    configureReferenceRuntime({ workspaceRoot: () => null })
    const receipt = await createHarness({ local: store }).run({ type: 'tasks.create', payload: { title: 'x' } })
    expect(receipt).toMatchObject({ status: 'rejected', error: { code: 'NOT_FOUND' } })
  })
})

describe('local authority: tasks keep every PersonalTask field', () => {
  const FULL: PersonalTask = {
    id: 't-full', title: 'All fields', notes: 'notes', list: 'upcoming', projectId: 'p-full', headingId: 'h-full', parentId: 't-parent',
    tags: ['a', 'b'], priority: 'medium', dueAt: 1_790_000_000_000, startAt: 1_789_000_000_000, evening: true,
    recurrence: { rule: 'weekly', interval: 2, weekdays: [1, 3], mode: 'after', until: 1_800_000_000_000 },
    links: [{ kind: 'note', id: 'n-1', label: 'Spec' }], order: 7, createdAt: 1_760_000_000_000, completedAt: 1_770_000_000_000,
    checklist: [{ id: 'c1', title: 'One', done: true }], reminderAt: 1_789_500_000_000, reminderTimeZone: 'Europe/Moscow',
    reminderDeliveredFor: 1_789_500_000_000, reminderRetryAt: 1_789_600_000_000, reminderError: 'presentation-failed',
    source: { kind: 'meeting', id: 'call-1', label: 'Standup' }, repeatOf: 't-prev', repeatOccurrenceAt: 1_789_000_000_000, repeatNextId: 't-next',
    updatedAt: 1_771_000_000_000,
  }

  test('a bus update changes only what it says; every other v2 field round-trips', async () => {
    tasks.put(FULL)
    const before = tasks.get('t-full')!.task
    expect(before).toEqual(FULL)
    const receipt = await createHarness({ local: store }).run({ type: 'tasks.update', target: { kind: 'task', id: 't-full' }, payload: { title: 'Renamed' } }, { commandId: 'full-update' })
    expect(receipt).toMatchObject({ status: 'applied' })
    expect(tasks.get('t-full')!.task).toEqual({ ...FULL, title: 'Renamed', updatedAt: NOW.getTime() })
    expect(tasks.getWorkItem('t-full')!.item).toMatchObject({ lastCommandId: 'full-update', listId: 'p-full', sectionId: 'h-full', origin: { kind: 'call', id: 'call-1' } })
  })

  test('an area-only task keeps its area; bus-only fields persist in the work half', async () => {
    tasks.put({ ...FULL, id: 't-area', projectId: undefined, headingId: undefined, areaId: 'a-home', completedAt: undefined })
    const harness = createHarness({ local: store })
    expect(await harness.run({ type: 'tasks.share', target: { kind: 'task', id: 't-area' }, payload: { workspaceId: U('ws-shared') } })).toMatchObject({ status: 'applied' })
    expect(await harness.run({ type: 'tasks.set_user_state', target: { kind: 'task', id: 't-area' }, payload: { hidden: true } })).toMatchObject({ status: 'applied' })
    const { task } = tasks.get('t-area')!
    expect(task.areaId).toBe('a-home')
    expect(task.reminderDeliveredFor).toBe(FULL.reminderDeliveredFor)
    expect(tasks.getWorkItem('t-area')!.item).toMatchObject({ sharedWorkspaceId: U('ws-shared'), listGroupId: 'a-home' })
    expect(await harness.run({ type: 'tasks.create', payload: { id: U('t-new'), title: 'New' } })).toMatchObject({ status: 'applied' })
    expect(tasks.getWorkItem(U('t-new'))!.item).toMatchObject({ createdBy: ACTOR_ID, ownerPrincipalId: ACTOR_ID })
  })

  test('tasks.duplicate drops provider identity, the repeat chain and reminder delivery', async () => {
    tasks.put(FULL)
    const persisted = tasks.getWorkItem('t-full')!
    tasks.putWorkItem({ ...persisted.item, nativeId: 'native-1', sourceStoreId: 'store-1' }, persisted.revision)
    const receipt = await createHarness({ local: store }).run({ type: 'tasks.duplicate', target: { kind: 'task', id: 't-full' }, payload: { id: U('t-copy') } })
    expect(receipt).toMatchObject({ status: 'applied' })
    const copy = tasks.getWorkItem(U('t-copy'))!.item
    for (const field of ['nativeId', 'sourceStoreId', 'repeatOf', 'repeatOccurrenceAt', 'repeatNextId', 'reminderDeliveredFor', 'reminderRetryAt', 'reminderError'] as const) {
      expect(copy[field]).toBeUndefined()
    }
    expect(copy).toMatchObject({ title: 'All fields', listId: 'p-full', tags: ['a', 'b'] })
  })
})

describe('local authority: retry after a lost receipt', () => {
  /** A second command store (fresh receipts) over the same workspace records. */
  function retryStore(): SqliteCommandStore {
    const other = join(root, `retry-${Math.random().toString(36).slice(2)}`)
    mkdirSync(other, { recursive: true })
    return new SqliteCommandStore({ workspaceRoot: other })
  }

  test('retried create, update and multi-record create apply once', async () => {
    const stores = [retryStore(), retryStore()]
    try {
      const [a, b] = stores.map(local => createHarness({ local }))
      const create = { type: 'tasks.create', payload: { title: 'Retry me' } }
      const first = await a!.run(create, { commandId: 'local-retry-create' })
      expect(await b!.run(create, { commandId: 'local-retry-create' })).toMatchObject({ status: 'applied', revision: 1, ref: first.ref })
      expect(tasks.list().filter(t => t.task.title === 'Retry me')).toHaveLength(1)

      const id = (first.ref as { id: string }).id
      const update = { type: 'tasks.update', target: { kind: 'task' as const, id }, payload: { title: 'Retried' } }
      expect(await a!.run(update, { commandId: 'local-retry-update', expectedRevision: 1 })).toMatchObject({ status: 'applied', revision: 2 })
      expect(await b!.run(update, { commandId: 'local-retry-update', expectedRevision: 1 })).toMatchObject({ status: 'applied', revision: 2 })
      expect(tasks.getWorkItem(id)!.revision).toBe(2)

      const goal = { type: 'goals.create', payload: { id: U('rg'), name: 'G', targets: [{ id: U('rg-t'), name: 'T', fromValue: 0, toValue: 1 }] } }
      expect(await a!.run(goal, { commandId: 'local-retry-goal' })).toMatchObject({ status: 'applied' })
      expect(await b!.run(goal, { commandId: 'local-retry-goal' })).toMatchObject({ status: 'applied', revision: 1 })
      // Another command reusing a taken target id fails before writing its goal.
      const clash = await a!.run({ type: 'goals.create', payload: { id: U('rg2'), name: 'G2', targets: [{ id: U('rg-t'), name: 'T', fromValue: 0, toValue: 1 }] } })
      expect(clash).toMatchObject({ status: 'conflict', conflict: { current: { error: 'id already exists' } } })
      expect(new LocalWorkStore({ workspaceRoot: root }).get('goals', U('rg2'))).toBeNull()
    } finally {
      for (const s of stores) s.close()
    }
  })
})

describe('local authority: task lists are the PersonalTask meta projects', () => {
  test('a bus-created list is a project the Tasks UI shows, and add_to_list sets projectId', async () => {
    const harness = createHarness({ local: store })
    expect(await harness.run({ type: 'task_lists.create', payload: { id: U('l-bus'), name: 'Sprint', notes: 'two weeks', statusSetEnabled: true } })).toMatchObject({ status: 'applied', revision: 1 })
    const meta = tasks.readMeta()!
    expect(meta.projects).toEqual([expect.objectContaining({ id: U('l-bus'), name: 'Sprint', notes: 'two weeks', order: 1 })])
    expect(tasks.readWorkMeta().taskLists.map(list => list.id)).toEqual([U('l-bus')])
    expect(existsSync(join(root, 'work', 'task-lists'))).toBe(false)

    await harness.run({ type: 'tasks.create', payload: { id: U('t-l'), title: 'In list' } })
    expect(await harness.run({ type: 'tasks.add_to_list', target: { kind: 'task', id: U('t-l') }, payload: { listId: U('l-bus') } })).toMatchObject({ status: 'applied' })
    expect(tasks.get(U('t-l'))!.task.projectId).toBe(U('l-bus'))

    expect(await harness.run({ type: 'task_lists.update', target: { kind: 'task-list', id: U('l-bus') }, payload: { name: 'Sprint 2' } }, { expectedRevision: 1 })).toMatchObject({ status: 'applied', revision: 2 })
    expect(tasks.readMeta()!.projects[0]).toMatchObject({ name: 'Sprint 2', notes: 'two weeks' })
    expect(await harness.run({ type: 'task_lists.archive', target: { kind: 'task-list', id: U('l-bus') }, payload: {} })).toMatchObject({ status: 'applied' })
    expect(tasks.readMeta()!.projects[0]!.completedAt).toBe(NOW.getTime())
    expect(await harness.run({ type: 'tasks.remove_from_list', target: { kind: 'task', id: U('t-l') }, payload: { listId: U('l-bus') } })).toMatchObject({ status: 'applied' })
    expect(tasks.get(U('t-l'))!.task.projectId).toBeUndefined()
    expect(await harness.run({ type: 'task_lists.delete', target: { kind: 'task-list', id: U('l-bus') }, payload: {} })).toMatchObject({ status: 'applied' })
    expect(tasks.readMeta()!.projects[0]!.trashedAt).toBe(NOW.getTime())
  })

  test('a list made in the Tasks UI is usable by the bus; a UI edit moves the list revision', async () => {
    tasks.writeMeta({ projects: [{ id: 'p-ui', name: 'Home', order: 3, areaId: 'a-1' }], areas: [{ id: 'a-1', name: 'Life', order: 0 }], headings: [], audit: [] })
    const harness = createHarness({ local: store })
    await harness.run({ type: 'tasks.create', payload: { id: U('t-ui'), title: 'Fix sink' } })
    expect(await harness.run({ type: 'tasks.add_to_list', target: { kind: 'task', id: U('t-ui') }, payload: { listId: 'p-ui' } })).toMatchObject({ status: 'applied' })
    expect(tasks.get(U('t-ui'))!.task.projectId).toBe('p-ui')
    expect(await harness.run({ type: 'task_lists.update', target: { kind: 'task-list', id: 'p-ui' }, payload: { notes: 'weekend' } }, { expectedRevision: 1 })).toMatchObject({ status: 'applied', revision: 2 })
    expect(tasks.readMeta()!.projects).toEqual([{ id: 'p-ui', name: 'Home', order: 3, areaId: 'a-1', notes: 'weekend' }])
    // The UI renames it: a bus write at the old revision conflicts.
    const meta = tasks.readMeta()!
    tasks.writeMeta({ ...meta, projects: [{ ...meta.projects[0]!, name: 'House' }] })
    expect(await harness.run({ type: 'task_lists.update', target: { kind: 'task-list', id: 'p-ui' }, payload: { notes: 'x' } }, { expectedRevision: 2 })).toMatchObject({ status: 'conflict', conflict: { currentRevision: 3 } })
    expect(await harness.run({ type: 'tasks.add_to_list', target: { kind: 'task', id: U('t-ui') }, payload: { listId: 'p-missing' } })).toMatchObject({ error: { code: 'NOT_FOUND' } })
  })

  test('sections and list groups are UNAVAILABLE locally; local lists are personal', async () => {
    const harness = createHarness({ local: store })
    tasks.writeMeta({ projects: [{ id: 'p-1', name: 'P', order: 1 }], areas: [], headings: [], audit: [] })
    expect(await harness.run({ type: 'task_sections.create', target: { kind: 'task-list', id: 'p-1' }, payload: { taskListId: 'p-1', title: 'S' } })).toMatchObject({ error: { code: 'UNAVAILABLE' } })
    expect(await harness.run({ type: 'task_list_groups.create', payload: { name: 'G' } })).toMatchObject({ error: { code: 'UNAVAILABLE' } })
    expect(await harness.run({ type: 'task_lists.create', payload: { name: 'Team', ownerType: 'space', ownerId: U('space') } })).toMatchObject({ error: { code: 'VALIDATION' } })
    expect(tasks.readMeta()!.headings).toEqual([])
  })
})
