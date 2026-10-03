import type {
  AttemptStepEvidence, CompletionPolicy, EngineSnapshot, EvidenceLevel, ProgressMutation,
  RuntimeState, SafeReason, StepId, StepProgress, TourBinding, TourDefinition, TourEffect,
  TourInput, TourProgress, TourSignal, TourStep, Transition, TransitionFunction,
} from '../contracts'

/** No clock, DOM, persistence or domain-operation dependencies live in this module. */
export const initialRuntimeState: RuntimeState = Object.freeze({
  definition: null, phase: 'idle', attempt: null, progress: null,
  attemptEvidence: Object.freeze({}), seenEventTokens: Object.freeze([]),
})

export type Eligibility =
  | { readonly status: 'ready' }
  | { readonly status: 'blocked' | 'not-applicable'; readonly reason: SafeReason }

export function evaluateEligibility(tour: TourDefinition, snapshot: EngineSnapshot, step?: TourStep): Eligibility {
  if (!snapshot.enabled || !snapshot.shellReady) return { status: 'blocked', reason: 'api-unavailable' }
  if (!snapshot.foreground) return { status: 'blocked', reason: 'focus-lost' }
  if (snapshot.blockers.length) return { status: 'blocked', reason: snapshot.blockers[0]! }
  for (const id of tour.requires) {
    const capability = snapshot.capabilities[id]
    if (capability?.state !== 'ready') return { status: 'blocked', reason: capability?.reason ?? 'api-unavailable' }
  }
  for (const id of step?.requires ?? []) {
    const capability = snapshot.capabilities[id]
    if (capability?.state === 'ready') continue
    return {
      status: step?.optional && step.onUnavailable === 'not-applicable' && capability?.state !== 'pending'
        ? 'not-applicable' : 'blocked',
      reason: capability?.reason ?? 'api-unavailable',
    }
  }
  return { status: 'ready' }
}

const levels: Record<EvidenceLevel, number> = { acknowledged: 0, observed: 1, verified: 2 }
function hasEvidence(policy: CompletionPolicy, evidence: AttemptStepEvidence | undefined): boolean {
  return policy.kind === 'ack'
    ? evidence?.acknowledgedAt !== undefined
    : evidence?.at !== undefined && evidence.level !== undefined && levels[evidence.level] >= levels[policy.evidence]
}

export function satisfiesCompletionPolicy(policy: CompletionPolicy, evidence: AttemptStepEvidence | undefined): boolean {
  if (!hasEvidence(policy, evidence)) return false
  if (policy.kind === 'ack' || !policy.requireAcknowledgementAfterEvidence) return true
  return evidence?.acknowledgedAt !== undefined && evidence.at !== undefined && evidence.acknowledgedAt >= evidence.at
}

function durableEvidence(progress: StepProgress | undefined): AttemptStepEvidence | undefined {
  if (!progress) return undefined
  const level = progress.verifiedAt !== undefined ? 'verified'
    : progress.observedAt !== undefined ? 'observed' : undefined
  return { acknowledgedAt: progress.acknowledgedAt, level, at: progress.verifiedAt ?? progress.observedAt }
}

function newProgress(tour: TourDefinition, scopeKey: string): TourProgress {
  return { schemaVersion: 1, scopeKey, tourId: tour.id, tourVersion: tour.version, revision: 0, status: 'not-started', steps: {} }
}

/** A future schema or semantic version is left intact for the host to report unavailable. */
export function reconcileProgressVersion(progress: TourProgress | null, tour: TourDefinition, scopeKey?: string): TourProgress {
  const destination = scopeKey ?? progress?.scopeKey ?? ''
  if (!progress || progress.tourId !== tour.id || progress.scopeKey !== destination) return newProgress(tour, destination)
  if (progress.schemaVersion !== 1 || progress.tourVersion > tour.version
    || tour.steps.some(step => (progress.steps[step.id]?.stepVersion ?? 0) > step.version)) return progress
  let changed = progress.tourVersion !== tour.version
  const steps = { ...progress.steps }
  for (const step of tour.steps) {
    const previous = steps[step.id]
    if (previous && previous.stepVersion !== step.version) {
      steps[step.id] = { stepId: step.id, stepVersion: step.version }
      changed = true
    }
  }
  if (!changed) return progress
  const satisfied = tour.steps.filter(step => !step.optional)
    .every(step => satisfiesCompletionPolicy(step.completion, durableEvidence(steps[step.id])))
  const dismissalCurrent = progress.dismissedUntilVersion !== undefined && progress.dismissedUntilVersion >= tour.version
  const status = progress.status === 'dismissed' && dismissalCurrent ? 'dismissed'
    : satisfied && progress.status === 'completed-learning' ? 'completed-learning'
      : progress.status === 'not-started' ? 'not-started' : progress.status === 'partial' ? 'partial' : 'in-progress'
  return { ...progress, steps, tourVersion: tour.version, revision: progress.revision + 1, status,
    dismissedUntilVersion: dismissalCurrent ? progress.dismissedUntilVersion : undefined }
}

