import { expect, test } from 'bun:test'
import { productTourCatalogue } from '../catalogue'
import { deriveConnectionSignals } from '../adapters/connections'
import { initialRuntimeState, reconcileProgressVersion, transition } from './index'
import type { RuntimeState, TourBinding, TourDefinition, TourProgress, TourSignal } from '../contracts'
import type { LoadedSource } from '../../../../shared/types'

const binding: TourBinding = { clientProfileId: 'profile', workspaceId: 'workspace', panelId: 'panel', sessionId: 'session', runToken: 'current-run' }
const voice = productTourCatalogue.find(tour => tour.id === 'OBT-06')!
const sources = productTourCatalogue.find(tour => tour.id === 'OBT-07')!
function start(tour: TourDefinition, progress: TourProgress | null = null, runToken = binding.runToken) {
  let state = transition(initialRuntimeState, { type: 'SNAPSHOT', snapshot: { enabled: true, shellReady: true, navigationReady: true, navigationRevision: 1, foreground: true, blockers: [], capabilities: Object.fromEntries(tour.requires.map(id => [id, { state: 'ready' }])) } }).state
  return transition(state, { type: 'START', tour, binding: { ...binding, runToken }, progress, startMode: 'replay', at: 100 }).state
}
function show(state: RuntimeState) {
  const attempt = state.attempt!
  if (state.phase === 'preparing') state = transition(state, { type: 'VIEW_READY', runToken: attempt.binding.runToken, stepId: attempt.stepId, navigationRevision: 1 }).state
  return transition(state, { type: 'TARGET_READY', runToken: attempt.binding.runToken, stepId: attempt.stepId }).state
}
const ack = (state: RuntimeState, at = 120) => transition(state, { type: 'ACK', runToken: state.attempt!.binding.runToken, stepId: state.attempt!.stepId, at }).state
const insertion = { name: 'dictation.inserted', binding, eventToken: 'inserted-once', operationToken: 'native-dictation', operationStartedAt: 105, at: 110, level: 'observed', origin: 'native-event' } satisfies TourSignal

test('production voice policies retain one insertion during native handoff, then require start and visible review acknowledgements', () => {
  let state = show(start(voice))
  state = transition(state, { type: 'HANDOFF_OPEN', runToken: binding.runToken, stepId: 'voice.start' }).state
  const inserted = transition(state, { type: 'SIGNAL', signal: insertion })
  expect(inserted.state.phase).toBe('handed-off')
  expect(inserted.state.attemptEvidence['voice.review']?.level).toBe('observed')
  expect(inserted.effects.some(effect => effect.type === 'RESOLVE_VIEW')).toBe(false)
  expect(ack(inserted.state)).toBe(inserted.state)
  state = transition(inserted.state, { type: 'HANDOFF_CLOSED', runToken: binding.runToken, stepId: 'voice.start' }).state
  state = show(state)
  state = ack(state)
  expect(state.attempt?.stepId).toBe('voice.review')
  expect(ack(state, 125)).toBe(state)
  state = show(state)
  expect(state.phase).toBe('presenting')
  expect(state.attempt?.operationToken).toBe('native-dictation')
  expect(transition(state, { type: 'SIGNAL', signal: { ...insertion, eventToken: 'wrong-operation', operationToken: 'other', level: 'verified', at: 125 } }).state).toBe(state)
  expect(transition(state, { type: 'SIGNAL', signal: { ...insertion, at: 125 } }).state).toBe(state)
  expect(ack(state, 125).phase).toBe('finished')
  expect(ack(state, 125).progress?.steps['voice.review']?.verifiedAt).toBeUndefined()
})

test('production voice review rejects stale clocks, missing correlation, foreign scopes and historical replay evidence', () => {
  const state = show(start(voice))
  for (const field of ['clientProfileId', 'workspaceId', 'panelId', 'sessionId', 'entityId', 'runToken'] as const) {
    expect(transition(state, { type: 'SIGNAL', signal: { ...insertion, binding: { ...binding, [field]: 'foreign' } } }).state).toBe(state)
  }
  for (const signal of [{ ...insertion, at: 99 }, { ...insertion, operationStartedAt: 99 }, { ...insertion, operationStartedAt: 111 }]) expect(transition(state, { type: 'SIGNAL', signal }).state).toBe(state)
  const missing = transition(state, { type: 'SIGNAL', signal: { ...insertion, operationToken: undefined } })
  expect(missing.state.attempt?.reason).toBe('correlation-ambiguous')
  expect(missing.state.attemptEvidence['voice.review']).toBeUndefined()
  const completed = ack(show(ack(transition(state, { type: 'SIGNAL', signal: insertion }).state)), 125)
  const replay = show(start(voice, completed.progress, 'replay-run'))
  expect(replay.attemptEvidence['voice.review']).toBeUndefined()
  expect(transition(replay, { type: 'SIGNAL', signal: insertion }).state).toBe(replay)
})

