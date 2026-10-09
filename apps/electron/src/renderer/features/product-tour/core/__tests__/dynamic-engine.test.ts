import { describe, expect, test } from 'bun:test'
import type { CompletionPolicy, EngineSnapshot, RuntimeState, TourBinding, TourId, TourSignal, TourStep } from '../../contracts'
import { initialRuntimeState, transition } from '../index'
import { devSpaceTour } from '../../catalogue/__tests__/fixtures/dynamic-tour'

const binding: TourBinding = { clientProfileId: 'profile', workspaceId: 'workspace', panelId: 'panel', sessionId: 'session', runToken: 'run-1' }
const snapshot: EngineSnapshot = { enabled: true, shellReady: true, navigationReady: true, navigationRevision: 1, foreground: true, blockers: [], capabilities: { 'devspace.available': { state: 'ready' } } }

function start(tour = devSpaceTour()): RuntimeState {
  const state = transition(initialRuntimeState, { type: 'SNAPSHOT', snapshot }).state
  return transition(state, { type: 'START', tour, binding, progress: null, startMode: 'new', at: 100 }).state
}

function show(state: RuntimeState): RuntimeState {
  const attempt = state.attempt!
  state = transition(state, { type: 'VIEW_READY', runToken: attempt.binding.runToken, stepId: attempt.stepId, navigationRevision: 1 }).state
  return transition(state, { type: 'TARGET_READY', runToken: attempt.binding.runToken, stepId: attempt.stepId }).state
}

describe('TOUR-DYN generated tours run on the existing engine (D9)', () => {
  test('TOUR-DYN-09 a generated definition reaches the presenter and acknowledges through the same transitions', () => {
    const state = show(start())
    expect(state.phase).toBe('presenting')
    const finished = transition(state, { type: 'ACK', runToken: binding.runToken, stepId: 'devspace.repo.overview', at: 120 }).state
    expect(finished.phase).toBe('finished')
    expect(finished.progress?.steps['devspace.repo.overview']?.acknowledgedAt).toBe(120)
    expect(finished.progress?.steps['devspace.repo.overview']?.verifiedAt).toBeUndefined()
  })

  test('TOUR-DYN-10 the core invariant holds for generated step ids: ui-observation cannot verify', () => {
    const verified: CompletionPolicy = { kind: 'signal', signal: 'user-turn.accepted', evidence: 'verified', priorState: 'after-activation', requireAcknowledgementAfterEvidence: false }
    const step: TourStep = { ...devSpaceTour().steps[0]!, id: 'devspace.chat.composer' as TourStep['id'], target: 'devspace.chat.composer', completion: verified, testId: 'T-DYN-VERIFIED' }
    const tour = devSpaceTour({ id: 'PB-ask-1' as TourId, slug: 'ask', steps: [step] })
    const state = show(start(tour))
    const signal = { name: 'user-turn.accepted', binding, operationToken: 'op', eventToken: 'event', at: 110, level: 'observed', origin: 'ui-observation' } as TourSignal
    const observed = transition(state, { type: 'SIGNAL', signal }).state
    expect(observed.attemptEvidence['devspace.chat.composer']).toEqual(state.attemptEvidence['devspace.chat.composer'])
    expect(observed.progress?.steps['devspace.chat.composer']?.verifiedAt).toBeUndefined()
    const forged = { ...signal, level: 'verified' } as unknown as TourSignal
    expect(transition(state, { type: 'SIGNAL', signal: forged }).state).toBe(state)
  })
})