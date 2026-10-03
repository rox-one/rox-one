import { describe, expect, test } from 'bun:test'
import type { AttemptStepEvidence, CompletionPolicy, EngineSnapshot, RuntimeState, StepId, TourBinding, TourDefinition, TourInput, TourProgress, TourSignal, TourStep } from '../contracts'
import { evaluateEligibility, initialRuntimeState, reconcileProgressVersion, satisfiesCompletionPolicy, transition } from './index'

const binding: TourBinding = { clientProfileId: 'profile', workspaceId: 'workspace', panelId: 'panel', sessionId: 'session', runToken: 'run-1' }
const ready: EngineSnapshot = { enabled: true, shellReady: true, navigationReady: true, navigationRevision: 4, foreground: true, blockers: [], capabilities: { 'sessions.available': { state: 'ready' } } }
const ack: CompletionPolicy = { kind: 'ack', signal: null, evidence: 'acknowledged', priorState: 'after-activation', requireAcknowledgementAfterEvidence: false }
function step(id: StepId, overrides: Partial<TourStep> = {}): TourStep {
  return { id, version: 1, target: 'composer.input', routeKey: 'current-session', scope: 'bound-panel', copyKey: `tour.${id}`, copy: { ru: { title: 'Тест', body: 'Тест' }, en: { title: 'Test', body: 'Test' } }, completion: ack, handoff: false, optional: false, requires: [], onUnavailable: 'block', missingTarget: 'block-and-offer-retry-or-pause', notes: '', testId: `T-${id}`, ...overrides }
}
function signalPolicy(signal: TourSignal['name'], overrides: Partial<Extract<CompletionPolicy, { kind: 'signal' }>> = {}): CompletionPolicy {
  return { kind: 'signal', signal, evidence: 'verified', priorState: 'after-activation', requireAcknowledgementAfterEvidence: false, ...overrides }
}
function tour(steps: readonly TourStep[]): TourDefinition {
  return { id: 'OBT-01', slug: 'test', version: 1, title: '', goal: '', why: '', trigger: '', entryTriggers: ['learning-manual-start'], titleKey: 'title', goalKey: 'goal', whyKey: 'why', requires: ['sessions.available'], owner: 'A1', evidence: [], priority: 'P0', steps }
}
function start(definition: TourDefinition, options: Partial<Extract<TourInput, { type: 'START' }>> = {}): RuntimeState {
  const state = transition(initialRuntimeState, { type: 'SNAPSHOT', snapshot: ready }).state
  return transition(state, { type: 'START', tour: definition, binding, progress: null, startMode: 'new', at: 100, ...options }).state
}
function show(state: RuntimeState): RuntimeState {
  const attempt = state.attempt!
  state = transition(state, { type: 'VIEW_READY', runToken: attempt.binding.runToken, stepId: attempt.stepId, navigationRevision: 4 }).state
  return transition(state, { type: 'TARGET_READY', runToken: attempt.binding.runToken, stepId: attempt.stepId }).state
}
function click(state: RuntimeState, type: 'ACK' | 'SKIP' | 'BACK' | 'RETRY', at = 120): ReturnType<typeof transition> {
  return transition(state, { type, runToken: state.attempt!.binding.runToken, stepId: state.attempt!.stepId, at })
}
function signal(name: TourSignal['name'], overrides: Partial<TourSignal> = {}): TourSignal {
  return { name, binding, operationToken: 'operation-1', eventToken: `event-${name}`, at: 110, level: 'verified', origin: 'native-commit', ...overrides } as TourSignal
}
function emit(state: RuntimeState, value: TourSignal) { return transition(state, { type: 'SIGNAL', signal: value }) }
function durable(definition: TourDefinition): TourProgress {
  return { schemaVersion: 1, scopeKey: JSON.stringify(['profile', 'workspace']), tourId: definition.id, tourVersion: definition.version, revision: 7, status: 'completed-learning', steps: Object.fromEntries(definition.steps.map(s => [s.id, { stepId: s.id, stepVersion: s.version, acknowledgedAt: 20, observedAt: 20, verifiedAt: 20 }])) }
}

