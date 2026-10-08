import { expect, test } from 'bun:test'
import { beginCollectionViewChange, clearCollectionViewChanges, consumeCollectionViewChange, hasCollectionViewChange } from '../collection-view-observation'
import type { TourObservation } from '../hooks'
import type { TourScope } from '../../contracts'

const observation: TourObservation = { binding: { clientProfileId: 'profile-a', workspaceId: 'workspace-a', panelId: 'panel-a',
  sessionId: 'session-a', runToken: 'run-a' }, operationToken: 'original-operation', at: 10 }
const scope: TourScope = { workspaceId: 'workspace-a', panelId: 'panel-a' }

test('collection request survives source replacement but only the measured requested destination emits once', () => {
  const owner = {}
  beginCollectionViewChange(owner, observation, 'table', 'list', 10)
  expect(hasCollectionViewChange(owner, observation.binding, scope, 'table', 11)).toBeTrue()
  expect(consumeCollectionViewChange(owner, observation, scope, 'board', true, 11)).toBeNull()
  expect(consumeCollectionViewChange(owner, observation, scope, 'table', false, 11)).toBeNull()
  const destinationCapture = { ...observation, operationToken: 'new-dom-operation', at: 11 }
  expect(consumeCollectionViewChange(owner, destinationCapture, scope, 'table', true, 11)).toBe(observation)
  expect(consumeCollectionViewChange(owner, destinationCapture, scope, 'table', true, 12)).toBeNull()
  expect(hasCollectionViewChange(owner, observation.binding, scope, 'table', 100_000)).toBeTrue()
  beginCollectionViewChange(owner, destinationCapture, 'table', 'table', 100_001)
  expect(hasCollectionViewChange(owner, observation.binding, scope, 'table', 100_002)).toBeTrue()
  expect(consumeCollectionViewChange(owner, destinationCapture, scope, 'table', true, 100_002)).toBeNull()
  clearCollectionViewChanges(owner)
  expect(hasCollectionViewChange(owner, observation.binding, scope, 'table', 12)).toBeFalse()
})

test('foreign runtime, profile, workspace, panel, session, entity and replay cannot consume a captured request', () => {
  const owner = {}
  beginCollectionViewChange(owner, observation, 'board', 'list', 10)
  expect(consumeCollectionViewChange({}, observation, scope, 'board', true, 11)).toBeNull()
  for (const change of [{ clientProfileId: 'profile-b' }, { workspaceId: 'workspace-b' }, { panelId: 'panel-b' },
    { sessionId: 'session-b' }, { entityId: 'foreign-entity' }, { runToken: 'replay' }]) {
    expect(consumeCollectionViewChange(owner, { ...observation, binding: { ...observation.binding, ...change } }, scope, 'board', true, 11)).toBeNull()
  }
  for (const change of [{ workspaceId: 'workspace-b' }, { panelId: 'panel-b' }, { sessionId: 'session-b' }, { entityId: 'foreign-entity' }]) {
    expect(consumeCollectionViewChange(owner, observation, { ...scope, ...change }, 'board', true, 11)).toBeNull()
  }
  expect(consumeCollectionViewChange(owner, null, scope, 'board', true, 11)).toBeNull()
})

test('unmounted requests expire, replacement preserves the newest operation and selecting the current mode cancels intent', () => {
  const owner = {}
  beginCollectionViewChange(owner, observation, 'board', 'list', 10)
  expect(hasCollectionViewChange(owner, observation.binding, scope, 'board', 15_010)).toBeFalse()
  beginCollectionViewChange(owner, observation, 'board', 'list', 20_000)
  const latest = { ...observation, operationToken: 'latest-operation' }
  beginCollectionViewChange(owner, latest, 'heatmap', 'list', 20_001)
  expect(hasCollectionViewChange(owner, observation.binding, scope, 'board', 20_002)).toBeFalse()
  expect(consumeCollectionViewChange(owner, observation, scope, 'heatmap', true, 20_002)).toBe(latest)
  beginCollectionViewChange(owner, observation, 'list', 'list', 20_003)
  expect(hasCollectionViewChange(owner, observation.binding, scope, 'heatmap', 20_003)).toBeFalse()
})

test('request storage is bounded and clear retires mounted authorization across runtime teardown', () => {
  const owner = {}
  for (let index = 0; index < 33; index++) beginCollectionViewChange(owner,
    { ...observation, binding: { ...observation.binding, runToken: `run-${index}` } }, 'board', 'list', 10)
  expect(hasCollectionViewChange(owner, { ...observation.binding, runToken: 'run-0' }, scope, 'board', 11)).toBeFalse()
  expect(hasCollectionViewChange(owner, { ...observation.binding, runToken: 'run-32' }, scope, 'board', 11)).toBeTrue()
  clearCollectionViewChanges(owner)
  expect(hasCollectionViewChange(owner, { ...observation.binding, runToken: 'run-32' }, scope, 'board', 11)).toBeFalse()
})
