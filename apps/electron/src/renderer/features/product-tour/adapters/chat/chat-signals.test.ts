import { describe, expect, test } from 'bun:test'
import type { Message, Session, SessionEvent } from '../../../../../shared/types'
import type { TourObservation } from '../../runtime/hooks'
import { bindChatOptimisticMessage, beginChatUserTurn, clearChatObservations, correlateUserTurn, deriveChatSignals, observeChatSessionEvent, beginChatPermissionResponse, observeChatPermissionResponse, beginChatCommit, beginChatSessionCreation, observeChatSessionCreated, beginChatSessionReopen, observeChatSessionReopened } from './index'

const observation: TourObservation = { binding: { workspaceId: 'w', panelId: 'p', sessionId: 's', clientProfileId: 'profile', runToken: 'run-1' }, operationToken: 'op-1', at: 10 }
const message = (id: string, role: Message['role'], extra: Partial<Message> = {}): Message => ({ id, role, content: 'content', timestamp: 11, ...extra })
const session = (messages: Message[] = [], processing = false): Session => ({ id: 's', workspaceId: 'w', workspaceName: 'Workspace', messages, isProcessing: processing, lastMessageAt: 11, enabledSourceSlugs: ['docs'] })
function accepted() {
  const correlation = correlateUserTurn(observation, session([message('welcome', 'assistant')]))!
  correlation.optimisticMessageId = 'optimistic'
  const user = message('optimistic', 'user', { backendMessageId: 'native-user' })
  const next = session([message('welcome', 'assistant'), user], true)
  const signals = deriveChatSignals(correlation, { type: 'user_message', sessionId: 's', optimisticMessageId: 'optimistic', status: 'accepted', message: message('native-user', 'user') }, session(), next)
  return { correlation, next, signals }
}
function textComplete(extra: Partial<Message> = {}) {
  const state = accepted()
  const final = message('final', 'assistant', { turnId: 'turn-1', ...extra })
  const next = session([...state.next.messages, final], true)
  deriveChatSignals(state.correlation, { type: 'text_complete', sessionId: 's', messageId: 'final', turnId: 'turn-1', text: final.content, isIntermediate: final.isIntermediate, parentToolUseId: final.parentToolUseId }, state.next, next)
  return { ...state, next }
}