describe('completion policies', () => {
  test('CORE-01 acknowledgement never verifies a domain outcome', () => {
    const result = click(show(start(tour([step('first.permissions')]))), 'ACK')
    expect(result.state.phase).toBe('finished')
    expect(result.state.progress?.steps['first.permissions']?.acknowledgedAt).toBe(120)
    expect(result.state.progress?.steps['first.permissions']?.verifiedAt).toBeUndefined()
    expect(satisfiesCompletionPolicy(signalPolicy('note.persisted'), { level: 'acknowledged', at: 120 })).toBe(false)
  })
  test('CORE-02 UI observations cannot verify commits', () => {
    const state = show(start(tour([step('notes.save', { completion: signalPolicy('note.persisted') })])))
    const value = signal('note.persisted', { level: 'observed', origin: 'ui-observation' })
    expect(emit(state, value).state.attemptEvidence['notes.save']).toEqual(state.attemptEvidence['notes.save'])
    expect(emit(state, value).state.progress?.steps['notes.save']?.verifiedAt).toBeUndefined()
    expect(emit(state, { ...value, level: 'verified' } as unknown as TourSignal).state).toBe(state)
  })
  test('malformed evidence origins or levels cannot verify a native outcome', () => {
    const state = show(start(tour([step('notes.save', { completion: signalPolicy('note.persisted') })])))
    for (const value of [
      { origin: 'unknown-origin' }, { origin: undefined }, { level: 'acknowledged' }, { level: undefined },
    ]) {
      const result = emit(state, { ...signal('note.persisted'), ...value } as unknown as TourSignal)
      expect(result.state).toBe(state)
      expect(result.effects).toEqual([])
      expect(result.state.progress?.steps['notes.save']?.verifiedAt).toBeUndefined()
    }
  })
  test('an observed native/UI signal can complete an observed policy', () => {
    const state = show(start(tour([step('first.compose', { completion: signalPolicy('draft.nonempty', { evidence: 'observed' }) })])))
    const result = emit(state, signal('draft.nonempty', { level: 'observed', origin: 'ui-observation', operationToken: undefined }))
    expect(result.state.phase).toBe('finished')
    expect(result.state.progress?.steps['first.compose']?.observedAt).toBe(110)
    expect(result.state.progress?.steps['first.compose']?.verifiedAt).toBeUndefined()
  })
  test('evidence then acknowledgement is required; an early ACK is ignored', () => {
    const definition = tour([step('first.result', { completion: signalPolicy('user-turn.final-delivered', { requireAcknowledgementAfterEvidence: true }) })])
    const state = show(start(definition))
    expect(click(state, 'ACK').state).toBe(state)
    const evidence = emit(state, signal('user-turn.final-delivered')).state
    expect(evidence.phase).toBe('presenting')
    expect(evidence.attemptEvidence['first.result']?.acknowledgedAt).toBeUndefined()
    expect(click(evidence, 'ACK', 109).state).toBe(evidence)
    expect(click(evidence, 'ACK', 120).state.phase).toBe('finished')
  })
  test('policy helper rejects stale acknowledgement clocks', () => {
    const policy = signalPolicy('note.persisted', { requireAcknowledgementAfterEvidence: true })
    expect(satisfiesCompletionPolicy(policy, { level: 'verified', at: 10, acknowledgedAt: 9 })).toBe(false)
    expect(satisfiesCompletionPolicy(policy, { level: 'verified', at: 10, acknowledgedAt: 10 })).toBe(true)
    expect(satisfiesCompletionPolicy(ack, { level: 'verified', at: 10 })).toBe(false)
  })
})

