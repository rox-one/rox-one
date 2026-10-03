import type { AnnotationV1, Message } from '@rox/core/types'
import { CodedError, RPC_CHANNELS, type Session, type SessionEvent } from '@rox/shared/protocol'
import type { LoadedSource } from '@rox/shared/sources'
import { readNativeWorkspaceRegistry } from './native-workspace-registry'
import type { HandlerDeps } from '../handler-deps'
import type { RequestContext, RpcServer } from '../../transport/types'
import type { NativeAuthority, NativePrincipal } from '../../authority/native-authority'

/** Workspace membership, not a renderer-supplied session id, defines native access. */
export function assertNativeWorkspace(ctx: RequestContext, deps: HandlerDeps, workspaceId: string): void {
  if (!ctx.principal) return
  const workspace = readNativeWorkspaceRegistry(workspaceId)
  if (ctx.workspaceId !== workspaceId || !workspace
    || !deps.nativeData?.authority.authorize(ctx.principal, workspaceId, 'read', workspace.rootPath)) {
    throw new CodedError('FORBIDDEN', 'Workspace access denied')
  }
}

export function assertNativeSession(ctx: RequestContext, deps: HandlerDeps, server: RpcServer, sessionId: string): void {
  if (!ctx.principal) return
  assertNativeWorkspace(ctx, deps, ctx.workspaceId ?? '')
  if (!deps.sessionManager.getSessions(ctx.workspaceId!).some(session => session.id === sessionId && session.workspaceId === ctx.workspaceId)) {
    throw new CodedError('FORBIDDEN', 'Session access denied')
  }
  if (!server.isRequestContextCurrent?.(ctx)) throw new CodedError('AUTH_FAILED', 'Workspace permission changed')
}

export function nativeAnnotation(annotation: AnnotationV1): AnnotationV1 {
  return {
    id: annotation.id, schemaVersion: 1, createdAt: annotation.createdAt,
    updatedAt: annotation.updatedAt, deletedAt: annotation.deletedAt,
    createdBy: annotation.createdBy ? { id: annotation.createdBy.id, name: annotation.createdBy.name, type: annotation.createdBy.type } : undefined,
    body: annotation.body.map(body => body.type === 'note' ? { type: body.type, text: body.text, format: body.format }
      : body.type === 'tag' ? { type: body.type, value: body.value } : { type: 'highlight' }),
    target: { source: { sessionId: annotation.target.source.sessionId, messageId: annotation.target.source.messageId }, selectors: annotation.target.selectors.filter(selector => selector.type !== 'block').map(selector => ({ ...selector })) },
    intent: annotation.intent, status: annotation.status,
    style: annotation.style ? { color: annotation.style.color, opacity: annotation.style.opacity } : undefined,
    meta: annotation.meta?.kind === 'reaction' ? { kind: 'reaction', emoji: annotation.meta.emoji, vote: annotation.meta.vote, collaborationReady: true } : undefined,
  }
}

export function nativeMessage(message: Message): Message | null {
  if (message.hidden || (message.role !== 'user' && message.role !== 'assistant')) return null
  return {
    id: message.id, backendMessageId: message.backendMessageId, role: message.role,
    content: message.content, timestamp: message.timestamp, turnId: message.turnId,
    isStreaming: message.isStreaming, isIntermediate: message.isIntermediate,
    isPending: message.isPending, isQueued: message.isQueued, hidden: message.hidden,
    annotations: message.annotations?.map(nativeAnnotation),
  }
}

const sessionFields = ['id', 'workspaceId', 'workspaceName', 'name', 'preview', 'lastMessageAt',
  'isProcessing', 'isFlagged', 'permissionMode', 'memoryMode', 'sessionStatus', 'labels',
  'lastReadMessageId', 'hasUnread', 'enabledSourceSlugs', 'model', 'llmConnection', 'thinkingLevel',
  'lastMessageRole', 'lastFinalMessageId', 'createdAt', 'messageCount', 'tokenUsage', 'hidden',
  'isArchived', 'archivedAt', 'supportsBranching', 'branchFromMessageId', 'branchFromSessionId',
  'projectId', 'parentSessionId', 'kanbanColumn', 'rank', 'priority', 'dueDate'] as const

export function nativeSession(session: Session): Session {
  const projected = Object.fromEntries(sessionFields.map(key => [key, session[key]])) as unknown as Session
  projected.messages = session.messages.map(nativeMessage).filter((message): message is Message => message !== null)
  return projected
}