function sameBinding(a: TourBinding, b: TourBinding): boolean {
  return a.clientProfileId === b.clientProfileId && a.workspaceId === b.workspaceId
    && a.panelId === b.panelId && a.runToken === b.runToken
    && a.sessionId === b.sessionId && a.entityId === b.entityId
}

function currentStep(state: RuntimeState): TourStep | undefined {
  return state.definition?.steps.find(step => step.id === state.attempt?.stepId)
}

function setPhase(state: RuntimeState, phase: RuntimeState['phase'], reason?: SafeReason): RuntimeState {
  return { ...state, phase, attempt: state.attempt ? { ...state.attempt, phase, reason } : null }
}

function inert(state: RuntimeState): Transition { return { state, effects: [] } }
const cleanup: readonly TourEffect[] = [{ type: 'HIDE' }, { type: 'CANCEL_TIMEOUT' }, { type: 'CLEANUP' }]

function stop(state: RuntimeState, phase: 'paused' | 'blocked', reason: SafeReason): Transition {
  return { state: setPhase(state, phase, reason), effects: cleanup }
}

/** The in-memory projection mirrors mutations; persistence remains the repository's responsibility. */
function store(state: RuntimeState, mutation: ProgressMutation, effects: TourEffect[]): RuntimeState {
  if (!state.definition || !state.progress) return state
  const progress = state.progress
  let next: TourProgress
  if (mutation.kind === 'finish') next = { ...progress, status: mutation.status, revision: progress.revision + 1 }
  else if (mutation.kind === 'dismiss') next = { ...progress, status: 'dismissed', dismissedUntilVersion: mutation.tourVersion, revision: progress.revision + 1 }
  else {
    const previous = progress.steps[mutation.stepId]
    const item: StepProgress = previous?.stepVersion === mutation.stepVersion ? previous
      : { stepId: mutation.stepId, stepVersion: mutation.stepVersion }
    const field = mutation.kind === 'skip' ? 'skippedAt'
      : mutation.kind === 'not-applicable' ? 'notApplicableReason' : `${mutation.level}At`
    const value = mutation.kind === 'not-applicable' ? mutation.reason : mutation.at
    // Historical milestones retain their first timestamp across replay.
    if (item[field as keyof StepProgress] !== undefined) return state
    const update = { [field]: value }
    next = { ...progress, status: 'in-progress', revision: progress.revision + 1,
      steps: { ...progress.steps, [mutation.stepId]: { ...item, ...update } } }
  }
  effects.push({ type: 'STORE', scopeKey: progress.scopeKey, tour: state.definition, mutation })
  return { ...state, progress: next }
}

function finish(state: RuntimeState, effects: TourEffect[]): Transition {
  const complete = state.definition!.steps.filter(step => !step.optional).every(step =>
    satisfiesCompletionPolicy(step.completion, state.attemptEvidence[step.id]))
  state = store(setPhase(state, 'finished'), { kind: 'finish', status: complete ? 'completed-learning' : 'partial' }, effects)
  effects.push(...cleanup)
  return { state, effects }
}

function prepare(state: RuntimeState, index: number, at: number, resetEvidence = false): Transition {
  const effects: TourEffect[] = [{ type: 'HIDE' }, { type: 'CANCEL_TIMEOUT' }]
  const definition = state.definition!
  while (index < definition.steps.length) {
    const step = definition.steps[index]!
    state = { ...setPhase(state, 'preparing'), stepActivatedAt: at,
      attempt: { ...state.attempt!, phase: 'preparing', stepId: step.id, reason: undefined,
        operationToken: step.completion.priorState === 'same-attempt'
          || (step.completion.priorState === 'allow-current-state' && definition.steps.slice(index + 1).some(candidate => candidate.completion.priorState === 'same-attempt'))
          ? state.attempt?.operationToken : undefined } }
    if (resetEvidence) state = { ...state, attemptEvidence: { ...state.attemptEvidence, [step.id]: undefined } }
    const eligibility = state.snapshot ? evaluateEligibility(definition, state.snapshot, step) : { status: 'ready' as const }
    if (eligibility.status === 'not-applicable') {
      state = store(state, { kind: 'not-applicable', stepId: step.id, stepVersion: step.version, reason: eligibility.reason }, effects)
      index++
      continue
    }
    if (eligibility.status === 'blocked') {
      const blocked = stop(state, 'blocked', eligibility.reason)
      return { state: blocked.state, effects: [...effects, { type: 'CLEANUP' }] }
    }
    effects.push({ type: 'RESOLVE_VIEW', routeKey: step.routeKey, binding: state.attempt!.binding },
      { type: 'ARM_TIMEOUT', runToken: state.attempt!.binding.runToken, stepId: step.id, milliseconds: 8_000 })
    return { state, effects }
  }
  return finish(state, effects)
}