describe('binding and operation correlation', () => {
  const definition = tour([step('notes.save', { completion: signalPolicy('note.persisted') })])
  test.each(['workspaceId', 'panelId', 'sessionId', 'clientProfileId', 'runToken'] as const)('CORE-03 ignores wrong %s', field => {
    const state = show(start(definition))
    expect(emit(state, signal('note.persisted', { binding: { ...binding, [field]: 'other' } })).state).toBe(state)
  })
  test('CORE-04 late run callbacks and previous popup ACK cannot advance another step', () => {
    const state = show(start(tour([step('first.permissions'), step('first.compose')])))
    const next = click(state, 'ACK').state
    expect(transition(next, { type: 'ACK', runToken: binding.runToken, stepId: 'first.permissions', at: 130 }).state).toBe(next)
    expect(transition(next, { type: 'TARGET_READY', runToken: 'run-old', stepId: 'first.compose' }).state).toBe(next)
    expect(emit(next, signal('draft.nonempty', { binding: { ...binding, runToken: 'run-old' } })).state).toBe(next)
  })
  test('ambiguous missing operation token blocks without verification', () => {
    const state = show(start(definition))
    const result = emit(state, signal('note.persisted', { operationToken: undefined }))
    expect(result.state.phase).toBe('blocked')
    expect(result.state.attempt?.reason).toBe('correlation-ambiguous')
    expect(result.state.progress?.steps['notes.save']?.verifiedAt).toBeUndefined()
  })
  test('same-attempt operation mismatch is ignored', () => {
    const steps = [step('first.send', { completion: signalPolicy('user-turn.accepted') }), step('first.result', { completion: signalPolicy('user-turn.final-delivered', { priorState: 'same-attempt', requireAcknowledgementAfterEvidence: true }) })]
    let state = show(start(tour(steps)))
    state = emit(state, signal('user-turn.accepted')).state
    expect(state.attempt?.operationToken).toBe('operation-1')
    expect(emit(state, signal('user-turn.final-delivered', { operationToken: 'unrelated', at: 130 })).state).toBe(state)
  })
  test('duplicate event cannot be consumed by another policy', () => {
    const definition = tour([step('notes.create', { completion: signalPolicy('note.created') }), step('notes.save', { completion: signalPolicy('note.created') })])
    let state = show(start(definition))
    const value = signal('note.created')
    state = show(emit(state, value).state)
    expect(emit(state, { ...value, at: 150 }).state).toBe(state)
  })
})

