import type { Message } from '@rox/core'
import type { Session, SessionEvent } from '@rox/shared/protocol'
import type { CapabilitySnapshot, SignalName, TargetId, TourSignal } from '../../contracts'
import type { TourObservation } from '../../runtime/hooks'

/** Only IDs and evidence live here. Prompt, path, and tool content are never retained. */
export interface ChatTurnCorrelation {
  readonly observation: TourObservation
  readonly sessionId: string
  readonly workspaceId: string
  readonly baselineMessageIds: ReadonlySet<string>
  readonly enabledSourceSlugs: readonly string[]
  readonly beganWhileProcessing: boolean
  optimisticMessageId?: string
  userMessageId?: string
  accepted: boolean
  failed: boolean
  finalMessageId?: string
  finalTurnId?: string
  readonly sourceTools: Map<string, string | undefined>
}

export function correlateUserTurn(observation: TourObservation | null, before: Session): ChatTurnCorrelation | null {
  if (!observation || before.hidden || before.workspaceId !== observation.binding.workspaceId || before.id !== observation.binding.sessionId) return null
  return {
    observation, sessionId: before.id, workspaceId: before.workspaceId,
    baselineMessageIds: new Set(before.messages.flatMap(message => [message.id, ...(message.backendMessageId ? [message.backendMessageId] : [])])),
    enabledSourceSlugs: [...(before.enabledSourceSlugs ?? [])], beganWhileProcessing: before.isProcessing,
    accepted: false, failed: false, sourceTools: new Map(),
  }
}

function signal(observation: TourObservation, name: SignalName, level: TourSignal['level'], identity: string, origin: TourSignal['origin'] = 'native-event'): TourSignal {
  return {
    name, level, origin, binding: observation.binding, operationToken: observation.operationToken,
    operationStartedAt: observation.at, eventToken: `${observation.operationToken}:${name}:${identity}`, at: Date.now(),
  } as TourSignal
}
function canonicalUserIndex(correlation: ChatTurnCorrelation, committed: Session) {
  return committed.messages.findIndex(message => message.role === 'user' && !message.isPending && !message.hidden && (message.id === correlation.userMessageId || message.backendMessageId === correlation.userMessageId))
}
function newFinal(correlation: ChatTurnCorrelation, committed: Session, id: string): Message | undefined {
  const userIndex = canonicalUserIndex(correlation, committed)
  if (userIndex < 0) return undefined
  const index = committed.messages.findIndex(message => message.id === id || message.backendMessageId === id)
  const message = committed.messages[index]
  if (index <= userIndex || !message || correlation.baselineMessageIds.has(message.id) || committed.messages.slice(userIndex + 1, index).some(item => item.role === 'user' && !item.hidden)) return undefined
  if (message.role !== 'assistant' || message.isIntermediate || message.isPending || message.isStreaming || message.isError || message.hidden || message.parentToolUseId || !message.content.trim()) return undefined
  return message
}