function advance(state: RuntimeState, at: number): Transition {
  const index = state.definition!.steps.findIndex(step => step.id === state.attempt!.stepId)
  return prepare(state, index + 1, at)
}

function visiblePhase(step: TourStep, evidence: AttemptStepEvidence | undefined): RuntimeState['phase'] {
  return step.completion.kind === 'ack' || (hasEvidence(step.completion, evidence) && step.completion.requireAcknowledgementAfterEvidence)
    ? 'presenting' : 'waiting-action'
}

function acceptSignal(state: RuntimeState, signal: TourSignal): Transition {
  if (!state.attempt || !state.definition || ['idle', 'paused', 'blocked', 'finished'].includes(state.phase)) return inert(state)
  if (!sameBinding(state.attempt.binding, signal.binding) || !signal.eventToken || !Number.isFinite(signal.at)
    || signal.at < state.attempt.startedAt || (state.seenEventTokens ?? []).includes(signal.eventToken)) return inert(state)
  // Even an untyped caller must never promote UI observations to verified evidence.
  const suppliedOrigin: string = signal.origin
  if ((signal.level !== 'observed' && signal.level !== 'verified')
    || !['native-event', 'native-commit', 'ui-observation'].includes(suppliedOrigin)
    || (signal.level === 'verified' && suppliedOrigin === 'ui-observation')) return inert(state)
  const activeIndex = state.definition.steps.findIndex(step => step.id === state.attempt!.stepId)
  const candidates = state.definition.steps.filter((step, index) => index >= activeIndex
    && step.completion.kind === 'signal' && step.completion.signal === signal.name
    && levels[signal.level] >= levels[step.completion.evidence]
    && (index === activeIndex || step.completion.priorState === 'same-attempt'))
  const eligible = candidates.filter(step => {
    if (step.completion.priorState === 'after-activation') {
      const activation = state.stepActivatedAt ?? state.attempt!.startedAt
      if (signal.at < activation || (signal.operationStartedAt !== undefined && signal.operationStartedAt < activation)) return false
    }
    // Stronger evidence may upgrade a prior observation; repeated events do not move its clock.
    const previous = state.attemptEvidence[step.id]
    return previous?.level === undefined || levels[signal.level] > levels[previous.level]
  })
  if (!eligible.length) return inert(state)
  if (signal.operationStartedAt !== undefined && (!Number.isFinite(signal.operationStartedAt)
    || signal.operationStartedAt < state.attempt.startedAt || signal.operationStartedAt > signal.at)) return inert(state)
  if ((signal.level === 'verified' || eligible.some(step => step.completion.priorState === 'same-attempt')) && !signal.operationToken) {
    return stop(state, 'blocked', 'correlation-ambiguous')
  }
  const correlatedOperation = signal.level === 'verified' || eligible.some(step => step.completion.priorState === 'same-attempt')
  if (correlatedOperation && state.attempt.operationToken && signal.operationToken && state.attempt.operationToken !== signal.operationToken) return inert(state)
  const effects: TourEffect[] = []
  state = { ...state, seenEventTokens: [...(state.seenEventTokens ?? []), signal.eventToken],
    attempt: { ...state.attempt, operationToken: correlatedOperation ? state.attempt.operationToken ?? signal.operationToken : state.attempt.operationToken } }
  for (const step of eligible) {
    state = { ...state, attemptEvidence: { ...state.attemptEvidence,
      [step.id]: { ...state.attemptEvidence[step.id], level: signal.level, at: signal.at } } }
    state = store(state, { kind: 'evidence', stepId: step.id, stepVersion: step.version, level: signal.level, at: signal.at }, effects)
  }
  const step = currentStep(state)!
  if (state.phase === 'handed-off' || state.phase === 'preparing' || state.phase === 'locating') return { state, effects }
  const evidence = state.attemptEvidence[step.id]
  if (satisfiesCompletionPolicy(step.completion, evidence)) {
    const next = advance(state, signal.at)
    return { state: next.state, effects: [...effects, ...next.effects] }
  }
  return { state: setPhase(state, visiblePhase(step, evidence)), effects }
}