export function nativeSources(sources: readonly LoadedSource[]): LoadedSource[] {
  return sources.map(source => ({
    workspaceId: source.workspaceId, folderPath: '', workspaceRootPath: '', guide: null,
    isBuiltin: source.isBuiltin,
    config: {
      id: source.config.id, slug: source.config.slug, name: source.config.name,
      type: source.config.type, provider: source.config.provider, enabled: source.config.enabled,
      icon: source.config.icon && !/^(?:file:|\/|[A-Za-z]:[\\/])/.test(source.config.icon) ? source.config.icon : undefined,
      tagline: source.config.tagline,
      isAuthenticated: source.config.isAuthenticated, connectionStatus: source.config.connectionStatus,
      lastTestedAt: source.config.lastTestedAt,
    },
  }))
}

/** Only conversation display events cross the native boundary; tool/auth/host data stay server-side. */
export function nativeSessionEvent(event: SessionEvent): SessionEvent | null {
  const identity = { type: event.type, sessionId: event.sessionId }
  switch (event.type) {
    case 'user_message': {
      const message = nativeMessage(event.message)
      return message ? { ...identity, type: event.type, message, status: event.status, optimisticMessageId: event.optimisticMessageId } : null
    }
    case 'message_annotations_updated': return { ...identity, type: event.type, messageId: event.messageId, annotations: event.annotations.map(nativeAnnotation) }
    case 'text_delta': return { ...identity, type: event.type, delta: event.delta, turnId: event.turnId }
    case 'text_complete': return { ...identity, type: event.type, text: event.text, isIntermediate: event.isIntermediate, turnId: event.turnId, timestamp: event.timestamp, messageId: event.messageId }
    case 'thinking_delta': case 'thinking_complete': return { ...identity, type: event.type, text: event.text, turnId: event.turnId }
    case 'complete': return { ...identity, type: event.type, tokenUsage: event.tokenUsage, hasUnread: event.hasUnread, reason: event.reason, didReceiveNewFinalMessage: event.didReceiveNewFinalMessage }
    case 'error': return { type: 'error', sessionId: event.sessionId, error: 'native-session-request-failed', errorCode: 'NATIVE_SESSION_REQUEST_FAILED', timestamp: event.timestamp }
    case 'title_generated': return { ...identity, type: event.type, title: event.title }
    case 'name_changed': return { ...identity, type: event.type, name: event.name }
    case 'session_created': case 'session_deleted': case 'session_flagged': case 'session_unflagged': case 'session_archived': case 'session_unarchived': return { type: event.type, sessionId: event.sessionId }
    case 'session_status_changed': return { ...identity, type: event.type, sessionStatus: event.sessionStatus }
    case 'session_model_changed': return { ...identity, type: event.type, model: event.model }
    case 'permission_mode_changed':
      return ['safe', 'ask', 'allow-all'].includes(event.permissionMode) ? {
        ...identity, type: event.type, permissionMode: event.permissionMode,
        previousPermissionMode: event.previousPermissionMode && ['safe', 'ask', 'allow-all'].includes(event.previousPermissionMode) ? event.previousPermissionMode : undefined,
        modeVersion: Number.isFinite(event.modeVersion) ? event.modeVersion : undefined,
      } : null
    case 'labels_changed': return { ...identity, type: event.type, labels: event.labels }
    default: return null
  }
}

export function projectNativeWorkspaceEvent(
  channel: string, args: readonly unknown[], workspaceId: string,
  sessionExists: (sessionId: string, workspaceId: string) => boolean,
): readonly unknown[] | null {
  if (channel === RPC_CHANNELS.sessions.EVENT) {
    const event = args[0] as SessionEvent | undefined
    if (!event || typeof event.sessionId !== 'string' || !sessionExists(event.sessionId, workspaceId)) return null
    const projected = nativeSessionEvent(event)
    return projected ? [projected] : null
  }
  if (channel === RPC_CHANNELS.sources.CHANGED) {
    if (args[0] !== workspaceId || !Array.isArray(args[1])) return null
    return [workspaceId, nativeSources(args[1] as LoadedSource[])]
  }
  return args
}

/** The headless native event fence must not call migration-capable host roster getters. */
export function projectNativeRegisteredWorkspaceEvent(
  authority: Pick<NativeAuthority, 'authorize' | 'resolveWorkspace'>, channel: string, args: readonly unknown[], workspaceId: string,
  principal: NativePrincipal, sessionExists: (sessionId: string, workspaceId: string) => boolean,
): readonly unknown[] | null {
  if (channel === RPC_CHANNELS.sessions.EVENT || channel === RPC_CHANNELS.sources.CHANGED) {
    const workspace = readNativeWorkspaceRegistry(workspaceId)
    if (!workspace || authority.resolveWorkspace(workspaceId)?.nativeRoot !== workspace.rootPath
      || !authority.authorize(principal, workspaceId, 'read', workspace.rootPath)) return null
  }
  return projectNativeWorkspaceEvent(channel, args, workspaceId, sessionExists)
}