describe('prior evidence and replay', () => {
  test('CORE-05 preserves early final of the same operation, but waits for result presentation and ACK', () => {
    const definition = tour([
      step('first.send', { completion: signalPolicy('user-turn.accepted') }),
      step('first.execution', { completion: signalPolicy('execution.state-visible', { evidence: 'observed', priorState: 'same-attempt', requireAcknowledgementAfterEvidence: true }) }),
      step('first.result', { completion: signalPolicy('user-turn.final-delivered', { priorState: 'same-attempt', requireAcknowledgementAfterEvidence: true }) }),
    ])
    let state = show(start(definition))
    state = emit(state, signal('user-turn.accepted')).state
    const final = emit(state, signal('user-turn.final-delivered', { at: 115 })).state
    expect(final.attempt?.stepId).toBe('first.execution')
    expect(final.attemptEvidence['first.result']?.level).toBe('verified')
    state = show(final)
    state = emit(state, signal('execution.state-visible', { level: 'observed', at: 116 })).state
    state = click(state, 'ACK', 120).state
    expect(state.attempt?.stepId).toBe('first.result')
    expect(state.phase).toBe('preparing')
    state = show(state)
    expect(state.phase).toBe('presenting')
    expect(click(state, 'ACK', 121).state.phase).toBe('finished')
  })
  test('CORE-06 after-activation ignores earlier events and future-step evidence', () => {
    const definition = tour([step('first.permissions'), step('notes.save', { completion: signalPolicy('note.persisted') })])
    let state = show(start(definition))
    expect(emit(state, signal('note.persisted')).state).toBe(state)
    state = show(click(state, 'ACK', 120).state)
    expect(emit(state, signal('note.persisted', { at: 119 })).state).toBe(state)
    expect(emit(state, signal('note.persisted', { at: 121 })).state.phase).toBe('finished')
  })
  test('CORE-06 completion emission cannot restamp an operation captured before activation', () => {
    const definition = tour([step('first.permissions'), step('notes.save', { completion: signalPolicy('note.persisted') })])
    const state = show(click(show(start(definition)), 'ACK', 120).state)
    expect(emit(state, signal('note.persisted', { at: 130, operationStartedAt: 110 })).state).toBe(state)
    expect(emit(state, signal('note.persisted', { at: 130, operationStartedAt: 121 })).state.phase).toBe('finished')
  })
  test('same-attempt operation capture survives a neighboring step activation', () => {
    const definition = tour([step('first.send', { completion: signalPolicy('user-turn.accepted') }),
      step('first.result', { completion: signalPolicy('user-turn.final-delivered', { priorState: 'same-attempt', requireAcknowledgementAfterEvidence: true }) })])
    let state = show(start(definition))
    state = show(emit(state, signal('user-turn.accepted', { at: 120, operationStartedAt: 110 })).state)
    const result = emit(state, signal('user-turn.final-delivered', { at: 130, operationStartedAt: 110 }))
    expect(result.state.attemptEvidence['first.result']?.level).toBe('verified')
    expect(result.state.phase).toBe('presenting')
  })
  test('allow-current-state accepts current observations predating activation, never predating the run', () => {
    const definition = tour([step('first.permissions'), step('first.compose', { completion: signalPolicy('draft.nonempty', { evidence: 'observed', priorState: 'allow-current-state' }) })])
    let state = show(start(definition))
    state = show(click(state, 'ACK', 120).state)
    expect(emit(state, signal('draft.nonempty', { level: 'observed', at: 90 })).state).toBe(state)
    expect(emit(state, signal('draft.nonempty', { level: 'observed', at: 110 })).state.phase).toBe('finished')
  })
  test('a current UI observation can reach a future explanation without acknowledging it or replacing the native operation', () => {
    const definition = tour([
      step('first.send', { completion: signalPolicy('user-turn.accepted') }),
      step('first.execution', { completion: signalPolicy('execution.state-visible', { evidence: 'observed', priorState: 'allow-current-state', requireAcknowledgementAfterEvidence: true }) }),
      step('first.result', { completion: signalPolicy('user-turn.final-delivered', { priorState: 'same-attempt', requireAcknowledgementAfterEvidence: true }) }),
    ])
    let state = show(start(definition))
    const observation = signal('execution.state-visible', { level: 'observed', origin: 'ui-observation', operationToken: 'visible-view', operationStartedAt: 105 })
    for (const rejected of [
      { ...observation, at: 99 },
      { ...observation, operationStartedAt: 99 },
      { ...observation, binding: { ...binding, panelId: 'other' } },
      { ...observation, binding: { ...binding, runToken: 'old' } },
      { ...observation, level: 'verified', origin: 'native-commit' },
    ] as TourSignal[]) expect(emit(state, rejected).state).toBe(state)
    state = emit(state, observation).state
    expect(state.attempt?.stepId).toBe('first.send')
    expect(state.attemptEvidence['first.execution']?.level).toBe('observed')
    expect(state.attemptEvidence['first.execution']?.acknowledgedAt).toBeUndefined()
    expect(state.attempt?.operationToken).toBeUndefined()
    state = emit(state, signal('user-turn.accepted', { at: 115 })).state
    expect(state.attempt?.operationToken).toBe('operation-1')
    expect(click(state, 'ACK', 120).state).toBe(state) // The explanation must be shown first.
    state = show(state)
    expect(state.phase).toBe('presenting')
    expect(emit(state, { ...observation, at: 118 }).state).toBe(state)
    state = show(click(state, 'ACK', 120).state)
    expect(state.attempt?.operationToken).toBe('operation-1')
    expect(emit(state, signal('user-turn.final-delivered', { at: 125, operationToken: 'other-operation' })).state).toBe(state)
    expect(emit(state, signal('user-turn.final-delivered', { at: 125 })).state.phase).toBe('presenting')
  })
  test('CORE-09 replay preserves milestones but needs fresh acknowledgement', () => {
    const definition = tour([step('first.permissions')])
    const progress = durable(definition)
    const state = show(start(definition, { progress, startMode: 'replay', binding: { ...binding, runToken: 'run-replay' } }))
    expect(state.phase).toBe('presenting')
    expect(state.progress?.steps['first.permissions']?.verifiedAt).toBe(20)
    expect(state.attemptEvidence['first.permissions']?.acknowledgedAt).toBeUndefined()
    expect(transition(state, { type: 'ACK', runToken: binding.runToken, stepId: 'first.permissions', at: 120 }).state).toBe(state)
    expect(click(state, 'ACK').state.phase).toBe('finished')
  })
  test('resume chooses first unsatisfied required step while preserving past progress', () => {
    const definition = tour([step('first.permissions'), step('first.compose')])
    const progress: TourProgress = { ...durable(definition), status: 'partial', steps: { 'first.permissions': { stepId: 'first.permissions', stepVersion: 1, acknowledgedAt: 20 }, 'first.compose': { stepId: 'first.compose', stepVersion: 1, skippedAt: 30 } } }
    const state = start(definition, { progress, startMode: 'resume' })
    expect(state.attempt?.stepId).toBe('first.compose')
    expect(state.progress?.steps['first.permissions']?.acknowledgedAt).toBe(20)
  })
})

