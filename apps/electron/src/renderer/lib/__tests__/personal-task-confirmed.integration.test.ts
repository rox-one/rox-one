import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PersonalTask } from '@craft-agent/core/tasks/personal'
import { PersonalTaskPersistStore } from '../../../../../../packages/server-core/src/tasks/personal-persist'
import { putPersonalTasks } from '../../../../../../packages/server-core/src/tasks/personal-tasks-service'
import { PersonalTaskCreationError, putPersonalTaskConfirmed, type PersonalTasksApi } from '../personal-tasks-sync'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

const task: PersonalTask = {
  id: 'stable-task', title: 'Real native creation', notes: '', list: 'inbox', tags: [],
  priority: 'none', evening: false, links: [], order: 0, createdAt: 1,
}

function storage() {
  const root = mkdtempSync(join(tmpdir(), 'confirmed-task-integration-'))
  roots.push(root)
  const store = new PersonalTaskPersistStore(root)
  const api = { personalTasksPut: async writes => putPersonalTasks(store, writes) } as PersonalTasksApi
  return { root, store, api }
}

test('confirmed quick creation consumes the real native revision-aware receipt and survives reopen', async () => {
  const { root, api } = storage()
  expect(await putPersonalTaskConfirmed(api, task)).toEqual({ task, revision: 1 })
  expect(new PersonalTaskPersistStore(root).get(task.id)).toEqual({ task, revision: 1 })
})

test('a lost create ACK reconciles the same persisted ID after restart without another revision', async () => {
  const { root, store } = storage()
  const lost = { personalTasksPut: async (writes: Parameters<PersonalTasksApi['personalTasksPut']>[0]) => {
    putPersonalTasks(store, writes)
    throw new Error('response lost after commit')
  } } as unknown as PersonalTasksApi
  let attempted: PersonalTask | undefined
  try { await putPersonalTaskConfirmed(lost, task) }
  catch (error) {
    expect(error).toBeInstanceOf(PersonalTaskCreationError)
    attempted = (error as PersonalTaskCreationError).task
  }
  expect(attempted).toEqual(task)
  const reopened = new PersonalTaskPersistStore(root)
  const retry = { personalTasksPut: async writes => putPersonalTasks(reopened, writes) } as PersonalTasksApi
  const confirmed = await putPersonalTaskConfirmed(retry, attempted!)
  expect(confirmed).toEqual({ task, revision: 1 })
  expect(reopened.list()).toHaveLength(1)
  const edit = putPersonalTasks(reopened, [{ task: { ...confirmed.task, title: 'Later edit' }, expectedRevision: confirmed.revision }])
  expect(edit.accepted[0]?.revision).toBe(2)
})

test('an old same-ID retry refuses a changed canonical payload and preserves the foreign update', async () => {
  const { store, api } = storage()
  const confirmed = await putPersonalTaskConfirmed(api, task)
  putPersonalTasks(store, [{ task: { ...task, title: 'Another writer' }, expectedRevision: confirmed.revision }])
  await expect(putPersonalTaskConfirmed(api, task)).rejects.toBeInstanceOf(PersonalTaskCreationError)
  expect(store.get(task.id)?.task.title).toBe('Another writer')
  expect(store.get(task.id)?.revision).toBe(2)
})

test('an empty or rejected native receipt never clears the retained create attempt', async () => {
  for (const receipt of [
    { accepted: [], conflicts: [], rejected: [] },
    { accepted: [], conflicts: [], rejected: [task.id] },
  ]) {
    const api = { personalTasksPut: async () => receipt } as unknown as PersonalTasksApi
    let error: unknown
    try { await putPersonalTaskConfirmed(api, task) } catch (caught) { error = caught }
    expect(error).toBeInstanceOf(PersonalTaskCreationError)
    expect((error as PersonalTaskCreationError).task).toEqual(task)
    expect((error as PersonalTaskCreationError).task).not.toBe(task)
  }
})