export const transition: TransitionFunction = (state, input) => {
  if (input.type === 'SNAPSHOT') {
    let next: RuntimeState = { ...state, snapshot: input.snapshot }
    if (!input.snapshot.enabled) {
      return { state: { ...next, phase: 'idle', attempt: null, attemptEvidence: {}, seenEventTokens: [] },
        effects: state.attempt ? cleanup : [] }
    }
    if (!state.attempt || ['idle', 'paused', 'blocked', 'finished'].includes(state.phase)) return { state: next, effects: [] }
    const expectedHandoff = state.phase === 'handed-off'
    const blockers = input.snapshot.blockers.filter(reason => !(expectedHandoff && reason === 'modal-open'))
    const reason = blockers[0] ?? (!input.snapshot.foreground && !expectedHandoff ? 'focus-lost' : undefined)
    if (reason) return stop(next, 'paused', reason)
    const eligibility = evaluateEligibility(state.definition!, { ...input.snapshot,
      foreground: expectedHandoff || input.snapshot.foreground, blockers }, currentStep(state))
    if (eligibility.status !== 'ready') return stop(next, 'blocked', eligibility.reason)
    return { state: next, effects: [] }
  }
  if (input.type === 'START') {
    if (!input.tour.steps.length || !input.binding.runToken || !Number.isFinite(input.at)) return inert(state)
    // A reused token cannot distinguish a callback from the previous incarnation.
    if (state.attempt?.binding.runToken === input.binding.runToken) return inert(state)
    const scopeKey = JSON.stringify([input.binding.clientProfileId, input.binding.workspaceId])
    const progress = reconcileProgressVersion(input.progress, input.tour, scopeKey)
    const from = input.fromStepId ? input.tour.steps.findIndex(step => step.id === input.fromStepId) : -1
    let index = from >= 0 ? from : 0
    const attemptEvidence: Partial<Record<StepId, AttemptStepEvidence>> = {}
    if (input.startMode === 'resume') {
      if (from < 0) index = input.tour.steps.findIndex(step => !step.optional && !satisfiesCompletionPolicy(step.completion, durableEvidence(progress.steps[step.id])))
      if (index < 0) index = 0 // A completed route can still be reviewed explicitly.
      for (const step of input.tour.steps.slice(0, index)) {
        const item = progress.steps[step.id]
        if (item?.stepVersion === step.version) attemptEvidence[step.id] = durableEvidence(item)
      }
    }
    const next: RuntimeState = { ...state, definition: input.tour, progress, attemptEvidence,
      seenEventTokens: [], phase: 'preparing', stepActivatedAt: input.at,
      attempt: { id: input.binding.runToken, tourId: input.tour.id, binding: input.binding, phase: 'preparing',
        stepId: input.tour.steps[index]!.id, startedAt: input.at } }
    if (progress.schemaVersion !== 1 || progress.tourVersion > input.tour.version
      || input.tour.steps.some(step => (progress.steps[step.id]?.stepVersion ?? 0) > step.version)) {
      return stop(next, 'blocked', 'storage-unavailable')
    }
    return prepare(next, index, input.at)
  }
  if (input.type === 'SIGNAL') return acceptSignal(state, input.signal)
  if (!state.attempt || !state.definition || input.runToken !== state.attempt.binding.runToken) return inert(state)
  if ('stepId' in input && input.stepId !== state.attempt.stepId) return inert(state)
  const step = currentStep(state)!
  switch (input.type) {
    case 'PAUSE':
      return ['idle', 'finished', 'paused'].includes(state.phase) ? inert(state) : stop(state, 'paused', input.reason)
    case 'DISMISS': {
      if (state.phase === 'finished') return inert(state)
      const effects: TourEffect[] = []
      const next = store(setPhase(state, 'finished', 'user-dismissed'), { kind: 'dismiss', tourVersion: state.definition.version }, effects)
      return { state: next, effects: [...effects, ...cleanup] }
    }
    case 'VIEW_READY':
      if (state.phase !== 'preparing' || state.snapshot?.navigationReady === false
        || (state.snapshot && input.navigationRevision !== state.snapshot.navigationRevision)) return inert(state)
      return { state: setPhase(state, 'locating'), effects: [{ type: 'LOCATE', targetId: step.target, binding: state.attempt.binding }] }
    case 'TARGET_READY': {
      if (state.phase !== 'locating' || state.snapshot?.navigationReady === false) return inert(state)
      const at = state.stepActivatedAt ?? state.attempt.startedAt
      let next: RuntimeState = { ...state, attemptEvidence: { ...state.attemptEvidence,
        [step.id]: { ...state.attemptEvidence[step.id], shownAt: at } } }
      const effects: TourEffect[] = [{ type: 'CANCEL_TIMEOUT' }]
      next = store(next, { kind: 'evidence', stepId: step.id, stepVersion: step.version, level: 'shown', at }, effects)
      next = setPhase(next, visiblePhase(step, next.attemptEvidence[step.id]))
      effects.push({ type: 'PRESENT', step, binding: state.attempt.binding }, { type: 'ANNOUNCE', copyKey: step.copyKey })
      if (step.completion.kind === 'signal' && satisfiesCompletionPolicy(step.completion, next.attemptEvidence[step.id])) {
        const result = advance(next, Math.max(at, next.attemptEvidence[step.id]?.at ?? at))
        return { state: result.state, effects: [...effects, ...result.effects] }
      }
      return { state: next, effects }
    }
    case 'ACK': {
      if (!['presenting', 'waiting-action'].includes(state.phase) || !Number.isFinite(input.at)
        || input.at < (state.stepActivatedAt ?? state.attempt.startedAt)) return inert(state)
      const evidence = state.attemptEvidence[step.id]
      if (step.completion.kind === 'signal' && (!step.completion.requireAcknowledgementAfterEvidence
        || !hasEvidence(step.completion, evidence) || input.at < evidence!.at!)) return inert(state)
      if (evidence?.shownAt === undefined || evidence.acknowledgedAt !== undefined) return inert(state)
      const effects: TourEffect[] = []
      let next: RuntimeState = { ...state, attemptEvidence: { ...state.attemptEvidence,
        [step.id]: { ...evidence, acknowledgedAt: input.at } } }
      next = store(next, { kind: 'evidence', stepId: step.id, stepVersion: step.version, level: 'acknowledged', at: input.at }, effects)
      const result = advance(next, input.at)
      return { state: result.state, effects: [...effects, ...result.effects] }
    }
    case 'SKIP': {
      if (!['presenting', 'waiting-action', 'blocked', 'paused'].includes(state.phase) || !Number.isFinite(input.at)
        || input.at < (state.stepActivatedAt ?? state.attempt.startedAt)) return inert(state)
      const effects: TourEffect[] = []
      const next = store(state, { kind: 'skip', stepId: step.id, stepVersion: step.version, at: input.at }, effects)
      const result = advance(next, input.at)
      return { state: result.state, effects: [...effects, ...result.effects] }
    }
    case 'BACK': {
      if (!['presenting', 'waiting-action', 'blocked', 'paused'].includes(state.phase) || !Number.isFinite(input.at)
        || input.at < (state.stepActivatedAt ?? state.attempt.startedAt)) return inert(state)
      const index = state.definition.steps.findIndex(item => item.id === step.id)
      return index > 0 ? prepare(state, index - 1, input.at, true) : inert(state)
    }
    case 'RETRY': {
      if (!['blocked', 'paused'].includes(state.phase) || !Number.isFinite(input.at)
        || input.at < (state.stepActivatedAt ?? state.attempt.startedAt)) return inert(state)
      return prepare(state, state.definition.steps.findIndex(item => item.id === step.id), input.at,
        step.completion.priorState === 'after-activation')
    }
    case 'HANDOFF_OPEN':
      return step.handoff && ['presenting', 'waiting-action'].includes(state.phase)
        ? { state: setPhase(state, 'handed-off'), effects: [{ type: 'HIDE' }, { type: 'CANCEL_TIMEOUT' }] } : inert(state)
    case 'HANDOFF_CLOSED': {
      if (state.phase !== 'handed-off') return inert(state)
      const evidence = state.attemptEvidence[step.id]
      if (satisfiesCompletionPolicy(step.completion, evidence)) return advance(state, evidence?.at ?? state.stepActivatedAt ?? state.attempt.startedAt)
      return { state: setPhase(state, 'locating'), effects: [{ type: 'LOCATE', targetId: step.target, binding: state.attempt.binding },
        { type: 'ARM_TIMEOUT', runToken: state.attempt.binding.runToken, stepId: step.id, milliseconds: 8_000 }] }
    }
    case 'TIMEOUT':
      return state.phase === 'preparing' ? stop(state, 'blocked', 'route-timeout')
        : state.phase === 'locating' ? stop(state, 'blocked', 'target-missing') : inert(state)
  }
}
