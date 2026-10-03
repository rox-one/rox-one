import { expect, test } from 'bun:test'
import { PersonalTaskStore } from '@rox/core/tasks/personal'
import type { Session } from '@rox/shared/protocol/dto'
import type { LoadedProject } from '@rox/shared/projects/types'
import type { TourObservation } from '../../../../runtime/hooks'
import { derivePersonalTaskSignals, deriveProjectSignals, tasksProjectsCapabilities } from '../index'

const observation: TourObservation = { binding: { workspaceId: 'ws-a', panelId: 'panel-a', clientProfileId: 'profile', runToken: 'old-run' }, operationToken: 'native-operation', at: 10 }
const task = new PersonalTaskStore().create({ id: 'task-a', title: 'PRIVATE TASK CONTENT', list: 'inbox' })
const linked = { ...task, links: [{ kind: 'session' as const, id: 'session-a' }] }
const session = { id: 'session-a', workspaceId: 'ws-a', messages: [] } as unknown as Session

test('T-TASKS-CREATE: an optimistic row, invalid revision or changed native payload cannot verify creation', () => {
  expect(derivePersonalTaskSignals(observation, { kind: 'created', expected: task, persisted: null })).toEqual([])
  expect(derivePersonalTaskSignals(observation, { kind: 'created', expected: task, persisted: { task, revision: 0 } })).toEqual([])
  expect(derivePersonalTaskSignals(observation, { kind: 'created', expected: task, persisted: { task: { ...task, title: 'Other writer' }, revision: 2 } })).toEqual([])
})

test('T-TASKS-CREATE: verified native evidence retains original binding/time and contains no task content', () => {
  const [signal] = derivePersonalTaskSignals(observation, { kind: 'created', expected: task, persisted: { task, revision: 1 } }, 20)
  expect(signal).toMatchObject({ name: 'personal-task.persisted', level: 'verified', origin: 'native-commit', binding: observation.binding, operationToken: observation.operationToken, operationStartedAt: 10, at: 20 })
  expect(JSON.stringify(signal)).not.toContain(task.title)
  expect(derivePersonalTaskSignals(null, { kind: 'created', expected: task, persisted: { task, revision: 1 } })).toEqual([])
})

test('T-TASKS-DELEGATE: saved task, exact linked native session and accepted prompt are all required', () => {
  const evidence = { kind: 'delegated' as const, expected: linked, persisted: { task: linked, revision: 2 }, session, sessionId: session.id, promptAccepted: true }
  expect(derivePersonalTaskSignals(observation, evidence)[0]?.name).toBe('personal-task.delegated')
  for (const change of [
    { persisted: null }, { session: null }, { promptAccepted: false },
    { session: { ...session, workspaceId: 'ws-b' } }, { sessionId: 'another-session' },
    { expected: task, persisted: { task, revision: 1 } },
  ]) expect(derivePersonalTaskSignals(observation, { ...evidence, ...change })).toEqual([])
})

test('T-PROJECT-OPEN: visible native project must belong to the bound workspace', () => {
  const project = { workspaceId: 'ws-a', config: { id: 'project-a' } } as LoadedProject
  expect(deriveProjectSignals(observation, project, true)[0]).toMatchObject({ name: 'project.visible', level: 'observed', origin: 'ui-observation' })
  expect(deriveProjectSignals(observation, project, false)).toEqual([])
  expect(deriveProjectSignals(observation, { ...project, workspaceId: 'ws-b' }, true)).toEqual([])
  expect(deriveProjectSignals(observation, null, true)).toEqual([])
})

test('capabilities distinguish native persistence, hydration, storage failure and missing delegation target', () => {
  const ready = { projectsApi: true, personalTasksApi: true, syncState: 'synced' as const, delegationApi: true, workspacePresent: true, taskPresent: true }
  expect(tasksProjectsCapabilities(ready)['task.delegation-available']).toEqual({ state: 'ready' })
  expect(tasksProjectsCapabilities({ ...ready, personalTasksApi: false })['personal-tasks.available']).toEqual({ state: 'unavailable', reason: 'api-unavailable' })
  expect(tasksProjectsCapabilities({ ...ready, syncState: 'syncing' })['personal-tasks.available']?.state).toBe('pending')
  expect(tasksProjectsCapabilities({ ...ready, syncState: 'error' })['task.delegation-available']).toEqual({ state: 'unavailable', reason: 'storage-unavailable' })
  expect(tasksProjectsCapabilities({ ...ready, taskPresent: false })['task.delegation-available']).toEqual({ state: 'unavailable', reason: 'missing-entity' })
})