describe('native chat evidence', () => {
  test('acceptance requires a native acknowledgement and preserves capture time', () => {
    const { signals } = accepted()
    expect(signals.map(s => s.name)).toEqual(['user-turn.accepted'])
    expect(signals[0]?.operationStartedAt).toBe(10)
    expect(signals[0]?.binding.runToken).toBe('run-1')
  })
  test('welcome and a completion without new text never deliver a final', () => {
    const { correlation, next } = accepted()
    expect(deriveChatSignals(correlation, { type: 'complete', sessionId: 's', reason: 'complete', didReceiveNewFinalMessage: true }, next, { ...next, isProcessing: false })).toEqual([])
  })
  test.each(['interrupted', 'error', 'timeout'] as const)('%s complete is never a final delivery', reason => {
    const { correlation, next } = textComplete()
    expect(deriveChatSignals(correlation, { type: 'complete', sessionId: 's', reason, didReceiveNewFinalMessage: true }, next, { ...next, isProcessing: false })).toEqual([])
  })
  test.each([{ isIntermediate: true }, { isError: true }, { isStreaming: true }, { isPending: true }, { hidden: true }, { parentToolUseId: 'nested' }, { content: '' }])('excludes ineligible assistant text %j', extra => {
    const { correlation, next } = textComplete(extra)
    expect(deriveChatSignals(correlation, { type: 'complete', sessionId: 's', reason: 'complete', didReceiveNewFinalMessage: true }, next, { ...next, isProcessing: false })).toEqual([])
  })
  test('a committed new final produces verified delivery only at successful completion', () => {
    const { correlation, next } = textComplete()
    const signals = deriveChatSignals(correlation, { type: 'complete', sessionId: 's', reason: 'complete', didReceiveNewFinalMessage: true }, next, { ...next, isProcessing: false })
    expect(signals.map(s => s.name)).toEqual(['user-turn.final-delivered'])
    expect(signals[0]?.level).toBe('verified')
  })
  test('old runtime with missing success fields remains unverified', () => {
    const { correlation, next } = textComplete()
    expect(deriveChatSignals(correlation, { type: 'complete', sessionId: 's' }, next, { ...next, isProcessing: false })).toEqual([])
  })
  test('interruption followed by a late successful complete stays unverified', () => {
    const { correlation, next } = textComplete()
    deriveChatSignals(correlation, { type: 'interrupted', sessionId: 's' }, next, { ...next, isProcessing: false })
    expect(deriveChatSignals(correlation, { type: 'complete', sessionId: 's', reason: 'complete', didReceiveNewFinalMessage: true }, next, { ...next, isProcessing: false })).toEqual([])
  })
  test('other sessions and optimistic-only messages cannot acknowledge send', () => {
    const correlation = correlateUserTurn(observation, session())!
    correlation.optimisticMessageId = 'optimistic'
    const pending = session([message('optimistic', 'user', { isPending: true })], true)
    const event: SessionEvent = { type: 'user_message', sessionId: 's', status: 'accepted', optimisticMessageId: 'optimistic', message: message('native-user', 'user') }
    expect(deriveChatSignals(correlation, event, session(), pending)).toEqual([])
    expect(deriveChatSignals(correlation, { ...event, sessionId: 'other' }, session(), session([message('optimistic', 'user')]))).toEqual([])
  })
  test('successful source tool requires matching start, source, and committed result', () => {
    const { correlation, next } = accepted()
    const tool = message('tool', 'tool', { toolUseId: 'tool-1', toolName: 'mcp__docs__search', toolStatus: 'executing' })
    const started = session([...next.messages, tool], true)
    deriveChatSignals(correlation, { type: 'tool_start', sessionId: 's', toolUseId: 'tool-1', toolName: 'mcp__docs__search', toolInput: {} }, next, started)
    const event: SessionEvent = { type: 'tool_result', sessionId: 's', toolUseId: 'tool-1', toolName: 'mcp__docs__search', result: 'result' }
    expect(deriveChatSignals(correlation, { ...event, isError: true }, started, session([...next.messages, { ...tool, toolStatus: 'error', isError: true }], true))).toEqual([])
    expect(deriveChatSignals(correlation, event, started, session([...next.messages, { ...tool, toolStatus: 'completed' }], true)).map(s => s.name)).toEqual(['source.tool-succeeded'])
  })
  test('retry text discard cannot deliver discarded response', () => {
    const { correlation, next } = textComplete()
    deriveChatSignals(correlation, { type: 'text_discard', sessionId: 's', turnId: 'turn-1' }, next, next)
    expect(deriveChatSignals(correlation, { type: 'complete', sessionId: 's', reason: 'complete', didReceiveNewFinalMessage: true }, next, { ...next, isProcessing: false })).toEqual([])
  })
  test('null captures are inert; late native events retain original run binding', () => {
    clearChatObservations()
    beginChatUserTurn(null, session())
    bindChatOptimisticMessage('s', 'optimistic')
    const event: SessionEvent = { type: 'user_message', sessionId: 's', status: 'accepted', optimisticMessageId: 'optimistic', message: message('native-user', 'user') }
    expect(observeChatSessionEvent(event, session(), session([message('optimistic', 'user')], true))).toEqual([])
    beginChatUserTurn(observation, session())
    bindChatOptimisticMessage('s', 'optimistic')
    expect(observeChatSessionEvent(event, session(), session([message('optimistic', 'user')], true))[0]?.binding.runToken).toBe('run-1')
    clearChatObservations()
  })
  test('user denial succeeds; expired/native timeout acknowledgement fails', () => {
    clearChatObservations()
    beginChatPermissionResponse(observation, 's', 'request')
    expect(observeChatPermissionResponse('s', 'request', true).map(s => s.name)).toEqual(['permission.resolved-by-user'])
    beginChatPermissionResponse(observation, 's', 'expired')
    expect(observeChatPermissionResponse('s', 'expired', false)).toEqual([])
    expect(observeChatPermissionResponse('s', 'expired', true)).toEqual([])
  })
  test('status labels and project evidence require the exact native committed value', () => {
    clearChatObservations()
    beginChatCommit(observation, 'session.labels-committed', ['label'])
    const event: SessionEvent = { type: 'labels_changed', sessionId: 's', labels: ['label'] }
    expect(observeChatSessionEvent(event, session(), { ...session(), labels: ['optimistic'] })).toEqual([])
    expect(observeChatSessionEvent({ ...event, labels: ['other-operation'] }, session(), { ...session(), labels: ['other-operation'] })).toEqual([])
    expect(observeChatSessionEvent(event, session(), { ...session(), labels: ['label'] }).map(s => s.name)).toEqual(['session.labels-committed'])
    expect(observeChatSessionEvent(event, session(), { ...session(), labels: ['label'] })).toEqual([])
    beginChatCommit(observation, 'session.project-committed', null)
    expect(observeChatSessionEvent({ type: 'project_id_changed', sessionId: 's', projectId: null }, session(), session()).map(s => s.name)).toEqual(['session.project-committed'])
  })
  test('overlapping metadata operations remain ambiguous instead of verifying an old completion', () => {
    clearChatObservations()
    beginChatCommit(observation, 'session.status-committed', 'done')
    beginChatCommit({ ...observation, operationToken: 'next-op', binding: { ...observation.binding, runToken: 'next-run' } }, 'session.status-committed', 'done')
    expect(observeChatSessionEvent({ type: 'session_status_changed', sessionId: 's', sessionStatus: 'done' }, session(), { ...session(), sessionStatus: 'done' })).toEqual([])
  })
  test('native creation and rendered reopen preserve the original scope and consume once', () => {
    clearChatObservations()
    beginChatSessionCreation(observation)
    const created = { ...session(), id: 'created' }
    expect(observeChatSessionCreated(created)[0]?.binding.sessionId).toBe('s')
    expect(observeChatSessionCreated(created)).toEqual([])
    beginChatSessionReopen(observation, 'created')
    expect(observeChatSessionReopened({ ...created, workspaceId: 'other' })).toEqual([])
    expect(observeChatSessionReopened(created)[0]?.binding.panelId).toBe('p')
    expect(observeChatSessionReopened(created)).toEqual([])
  })
  test('midstream queued send can be accepted but cannot inherit the earlier final answer', () => {
    const correlation = correlateUserTurn(observation, session([], true))!
    correlation.optimisticMessageId = 'optimistic'
    const user = message('optimistic', 'user')
    const next = session([user], true)
    deriveChatSignals(correlation, { type: 'user_message', sessionId: 's', optimisticMessageId: 'optimistic', status: 'queued', message: user }, session(), next)
    const final = session([user, message('late', 'assistant', { turnId: 'old-turn' })], true)
    deriveChatSignals(correlation, { type: 'text_complete', sessionId: 's', messageId: 'late', turnId: 'old-turn', text: 'late' }, next, final)
    expect(deriveChatSignals(correlation, { type: 'complete', sessionId: 's', reason: 'complete', didReceiveNewFinalMessage: true }, final, { ...final, isProcessing: false })).toEqual([])
  })
})
