import type { RuntimeEvent, RuntimeContent, RuntimeRunSummary } from '@rox/core/runtime-trace'
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
  'parentSessionId', 'kanbanColumn', 'rank', 'priority', 'dueDate'] as const

/** Public metadata IDs are never host paths or project-context capabilities. */
function nativeProjectMembership(membership: { projectId?: unknown; projectIds?: unknown }): { projectId?: string; projectIds: string[] } {
  const raw = [membership.projectId, ...(Array.isArray(membership.projectIds) ? membership.projectIds : [])]
  const projectIds = [...new Set(raw.filter((id): id is string => typeof id === 'string' && /^[\p{L}\p{N}][\p{L}\p{N}._-]{0,127}$/u.test(id)))]
  return { projectId: projectIds[0], projectIds }
}

export function nativeSession(session: Session): Session {
  const projected = Object.fromEntries(sessionFields.map(key => [key, session[key]])) as unknown as Session
  Object.assign(projected, nativeProjectMembership(session))
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

/** Preserve event identities/cursors while retaining the native boundary's host-data restriction. */
function isOriginalRootUserRequest(event: RuntimeEvent): boolean {
  return event.kind === 'run.accepted' && event.payload.launch.kind === 'manual'
    && !event.payload.launch.triggerId?.startsWith('task:') && !!event.messageId
    && !event.parentAgentId && event.runId === event.rootRunId
}

/** Header excerpts cannot prove their own provenance; use only the permitted observed request. */
export function nativeRuntimeTraceRunSummary(run: RuntimeRunSummary, events: readonly RuntimeEvent[]): RuntimeRunSummary {
  const request = events.find(event => event.rootRunId === run.rootRunId && isOriginalRootUserRequest(event))
  return { rootRunId: run.rootRunId, sessionId: run.sessionId, agentId: run.agentId, status: run.status,
    startedAt: run.startedAt, prompt: request?.kind === 'run.accepted' ? request.payload.prompt.text?.slice(0, 4096) ?? '' : '', coverage: run.coverage }
}

export function nativeRuntimeTraceEvent(event: RuntimeEvent): RuntimeEvent {
  const redacted = (): RuntimeContent => ({ availability: 'redacted', tokens: { state: 'unknown', reason: 'redacted' } })
  const copy = structuredClone(event)
  delete copy.payloadRef
  const payload = copy.payload
  switch (copy.kind) {
    case 'run.accepted':
      if (!isOriginalRootUserRequest(copy)) copy.payload.prompt = redacted()
      break
    case 'context.captured': case 'context.changed': {
      copy.payload.snapshot.originalPrompt = redacted()
      copy.payload.snapshot.effectivePrompt = redacted()
      copy.payload.snapshot.workingDirectory = undefined
      copy.payload.snapshot.blocks = copy.payload.snapshot.blocks.map(block => ({ ...block, source: block.kind, content: redacted() }))
      copy.payload.snapshot.coverage = { ...copy.payload.snapshot.coverage, state: 'partial', missing: [...copy.payload.snapshot.coverage.missing, 'host-data-redacted'] }
      break
    }
    case 'tool.started': case 'tool.output': case 'tool.completed':
      copy.payload.input = redacted(); copy.payload.result = redacted(); copy.payload.modelContent = redacted(); copy.payload.error = undefined
      break
    case 'terminal.started': case 'terminal.output': case 'terminal.completed':
      copy.payload.command = '[REDACTED]'; copy.payload.cwd = undefined; copy.payload.shell = undefined; copy.payload.error = undefined; copy.payload.stdout = redacted(); copy.payload.stderr = redacted()
      break
    case 'agent.assigned': copy.payload.assignment.task = redacted(); copy.payload.assignment.prompt = redacted(); copy.payload.assignment.expectedResult = redacted(); break
    case 'agent.completed': copy.payload.result = redacted(); break
    case 'skill.selected': case 'skill.loaded': case 'skill.applied': copy.payload.content = redacted(); break
    case 'memory.retrieved': case 'memory.included': case 'memory.proposed': case 'memory.committed': copy.payload.content = redacted(); break
    case 'plan.published': case 'plan.revised':
      copy.payload.plan.title = undefined; copy.payload.plan.content = redacted(); copy.payload.plan.tasks = copy.payload.plan.tasks.map(task => ({ ...task, title: '[REDACTED]', criteria: [], description: redacted() })); break
    case 'task.state-changed': copy.payload.task.title = '[REDACTED]'; copy.payload.task.criteria = []; copy.payload.task.description = redacted(); break
    case 'acceptance.started': case 'acceptance.completed': copy.payload.acceptance.criterion = '[REDACTED]'; copy.payload.acceptance.evidence = [redacted()]; break
    case 'artifact.created': copy.payload.artifact.label = '[REDACTED]'; copy.payload.artifact.uri = undefined; copy.payload.artifact.content = redacted(); break
    case 'result.published':
      if (!copy.messageId || copy.parentAgentId || copy.runId !== copy.rootRunId) copy.payload.content = redacted()
      break
    case 'context.compacted': copy.payload.snapshot = undefined; copy.payload.summary = redacted(); break
    case 'approval.requested': copy.payload.description = '[REDACTED]'; break
    case 'attempt.started': case 'attempt.completed': copy.payload.description = undefined; break
    case 'operation.queued': copy.payload.description = '[REDACTED]'; break
  }
  // Even conversation records may reference a host-side blob. Never expose those pointers.
  const stripReferences = (node: unknown): void => {
    if (!node || typeof node !== 'object') return
    if ('payloadRef' in node) delete (node as Record<string, unknown>).payloadRef
    for (const item of Object.values(node)) stripReferences(item)
  }
  stripReferences(payload)
  return copy
}

/** Only conversation display events cross the native boundary; tool/auth/host data stay server-side. */
export function nativeSessionEvent(event: SessionEvent): SessionEvent | null {
  const identity = { type: event.type, sessionId: event.sessionId }
  switch (event.type) {
    case 'runtime_trace_health': return { ...identity, type: event.type, workspaceId: event.workspaceId, rootRunId: event.rootRunId, coverage: { ...event.coverage, reason: event.coverage.reason ? 'Runtime observation recording is incomplete.' : undefined, missing: [...new Set([...event.coverage.missing, 'host-data-redacted'])] } }
    case 'runtime_trace': return { ...identity, type: event.type, event: nativeRuntimeTraceEvent(event.event) }
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
    case 'project_id_changed': {
      if (event.projectIds !== undefined && !Array.isArray(event.projectIds)) return null
      const membership = nativeProjectMembership(event)
      return { ...identity, type: event.type, projectId: membership.projectId ?? null, projectIds: membership.projectIds }
    }
    case 'session_metadata_changed': {
      if (!event.changes || typeof event.changes !== 'object'
        || (!Object.hasOwn(event.changes, 'projectId') && !Object.hasOwn(event.changes, 'projectIds'))
        || (event.changes.projectIds !== undefined && !Array.isArray(event.changes.projectIds))) return null
      // Undefined is omitted by JSON, so an explicit empty metadata list must
      // use the display event's null to clear an existing primary binding.
      const membership = nativeProjectMembership(event.changes)
      if (!membership.projectId && Array.isArray(event.changes.projectIds) && event.changes.projectIds.length === 0
        && (event.changes.projectId === undefined || event.changes.projectId === null || event.changes.projectId === '')) {
        return { type: 'project_id_changed', sessionId: event.sessionId, projectId: null, projectIds: [] }
      }
      return membership.projectId ? { ...identity, type: event.type, changes: membership } : null
    }
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