/** Called after the normal processor commits canonical state; never mutates domain state. */
export function deriveChatSignals(correlation: ChatTurnCorrelation, event: SessionEvent, _previous: Session | null | undefined, committed: Session): readonly TourSignal[] {
  if (event.sessionId !== correlation.sessionId || committed.id !== correlation.sessionId || committed.workspaceId !== correlation.workspaceId || committed.hidden) return []
  if (event.type === 'error' || event.type === 'typed_error' || event.type === 'interrupted' || event.type === 'messages_replaced' || (event.type === 'complete' && event.reason !== 'complete')) {
    correlation.failed = true
    correlation.finalMessageId = undefined
    return []
  }
  if (correlation.failed) return []
  if (event.type === 'user_message') {
    if (event.optimisticMessageId !== correlation.optimisticMessageId || !correlation.optimisticMessageId || event.message.role !== 'user' || event.message.hidden) return []
    const user = committed.messages.find(message => message.role === 'user' && !message.isPending && !message.hidden && (message.id === correlation.optimisticMessageId || message.id === event.message.id || message.backendMessageId === event.message.id))
    if (!user || correlation.baselineMessageIds.has(user.id)) return []
    correlation.userMessageId = user.id
    if (correlation.accepted) return []
    correlation.accepted = true
    return [signal(correlation.observation, 'user-turn.accepted', 'verified', event.message.id)]
  }
  if (!correlation.accepted) return []
  if (event.type === 'text_discard') {
    if (event.turnId === correlation.finalTurnId) correlation.finalMessageId = undefined
    return []
  }
  if (event.type === 'retry') {
    correlation.finalMessageId = undefined
    return []
  }
  if (event.type === 'text_complete') {
    if (correlation.beganWhileProcessing || event.isIntermediate || event.parentToolUseId) return []
    // Authoritative ID is strongest. Older text events may be matched only when
    // precisely one new canonical final in their native turn exists.
    const candidates = event.messageId ? [newFinal(correlation, committed, event.messageId)].filter(Boolean) : committed.messages.filter(message => event.turnId && message.turnId === event.turnId && newFinal(correlation, committed, message.id))
    if (candidates.length === 1) {
      correlation.finalMessageId = candidates[0]!.id
      correlation.finalTurnId = event.turnId
    }
    return []
  }
  if (event.type === 'complete') {
    if (event.reason !== 'complete' || event.didReceiveNewFinalMessage !== true || committed.isProcessing || !correlation.finalMessageId || correlation.beganWhileProcessing) return []
    const final = newFinal(correlation, committed, correlation.finalMessageId)
    if (!final) return []
    correlation.finalMessageId = undefined
    return [signal(correlation.observation, 'user-turn.final-delivered', 'verified', final.id)]
  }
  if (event.type === 'tool_start') {
    if (event.parentToolUseId || !correlation.enabledSourceSlugs.some(slug => event.toolName.startsWith(`mcp__${slug}__`))) return []
    const userIndex = canonicalUserIndex(correlation, committed)
    const toolIndex = committed.messages.findIndex(message => message.toolUseId === event.toolUseId)
    if (userIndex >= 0 && toolIndex > userIndex) correlation.sourceTools.set(event.toolUseId, event.turnId)
    return []
  }
  if (event.type === 'tool_result') {
    if (!correlation.sourceTools.has(event.toolUseId) || event.isError || event.parentToolUseId) return []
    const turnId = correlation.sourceTools.get(event.toolUseId)
    if (turnId && event.turnId && turnId !== event.turnId) return []
    const tool = committed.messages.find(message => message.role === 'tool' && message.toolUseId === event.toolUseId && message.toolStatus === 'completed' && !message.isError)
    if (!tool) return []
    correlation.sourceTools.delete(event.toolUseId)
    return [signal(correlation.observation, 'source.tool-succeeded', 'verified', event.toolUseId)]
  }
  return []
}

const turns = new Map<string, ChatTurnCorrelation>()
const operations = new Map<string, { observation: TourObservation; expected: string | readonly string[] | null; ambiguous: boolean }>()
const permissions = new Map<string, TourObservation>()
const creations = new Map<string, TourObservation>()
const reopens = new Map<string, TourObservation>()

export function beginChatUserTurn(observation: TourObservation | null, session: Session): () => void {
  const correlation = correlateUserTurn(observation, session)
  if (!correlation) return () => {}
  // Overlapping sends before IDs are bound are deliberately unverified.
  const prior = turns.get(session.id)
  if (prior && !prior.optimisticMessageId) correlation.failed = true
  turns.set(session.id, correlation)
  return () => { if (turns.get(session.id) === correlation) turns.delete(session.id) }
}
export function bindChatOptimisticMessage(sessionId: string, optimisticMessageId: string): void {
  const turn = turns.get(sessionId)
  if (turn && !turn.optimisticMessageId) turn.optimisticMessageId = optimisticMessageId
}
export function cancelChatUserTurn(sessionId: string): void { turns.delete(sessionId) }
export function clearChatObservations(): void { turns.clear(); operations.clear(); permissions.clear(); creations.clear(); reopens.clear() }

