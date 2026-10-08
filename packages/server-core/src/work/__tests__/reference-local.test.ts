/**
 * W1-06 (#1503) — Reference handlers on the local authority: the SQLite
 * command store's transaction handle selects the local backend, tasks land
 * in the PersonalTask v3 store (visible to the existing Tasks UI through the
 * v2 view) and everything else under `{workspaceRoot}/work/`.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SqliteCommandStore } from '../../commands/local-store'
import { PersonalTaskPersistStore } from '../../tasks/personal-persist'
import { configureReferenceRuntime, resetReferenceRuntime } from '../reference'
import { LocalWorkStore } from '../local-work-store'
import { createHarness } from './reference-harness'
import { REFERENCE_SCENARIO, U } from './reference-scenario'

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
    for (const step of REFERENCE_SCENARIO) {
      const definition = harness.registry.get(step.type)!
      const receipt = await harness.run(step)
      if (definition.authority === 'workspace') {
        if (receipt.status !== 'rejected' || receipt.error?.code !== 'SERVER_REQUIRED') failures.push(`${step.type}: expected SERVER_REQUIRED`)
        continue
      }
      ran += 1
      if (receipt.status === 'applied') { applied += 1; continue }
      // A record whose create is workspace-only (space, KPI, calendar, chat) was never made locally.
      if (receipt.error?.code === 'NOT_FOUND' && /^(space|kpi|calendar|calendar-event|channel) /.test(receipt.error.message)) continue
      failures.push(`${step.type}: ${JSON.stringify(receipt.error ?? receipt)}`)
    }
    expect(failures).toEqual([])
    expect(ran).toBeGreaterThan(100)
    expect(applied).toBeGreaterThan(ran - 20)
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
    expect(await harness.run({ type: 'task_lists.create', payload: { id: U('l1'), name: 'Home' } })).toMatchObject({ status: 'applied' })
    expect(existsSync(join(root, 'work'))).toBe(true)
    const dirs = readdirSync(join(root, 'work')).filter(name => !name.startsWith('.'))
    expect(dirs.length).toBeGreaterThan(0)
    const work = new LocalWorkStore({ workspaceRoot: root })
    const found = dirs.map(dir => work.get(dir, U('l1'))).find(Boolean)
    expect(found?.record).toMatchObject({ name: 'Home' })
  })

  test('without a workspace root the command is NOT_FOUND', async () => {
    configureReferenceRuntime({ workspaceRoot: () => null })
    const receipt = await createHarness({ local: store }).run({ type: 'tasks.create', payload: { title: 'x' } })
    expect(receipt).toMatchObject({ status: 'rejected', error: { code: 'NOT_FOUND' } })
  })
})