describe('routes, controls and handoff', () => {
  test('START/view/target phases and effects are bounded and have no domain mutation port', () => {
    const definition = tour([step('first.permissions')])
    const result = transition({ ...initialRuntimeState, snapshot: ready }, { type: 'START', tour: definition, binding, progress: null, startMode: 'new', at: 100 })
    expect(result.state.phase).toBe('preparing')
    expect(result.effects.map(e => e.type)).toEqual(['HIDE', 'CANCEL_TIMEOUT', 'RESOLVE_VIEW', 'ARM_TIMEOUT'])
    const locating = transition(result.state, { type: 'VIEW_READY', runToken: binding.runToken, stepId: 'first.permissions', navigationRevision: 4 })
    expect(locating.state.phase).toBe('locating')
    expect(locating.effects.some(e => e.type === 'LOCATE')).toBe(true)
    const presented = transition(locating.state, { type: 'TARGET_READY', runToken: binding.runToken, stepId: 'first.permissions' })
    expect(presented.state.phase).toBe('presenting')
    expect(presented.effects.filter(e => e.type === 'STORE').map(e => e.mutation)).toEqual([{ kind: 'evidence', stepId: 'first.permissions', stepVersion: 1, level: 'shown', at: 100 }])
    expect(presented.effects.find(e => e.type === 'STORE' && e.scopeKey === JSON.stringify(['profile', 'workspace']))).toBeDefined()
  })
  test('stale navigation revisions and out-of-order target callbacks are ignored', () => {
    const state = start(tour([step('first.permissions')]))
    expect(transition(state, { type: 'VIEW_READY', runToken: binding.runToken, stepId: 'first.permissions', navigationRevision: 3 }).state).toBe(state)
    expect(transition(state, { type: 'TARGET_READY', runToken: binding.runToken, stepId: 'first.permissions' }).state).toBe(state)
  })
  test('CORE-07 handoff stores evidence and waits until the native drawer closes', () => {
    const definition = tour([step('notes.create', { handoff: true, completion: signalPolicy('note.created') }), step('notes.save')])
    let state = show(start(definition))
    state = transition(state, { type: 'HANDOFF_OPEN', runToken: binding.runToken, stepId: 'notes.create' }).state
    expect(state.phase).toBe('handed-off')
    const result = emit(state, signal('note.created'))
    expect(result.state.phase).toBe('handed-off')
    expect(result.state.progress?.steps['notes.create']?.verifiedAt).toBe(110)
    expect(result.effects.some(e => e.type === 'RESOLVE_VIEW')).toBe(false)
    expect(click(result.state, 'ACK').state).toBe(result.state)
    state = transition(result.state, { type: 'HANDOFF_CLOSED', runToken: binding.runToken, stepId: 'notes.create' }).state
    expect(state.phase).toBe('preparing')
    expect(state.attempt?.stepId).toBe('notes.save')
  })
  test('acknowledged handoff still locates the original target after closing', () => {
    let state = show(start(tour([step('first.permissions', { handoff: true })])))
    state = transition(state, { type: 'HANDOFF_OPEN', runToken: binding.runToken, stepId: 'first.permissions' }).state
    const result = transition(state, { type: 'HANDOFF_CLOSED', runToken: binding.runToken, stepId: 'first.permissions' })
    expect(result.state.phase).toBe('locating')
    expect(result.effects.some(e => e.type === 'LOCATE')).toBe(true)
  })
  test('CORE-10 only route/target waits time out; genuine operation duration does not', () => {
    const state = start(tour([step('notes.save', { completion: signalPolicy('note.persisted') })]))
    const result = transition(state, { type: 'TIMEOUT', runToken: binding.runToken, stepId: 'notes.save' })
    expect(result.state.phase).toBe('blocked')
    expect(result.state.attempt?.reason).toBe('route-timeout')
    const action = show(state)
    expect(action.phase).toBe('waiting-action')
    expect(transition(action, { type: 'TIMEOUT', runToken: binding.runToken, stepId: 'notes.save' }).state).toBe(action)
  })
  test('retry is explicit and back changes route without undoing domain state', () => {
    let state = show(start(tour([step('first.permissions'), step('first.compose')])))
    state = show(click(state, 'ACK').state)
    const back = click(state, 'BACK', 130)
    expect(back.state.attempt?.stepId).toBe('first.permissions')
    expect(back.state.progress?.steps['first.permissions']?.acknowledgedAt).toBe(120)
    expect(back.effects.every(e => ['HIDE', 'CANCEL_TIMEOUT', 'RESOLVE_VIEW', 'ARM_TIMEOUT'].includes(e.type))).toBe(true)
    const blocked = transition(back.state, { type: 'TIMEOUT', runToken: binding.runToken, stepId: 'first.permissions' }).state
    expect(click(blocked, 'RETRY', 140).state.phase).toBe('preparing')
  })
  test('skip required step creates partial learning without forged verification', () => {
    const result = click(show(start(tour([step('notes.save', { completion: signalPolicy('note.persisted') })]))), 'SKIP')
    expect(result.state.phase).toBe('finished')
    expect(result.state.progress?.status).toBe('partial')
    expect(result.state.progress?.steps['notes.save']?.skippedAt).toBe(120)
    expect(result.state.progress?.steps['notes.save']?.verifiedAt).toBeUndefined()
  })
  test('pause dismiss and feature-off clean up and ignore old asynchronous callbacks', () => {
    const state = show(start(tour([step('notes.save', { completion: signalPolicy('note.persisted') })])))
    const paused = transition(state, { type: 'PAUSE', runToken: binding.runToken, reason: 'user-paused' })
    expect(paused.state.phase).toBe('paused')
    expect(paused.effects.some(e => e.type === 'CLEANUP')).toBe(true)
    expect(emit(paused.state, signal('note.persisted')).state).toBe(paused.state)
    const dismissed = transition(state, { type: 'DISMISS', runToken: binding.runToken })
    expect(dismissed.state.progress?.status).toBe('dismissed')
    expect(dismissed.state.attempt?.reason).toBe('user-dismissed')
    const disabled = transition(state, { type: 'SNAPSHOT', snapshot: { ...ready, enabled: false } })
    expect(disabled.state.phase).toBe('idle')
    expect(disabled.state.attempt).toBeNull()
    expect(disabled.effects.some(e => e.type === 'CLEANUP')).toBe(true)
  })
  test('foreground loss/unexpected modal pauses, while expected handoff keeps ownership', () => {
    const state = show(start(tour([step('first.permissions', { handoff: true })])))
    expect(transition(state, { type: 'SNAPSHOT', snapshot: { ...ready, foreground: false } }).state.attempt?.reason).toBe('focus-lost')
    expect(transition(state, { type: 'SNAPSHOT', snapshot: { ...ready, blockers: ['modal-open'] } }).state.attempt?.reason).toBe('modal-open')
    const handed = transition(state, { type: 'HANDOFF_OPEN', runToken: binding.runToken, stepId: 'first.permissions' }).state
    expect(transition(handed, { type: 'SNAPSHOT', snapshot: { ...ready, blockers: ['modal-open'] } }).state.phase).toBe('handed-off')
  })
})

