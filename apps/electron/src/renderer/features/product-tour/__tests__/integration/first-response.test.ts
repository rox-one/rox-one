/** Production domain event processor → chat adapter → core. Synthetic model replies; not application/native evidence. */
import { expect, test } from 'bun:test'
import type { Message, Session, SessionEvent } from '../../../../../shared/types'
import type { RuntimeState, TourBinding, TourSignal, TourStep } from '../../contracts'
import { initialRuntimeState, transition } from '../../core'
import { productTourCatalogue as tours } from '../../catalogue'
import { correlateUserTurn, deriveChatSignals } from '../../adapters/chat'
import { processEvent } from '../../../../event-processor/processor'

const tour = tours.find(tour => tour.id === 'OBT-01')!
const binding: TourBinding = { workspaceId: 'workspace-a', panelId: 'panel-a', sessionId: 'session-a', clientProfileId: 'profile-a', runToken: 'run-a' }
const before: Session = { id: 'session-a', workspaceId: 'workspace-a', workspaceName: 'Test workspace', messages: [{ id: 'welcome', role: 'assistant', content: 'Existing welcome', timestamp: 1 }], isProcessing: false, lastMessageAt: 1 }
const capabilities = Object.fromEntries(tour.requires.concat(tour.steps.flatMap(step => step.requires)).map(id => [id, { state: 'ready' }]))

function show(state: RuntimeState) {
  const stepId = state.attempt!.stepId
  state = transition(state, { type: 'VIEW_READY', runToken: binding.runToken, stepId, navigationRevision: 1 }).state
  return transition(state, { type: 'TARGET_READY', runToken: binding.runToken, stepId }).state
}
function ack(state: RuntimeState, at: number) { return transition(state, { type: 'ACK', runToken: binding.runToken, stepId: state.attempt!.stepId, at }).state }
function ui(state: RuntimeState, step: TourStep, at: number) {
  if (step.completion.kind !== 'signal') throw new Error('expected UI signal policy')
  return transition(state, { type: 'SIGNAL', signal: { name: step.completion.signal, binding, eventToken: `ui-${step.id}`, at, level: 'observed', origin: 'ui-observation' } }).state
}
for (const fast of [false, true]) test(`${fast ? 'DOMAIN-04 fast' : 'DOMAIN-03 normal'}: accepted native operation survives the execution observation and verifies only a delivered final`, () => {
  const start = Date.now()
  let state = transition(initialRuntimeState, { type: 'SNAPSHOT', snapshot: { enabled: true, shellReady: true, navigationReady: true, navigationRevision: 1, foreground: true, blockers: [], capabilities } }).state
  state = transition(state, { type: 'START', tour, binding, progress: null, startMode: 'new', at: start - 10 }).state
  state = show(state)
  state = ui(state, tour.steps[0]!, start - 9); state = ack(state, start - 8)
  state = show(state); state = ack(state, start - 7)
  state = show(state); state = ui(state, tour.steps[2]!, start - 6)
  state = show(state)
  expect(state.attempt?.stepId).toBe('first.send')
  const correlation = correlateUserTurn({ binding, operationToken: 'native-user-operation', at: start - 5 }, before)!
  correlation.optimisticMessageId = 'optimistic-user'
  const user: Message = { id: 'optimistic-user', backendMessageId: 'native-user', role: 'user', content: 'Fixture user query', timestamp: start, isPending: false }
  let session: Session = { ...before, messages: [...before.messages, user], isProcessing: true }
  const accepted: SessionEvent = { type: 'user_message', sessionId: before.id, status: 'accepted', optimisticMessageId: user.id, message: { ...user, id: 'native-user' } }
  for (const signal of deriveChatSignals(correlation, accepted, before, session)) state = transition(state, { type: 'SIGNAL', signal }).state
  expect(state.progress?.steps['first.send']?.verifiedAt).toBeDefined()
  expect(state.progress?.steps['first.result']?.verifiedAt).toBeUndefined()

  const deliver = () => {
    const text: SessionEvent = { type: 'text_complete', sessionId: before.id, messageId: 'native-final', turnId: 'native-turn', text: 'Fixture external model response', timestamp: Date.now() }
    const processed = processEvent({ session, streaming: null }, text)
    const previous = session; session = processed.state.session
    deriveChatSignals(correlation, text, previous, session)
    const complete: SessionEvent = { type: 'complete', sessionId: before.id, reason: 'complete', didReceiveNewFinalMessage: true }
    const finished = processEvent({ session, streaming: processed.state.streaming }, complete)
    const signals = deriveChatSignals(correlation, complete, session, finished.state.session)
    expect(signals.map(signal => signal.name)).toEqual(['user-turn.final-delivered'])
    for (const signal of signals) state = transition(state, { type: 'SIGNAL', signal }).state
  }
  if (fast) deliver()
  state = show(state)
  expect(state.attempt?.stepId).toBe('first.execution')
  state = ui(state, tour.steps[4]!, Date.now())
  state = ack(state, Date.now())
  expect(state.attempt?.stepId).toBe('first.result')
  state = show(state)
  if (!fast) deliver()
  expect(state.progress?.steps['first.result']?.verifiedAt).toBeDefined()
  expect(state.phase).not.toBe('finished')
  state = ack(state, Date.now())
  expect(state.phase).toBe('finished')
})