test('native handoff close refuses background presentation and preserves authoritative focus return', () => {
  const visible = show(start(voice))
  const handedOff = transition(visible, { type: 'HANDOFF_OPEN', runToken: binding.runToken, stepId: 'voice.start' }).state
  const background = transition(handedOff, { type: 'SNAPSHOT', snapshot: { ...handedOff.snapshot!, foreground: false } }).state
  expect(background.phase).toBe('handed-off')
  const closed = transition(background, { type: 'HANDOFF_CLOSED', runToken: binding.runToken, stepId: 'voice.start' })
  expect(closed.state.phase).toBe('paused')
  expect(closed.state.attempt?.reason).toBe('focus-lost')
  expect(closed.effects.some(effect => effect.type === 'PRESENT' || effect.type === 'LOCATE')).toBe(false)
  expect(show(closed.state).phase).toBe('paused')
  expect(transition(closed.state, { type: 'SNAPSHOT', snapshot: handedOff.snapshot! }).state.phase).toBe('paused')
  expect(transition(background, { type: 'HANDOFF_CLOSED', runToken: 'old-run', stepId: 'voice.start' }).state).toBe(background)
  const focused = transition(background, { type: 'SNAPSHOT', snapshot: handedOff.snapshot! }).state
  expect(show(transition(focused, { type: 'HANDOFF_CLOSED', runToken: binding.runToken, stepId: 'voice.start' }).state).phase).toBe('presenting')
})

test('the voice permission-handoff amendment invalidates v1/v2 review evidence and retains the start acknowledgement', () => {
  expect(voice.version).toBe(3)
  expect(voice.steps.find(step => step.id === 'voice.review')?.handoff).toBe(true)
  for (const version of [1, 2]) {
    const historical: TourProgress = { schemaVersion: 1, scopeKey: JSON.stringify(['profile', 'workspace']), tourId: voice.id, tourVersion: version, revision: 1, status: 'completed-learning', steps: { 'voice.start': { stepId: 'voice.start', stepVersion: 1, acknowledgedAt: 20 }, 'voice.review': { stepId: 'voice.review', stepVersion: version, observedAt: 30 } } }
    const reconciled = reconcileProgressVersion(historical, voice)
    expect(reconciled.steps['voice.start']?.acknowledgedAt).toBe(20)
    expect(reconciled.steps['voice.review']).toEqual({ stepId: 'voice.review', stepVersion: 3 })
    expect(reconciled.status).not.toBe('completed-learning')
  }
})

test('the collection menu amendment invalidates old view evidence while retaining committed status and label milestones', () => {
  const workflow = productTourCatalogue.find(tour => tour.id === 'OBT-13')!
  expect(workflow.version).toBe(2)
  expect(workflow.steps.find(step => step.id === 'workflow.board')?.handoff).toBe(true)
  const historical: TourProgress = { schemaVersion: 1, scopeKey: JSON.stringify(['profile', 'workspace']), tourId: workflow.id, tourVersion: 1, revision: 1, status: 'completed-learning', steps: {
    'workflow.status': { stepId: 'workflow.status', stepVersion: 1, observedAt: 20 },
    'workflow.label': { stepId: 'workflow.label', stepVersion: 1, observedAt: 25 },
    'workflow.board': { stepId: 'workflow.board', stepVersion: 1, observedAt: 30, acknowledgedAt: 35 },
  } }
  const reconciled = reconcileProgressVersion(historical, workflow)
  expect(reconciled.steps['workflow.status']?.observedAt).toBe(20)
  expect(reconciled.steps['workflow.label']?.observedAt).toBe(25)
  expect(reconciled.steps['workflow.board']).toEqual({ stepId: 'workflow.board', stepVersion: 2 })
  expect(reconciled.status).not.toBe('completed-learning')
})

test('one native source details observation satisfies sequential production status/details policies without reopening or trusting old progress', () => {
  const source: LoadedSource = { workspaceId: binding.workspaceId, workspaceRootPath: '/fixture', folderPath: '/fixture/source', guide: null, config: { id: 'source', slug: 'source', name: 'Private fixture source', type: 'local', provider: 'local', enabled: true, local: { path: '/fixture/source' } } }
  let state = show(start(sources))
  const observation = { binding, operationToken: 'source-opened', at: 105 }
  expect(deriveConnectionSignals(observation, binding, { kind: 'source-details', source, loading: true })).toEqual([])
  expect(deriveConnectionSignals(observation, { ...binding, entityId: 'other-source' }, { kind: 'source-details', source, loading: false })).toEqual([])
  const [visible] = deriveConnectionSignals(observation, binding, { kind: 'source-details', source, loading: false })
  state = transition(state, { type: 'SIGNAL', signal: { ...visible!, at: 110 } }).state
  expect(state.attempt?.stepId).toBe('sources.details')
  expect(state.attemptEvidence['sources.status']?.level).toBe('observed')
  expect(state.attemptEvidence['sources.details']?.level).toBe('observed')
  expect(ack(state)).toBe(state)
  state = show(state)
  expect(state.phase).toBe('presenting')
  expect(transition(state, { type: 'SIGNAL', signal: { ...visible!, at: 115 } }).state).toBe(state)
  state = ack(state)
  expect(state.phase).toBe('finished')
  expect(JSON.stringify(state.attemptEvidence)).not.toContain('Private fixture source')
  expect(state.progress?.steps['sources.details']?.verifiedAt).toBeUndefined()
  const replay = show(start(sources, state.progress, 'replay-run'))
  expect(replay.attemptEvidence['sources.details']).toBeUndefined()
  expect(transition(replay, { type: 'SIGNAL', signal: { ...visible!, at: 130 } }).state).toBe(replay)
})