describe('capability and version policies', () => {
  test('CORE-08 optional unavailable steps are not-applicable; required and pending steps block', () => {
    const optional = step('voice.start', { optional: true, requires: ['voice.available'], onUnavailable: 'not-applicable' })
    const definition = tour([optional, step('first.permissions')])
    expect(evaluateEligibility(definition, ready, optional)).toEqual({ status: 'not-applicable', reason: 'api-unavailable' })
    expect(evaluateEligibility(definition, ready, { ...optional, optional: false })).toEqual({ status: 'blocked', reason: 'api-unavailable' })
    expect(evaluateEligibility(definition, { ...ready, capabilities: { ...ready.capabilities, 'voice.available': { state: 'pending', reason: 'installing' } } }, optional)).toEqual({ status: 'blocked', reason: 'installing' })
    const state = start(definition)
    expect(state.attempt?.stepId).toBe('first.permissions')
    expect(state.progress?.steps['voice.start']?.notApplicableReason).toBe('api-unavailable')
    expect(state.progress?.steps['voice.start']?.verifiedAt).toBeUndefined()
  })
  test('missing tour capability cannot be bypassed by an optional step', () => {
    const definition = tour([step('voice.start', { optional: true, onUnavailable: 'not-applicable' })])
    expect(evaluateEligibility(definition, { ...ready, capabilities: {} }, definition.steps[0])).toEqual({ status: 'blocked', reason: 'api-unavailable' })
  })
  test('new capability does not automatically resume a blocked tour', () => {
    const definition = tour([step('voice.start', { requires: ['voice.available'] })])
    const state = start(definition)
    expect(state.phase).toBe('blocked')
    const updated = transition(state, { type: 'SNAPSHOT', snapshot: { ...ready, capabilities: { ...ready.capabilities, 'voice.available': { state: 'ready' } } } }).state
    expect(updated.phase).toBe('blocked')
    expect(click(updated, 'RETRY').state.phase).toBe('preparing')
  })
  test('DATA-06 copy-only tour changes preserve every milestone', () => {
    const definition = tour([step('first.permissions'), step('notes.save')])
    const progress = durable(definition)
    const changed = { ...definition, version: 2, steps: definition.steps.map(s => ({ ...s, copyKey: 'new.copy' })) }
    const result = reconcileProgressVersion(progress, changed)
    expect(result.steps).toEqual(progress.steps)
    expect(result.tourVersion).toBe(2)
    expect(result.status).toBe('completed-learning')
  })
  test('DATA-06 semantic revision invalidates only the changed step', () => {
    const definition = tour([step('first.permissions'), step('notes.save')])
    const progress = durable(definition)
    const changed = { ...definition, version: 2, steps: [definition.steps[0]!, { ...definition.steps[1]!, version: 2 }] }
    const result = reconcileProgressVersion(progress, changed)
    expect(result.steps['first.permissions']).toEqual(progress.steps['first.permissions'])
    expect(result.steps['notes.save']).toEqual({ stepId: 'notes.save', stepVersion: 2 })
    expect(result.status).toBe('in-progress')
  })
  test('scope changes cannot reuse another partition progress or store destination', () => {
    const definition = tour([step('first.permissions')])
    const result = reconcileProgressVersion(durable(definition), definition, 'new:workspace')
    expect(result.scopeKey).toBe('new:workspace')
    expect(result.steps).toEqual({})
    expect(result.status).toBe('not-started')
  })
  test('newer schema/version records are preserved fail-safe', () => {
    const definition = tour([step('first.permissions')])
    const progress = { ...durable(definition), schemaVersion: 2 } as unknown as TourProgress
    expect(reconcileProgressVersion(progress, definition)).toBe(progress)
    const newer = { ...durable(definition), tourVersion: 3, steps: { 'first.permissions': { stepId: 'first.permissions' as const, stepVersion: 3, verifiedAt: 20 } } }
    expect(reconcileProgressVersion(newer, definition)).toBe(newer)
    expect(start(definition, { progress }).phase).toBe('blocked')
  })
})

describe('native operation continuity through an execution explanation', () => {
  test('a UI observation cannot replace the accepted turn token before final delivery', () => {
    const definition = tour([
      step('first.send', { completion: signalPolicy('user-turn.accepted') }),
      step('first.execution', { completion: signalPolicy('execution.state-visible', { evidence: 'observed', priorState: 'allow-current-state', requireAcknowledgementAfterEvidence: true }) }),
      step('first.result', { completion: signalPolicy('user-turn.final-delivered', { priorState: 'same-attempt', requireAcknowledgementAfterEvidence: true }) }),
    ])
    let state = emit(show(start(definition)), signal('user-turn.accepted')).state
    state = show(state)
    state = emit(state, signal('execution.state-visible', { at: 120, level: 'observed', origin: 'ui-observation', operationToken: 'ui-snapshot' })).state
    expect(state.attempt?.operationToken).toBe('operation-1')
    state = click(state, 'ACK', 125).state
    state = show(state)
    state = emit(state, signal('user-turn.final-delivered', { at: 130, operationStartedAt: 105 })).state
    expect(state.attemptEvidence['first.result']?.level).toBe('verified')
    expect(state.phase).toBe('presenting')
    expect(click(state, 'ACK', 140).state.phase).toBe('finished')
  })
})