export function beginChatSessionCreation(observation: TourObservation | null): void {
  if (observation) creations.set(observation.binding.workspaceId, observation)
}
export function observeChatSessionCreated(session: Session): readonly TourSignal[] {
  const observation = creations.get(session.workspaceId)
  if (!observation || session.hidden) return []
  creations.delete(session.workspaceId)
  return [signal(observation, 'session.created', 'observed', session.id, 'native-commit')]
}
export function beginChatSessionReopen(observation: TourObservation | null, sessionId: string): void {
  if (observation) reopens.set(sessionId, observation)
}
/** Emits only once the selected native session has actually rendered. */
export function observeChatSessionReopened(session: Session): readonly TourSignal[] {
  const observation = reopens.get(session.id)
  if (!observation || session.hidden || observation.binding.workspaceId !== session.workspaceId) return []
  reopens.delete(session.id)
  return [signal(observation, 'session.reopened', 'observed', session.id, 'ui-observation')]
}

export type ChatCommitSignal = 'session.status-committed' | 'session.labels-committed' | 'session.project-committed' | 'session.sources-committed'
export function beginChatCommit(observation: TourObservation | null, name: ChatCommitSignal, expected: string | readonly string[] | null): void {
  if (observation?.binding.sessionId) {
    const key = `${observation.binding.sessionId}:${name}`
    operations.set(key, { observation, expected: Array.isArray(expected) ? [...expected] : expected, ambiguous: operations.has(key) })
  }
}
export function beginChatPermissionResponse(observation: TourObservation | null, sessionId: string, requestId: string): void {
  if (observation && observation.binding.sessionId === sessionId) permissions.set(`${sessionId}:${requestId}`, observation)
}
export function observeChatPermissionResponse(sessionId: string, requestId: string, success: boolean): readonly TourSignal[] {
  const key = `${sessionId}:${requestId}`
  const observation = permissions.get(key)
  permissions.delete(key)
  return success && observation ? [signal(observation, 'permission.resolved-by-user', 'verified', requestId, 'native-commit')] : []
}

export function observeChatSessionEvent(event: SessionEvent, previous: Session | null | undefined, committed: Session): readonly TourSignal[] {
  const turn = turns.get(event.sessionId)
  const signals = turn ? [...deriveChatSignals(turn, event, previous, committed)] : []
  if (event.type === 'complete' || event.type === 'interrupted' || event.type === 'session_deleted' || event.type === 'messages_replaced') turns.delete(event.sessionId)
  let name: ChatCommitSignal | undefined
  let matches = false
  let actual: string | readonly string[] | null = null
  if (event.type === 'session_status_changed') { name = 'session.status-committed'; actual = event.sessionStatus; matches = committed.sessionStatus === event.sessionStatus }
  if (event.type === 'labels_changed') { name = 'session.labels-committed'; actual = event.labels; matches = JSON.stringify(committed.labels ?? []) === JSON.stringify(event.labels) }
  if (event.type === 'project_id_changed') { name = 'session.project-committed'; actual = event.projectId; matches = (committed.projectId ?? null) === event.projectId }
  if (event.type === 'sources_changed') { name = 'session.sources-committed'; actual = event.enabledSourceSlugs; matches = JSON.stringify(committed.enabledSourceSlugs ?? []) === JSON.stringify(event.enabledSourceSlugs) }
  if (name) {
    const key = `${event.sessionId}:${name}`
    const operation = operations.get(key)
    if (matches && operation && JSON.stringify(operation.expected) === JSON.stringify(actual) && operation.observation.binding.workspaceId === committed.workspaceId) {
      operations.delete(key)
      if (!operation.ambiguous) signals.push(signal(operation.observation, name, 'observed', event.type, 'native-commit'))
    }
  }
  return signals
}

export function deriveExecutionCapabilities(session: Session | null, permissionPending = false): CapabilitySnapshot {
  return {
    'sessions.available': session && !session.hidden ? { state: 'ready' } : { state: 'unavailable', reason: 'missing-entity' },
    'permissions.pending': permissionPending ? { state: 'ready' } : { state: 'unavailable', reason: 'missing-entity' },
  }
}
export const chatTargetBindings = [
  'session.entry', 'composer.permissions', 'composer.input', 'composer.send', 'session.execution', 'session.final-result', 'composer.model', 'composer.directory', 'composer.attach', 'composer.attachments', 'composer.voice', 'session.tool-result', 'permission.request', 'permission.actions', 'session.new', 'session.list', 'agents.summary', 'agents.budget', 'session.status', 'session.labels', 'sessions.view-switcher', 'session.project',
] as const satisfies readonly TargetId[]
