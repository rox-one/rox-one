/** Independent execution of all 56 production policies. Pure evidence, never domain/native success. */
import { describe, expect, test } from 'bun:test'
import { initialRuntimeState, transition } from '../../core'
import { productTourCatalogue as catalogue } from '../../catalogue'
import type { EngineSnapshot, RuntimeState, TourBinding, TourDefinition, TourInput, TourSignal, TourStep } from '../../contracts'
import matrix from '../../../../../../../../tests/e2e/product-tour/step-matrix.json'

const binding: TourBinding = { workspaceId: 'workspace-a', panelId: 'panel-a', sessionId: 'session-a', clientProfileId: 'profile-a', runToken: 'run-a' }

function activate(tour: TourDefinition, step: TourStep): RuntimeState {
  const definition = { ...tour, steps: [step] }
  const capabilities = Object.fromEntries([...tour.requires, ...step.requires].map(id => [id, { state: 'ready' }]))
  const snapshot: EngineSnapshot = { enabled: true, shellReady: true, foreground: true, navigationReady: true, navigationRevision: 9, blockers: [], capabilities }
  let state = transition(initialRuntimeState, { type: 'SNAPSHOT', snapshot }).state
  state = transition(state, { type: 'START', tour: definition, binding, progress: null, startMode: 'new', at: 100 }).state
  state = transition(state, { type: 'VIEW_READY', runToken: binding.runToken, stepId: step.id, navigationRevision: 9 }).state
  state = transition(state, { type: 'TARGET_READY', runToken: binding.runToken, stepId: step.id }).state
  expect(state.phase).toBe(step.completion.kind === 'signal' ? 'waiting-action' : 'presenting')
  return state
}
const dispatch = (state: RuntimeState, input: TourInput) => transition(state, input).state
const signal = (step: TourStep, overrides: Partial<TourSignal> = {}): TourSignal => ({
  name: step.completion.kind === 'signal' ? step.completion.signal : 'user-turn.accepted',
  binding, operationToken: 'operation-a', eventToken: 'event-a', at: 110,
  level: step.completion.evidence === 'verified' ? 'verified' : 'observed', origin: 'native-commit', ...overrides,
} as TourSignal)
const verified = (state: RuntimeState, step: TourStep) => state.progress?.steps[step.id]?.verifiedAt

test('the shipped catalogue has exactly the independently specified 25 tours / 56 policies', () => {
  expect(catalogue).toHaveLength(25)
  const actual = catalogue.flatMap(tour => tour.steps.map(step => ({ tourId: tour.id, id: step.id, testId: step.testId, target: step.target, completion: step.completion, handoff: step.handoff, optional: step.optional, onUnavailable: step.onUnavailable })))
  expect(actual).toHaveLength(56)
  // JSON widens literal IDs at compile time; runtime equality still checks every independent policy field.
  expect(actual).toEqual(matrix.steps as typeof actual)
  expect(new Set(actual.map(step => step.testId)).size).toBe(56)
})

for (const tour of catalogue) for (const step of tour.steps) describe(`${step.testId} ${step.id}`, () => {
  test('positive policy records only the declared evidence and requires a separate acknowledgement when specified', () => {
    let state = activate(tour, step)
    if (step.completion.kind === 'ack') {
      state = dispatch(state, { type: 'ACK', runToken: binding.runToken, stepId: step.id, at: 120 })
      expect(state.progress?.steps[step.id]?.acknowledgedAt).toBeDefined()
      expect(verified(state, step)).toBeUndefined()
    } else {
      state = dispatch(state, { type: 'SIGNAL', signal: signal(step) })
      if (step.completion.requireAcknowledgementAfterEvidence) {
        expect(state.phase).not.toBe('finished')
        state = dispatch(state, { type: 'ACK', runToken: binding.runToken, stepId: step.id, at: 120 })
      }
      const progress = state.progress?.steps[step.id]
      if (step.completion.evidence === 'verified') expect(progress?.verifiedAt).toBeDefined()
      else { expect(progress?.observedAt).toBeDefined(); expect(progress?.verifiedAt).toBeUndefined() }
    }
    expect(state.phase).toBe('finished')
  })
  test('foreign panel/workspace/attempt, stale popup ACK and premature Next cannot create outcome evidence', () => {
    const initial = activate(tour, step)
    for (const foreign of [{ ...binding, workspaceId: 'foreign' }, { ...binding, panelId: 'foreign' }, { ...binding, sessionId: 'foreign' }, { ...binding, entityId: 'foreign' }, { ...binding, clientProfileId: 'foreign' }, { ...binding, runToken: 'old-run' }]) {
      const next = dispatch(initial, { type: 'SIGNAL', signal: signal(step, { binding: foreign }) })
      expect(next.attemptEvidence).toEqual(initial.attemptEvidence)
      expect(next.phase).toBe(initial.phase)
    }
    const staleAck = dispatch(initial, { type: 'ACK', runToken: 'old-run', stepId: step.id, at: 120 })
    expect(staleAck.attemptEvidence).toEqual(initial.attemptEvidence)
    if (step.completion.kind === 'signal') {
      const premature = dispatch(initial, { type: 'ACK', runToken: binding.runToken, stepId: step.id, at: 120 })
      expect(premature.phase).not.toBe('finished')
      expect(verified(premature, step)).toBeUndefined()
      if (step.completion.evidence === 'verified') {
        const uiOnly = dispatch(initial, { type: 'SIGNAL', signal: signal(step, { level: 'observed', origin: 'ui-observation' }) })
        expect(verified(uiOnly, step)).toBeUndefined()
        expect(uiOnly.phase).not.toBe('finished')
        const missingOperation = dispatch(initial, { type: 'SIGNAL', signal: signal(step, { operationToken: undefined }) })
        expect(verified(missingOperation, step)).toBeUndefined()
      }
      if (step.completion.priorState === 'after-activation') {
        const oldEvent = dispatch(initial, { type: 'SIGNAL', signal: signal(step, { at: 50 }) })
        expect(oldEvent.attemptEvidence).toEqual(initial.attemptEvidence)
      }
    }
  })
  if (step.handoff && step.completion.kind === 'signal') test('a native handoff retains evidence without finishing until the layer closes', () => {
    let state = activate(tour, step)
    state = dispatch(state, { type: 'HANDOFF_OPEN', runToken: binding.runToken, stepId: step.id })
    state = dispatch(state, { type: 'SIGNAL', signal: signal(step) })
    expect(state.phase).toBe('handed-off')
    state = dispatch(state, { type: 'HANDOFF_CLOSED', runToken: binding.runToken, stepId: step.id })
    if (step.completion.requireAcknowledgementAfterEvidence) {
      expect(state.phase).toBe('locating')
      state = dispatch(state, { type: 'TARGET_READY', runToken: binding.runToken, stepId: step.id })
      state = dispatch(state, { type: 'ACK', runToken: binding.runToken, stepId: step.id, at: 120 })
    }
    expect(state.phase).toBe('finished')
  })
})
