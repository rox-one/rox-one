import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PersonalTaskStore } from '@rox/core/tasks/personal'
import { PersonalTaskPersistStore } from '../../../../../../../../../../packages/server-core/src/tasks/personal-persist'
import { putPersonalTasks, readPersonalTasks } from '../../../../../../../../../../packages/server-core/src/tasks/personal-tasks-service'
import { commitPersonalTaskLink } from '../native-commit'
import { derivePersonalTaskSignals } from '../index'
import type { Session } from '@rox/shared/protocol/dto'
import type { TourObservation } from '../../../../runtime/hooks'
import type { PersonalTasksApi } from '../../../../../../lib/personal-tasks-sync'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'tour-native-personal-task-'))
  roots.push(root)
  const store = new PersonalTaskPersistStore(root)
  const task = new PersonalTaskStore().create({ id: 'task-a', title: 'Private native task', list: 'inbox' })
  const record = store.put(task)
  const api: Pick<PersonalTasksApi, 'personalTasksList' | 'personalTasksPut'> = {
    personalTasksList: async () => readPersonalTasks(store),
    personalTasksPut: async writes => putPersonalTasks(store, writes),
  }
  return { root, store, task, record, api }
}

test('T-TASKS-DELEGATE: real isolated store persists exact task→session link across reopen', async () => {
  const { root, task, record, api } = setup()
  const linked = await commitPersonalTaskLink(api, task, 'native-session', record.revision)
  const reopened = new PersonalTaskPersistStore(root).get(task.id)
  expect(reopened).toEqual(linked)
  expect(reopened?.task.links).toContainEqual({ kind: 'session', id: 'native-session' })
  const observation: TourObservation = { binding: { workspaceId: 'ws-a', panelId: 'tasks-panel', clientProfileId: 'profile', runToken: 'attempt-a' }, operationToken: 'delegate-a', at: 1 }
  const session = { id: 'native-session', workspaceId: 'ws-a', messages: [] } as unknown as Session
  expect(derivePersonalTaskSignals(observation, { kind: 'delegated', expected: linked.task, persisted: reopened, session, sessionId: session.id, promptAccepted: true })[0]?.level).toBe('verified')
})

test('a stale task revision cannot overwrite another writer while adding a delegation link', async () => {
  const { store, task, record, api } = setup()
  store.put({ ...task, title: 'Foreign edit' })
  await expect(commitPersonalTaskLink(api, task, 'session-a', record.revision)).rejects.toThrow('changed before delegation')
  expect(store.get(task.id)?.task.title).toBe('Foreign edit')
  expect(store.get(task.id)?.task.links).toEqual([])
})

test('failed delegation write and failed read-back cannot produce verified evidence', async () => {
  const { task, record, api } = setup()
  await expect(commitPersonalTaskLink({ ...api, personalTasksPut: async () => ({ accepted: [], conflicts: [], rejected: [task.id] }) }, task, 'session-a', record.revision)).rejects.toThrow('not confirmed')
  let reads = 0
  await expect(commitPersonalTaskLink({ ...api, personalTasksList: async () => {
    const snapshot = await api.personalTasksList()
    return ++reads === 1 ? snapshot : { ...snapshot, tasks: [] }
  } }, task, 'session-a', record.revision)).rejects.toThrow('read-back failed')
})

test('delegating an unsynced user task can create the real saved task and link in one native commit', async () => {
  const { store, task, api } = setup()
  store.delete(task.id)
  const record = await commitPersonalTaskLink(api, task, 'session-a', null)
  expect(record.revision).toBe(1)
  expect(store.get(task.id)).toEqual(record)
})
