import { getRoxAccountAuthority, peekRoxAccountAuthority, LOCAL_ROX_CALLER } from '@rox/shared/auth'
import { readFile, writeFile, stat } from 'fs/promises'
import { join } from 'path'
import {
  RPC_CHANNELS,
  CodedError,
  type BulkUpdateSessionsInput,
  type BulkUpdateSessionsResult,
  type FileAttachment,
  type SendMessageOptions,
  type SessionEvent,
} from '@rox/shared/protocol'
import type { StoredAttachment, SessionMemoryMode } from '@rox/core/types'
import { isRuntimeLaunch } from '@rox/core/runtime-trace'
import { getWorkspaceByNameOrId } from '@rox/shared/config'
import { perf } from '@rox/shared/utils'
import { isValidThinkingLevel, THINKING_LEVEL_IDS } from '@rox/shared/agent/thinking-levels'
import { loadWorkspaceConfig } from '@rox/shared/workspaces'
import { assertNativeSession, assertNativeWorkspace, nativeAnnotation, nativeSession } from './native-session-scope'
import { awardNativeXpAndBroadcast } from './gamification'
import type { RequestContext } from '../../transport/types'
import type { NativeMemoryContext } from '../../memory/MemoryService'
import { MemoryFileStore } from '../../memory/MemoryFileStore'
import { dirname } from 'path'
import { assertNativeInboxPath, assertNativeInboxWorkspace, nativeInboxOwner } from './native-inbox-scope'

const VALID_THINKING_LEVELS_LIST = THINKING_LEVEL_IDS.map(id => `'${id}'`).join(', ')
import { pushTyped, type RpcServer } from '@rox/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { setTransferableHandler } from './transfer'
import { assertValidBulkUpdateInput, assertValidBulkUpdatePatch } from '../../sessions/bulk-labels'
import { disposeBroInviteService, getBroInviteService } from '../../collaboration/bro-invite-service.ts'
import { parseInviteUrl } from '@rox/shared/collaboration'
import { getNativeSessionCollaboration, NATIVE_SHARING_COMMANDS } from './native-session-collaboration'
import {
  isClaimableLive,
  rpcSessionsActResult,
  rpcSessionsListResult,
  rpcSessionsReadResult,
} from '@rox/core/rox2'

interface ClientSessionWatchState {
  watcher: import('fs').FSWatcher
  sessionId: string
  debounceTimer: ReturnType<typeof setTimeout> | null
}

// Per-client session file watcher state (supports concurrent windows/clients safely)
const clientSessionWatches = new Map<string, ClientSessionWatchState>()

const SESSION_GET_LOG_ID_LIMIT = 25

function nativeMemoryContext(ctx: RequestContext, deps: HandlerDeps, server: RpcServer, workspaceId: string): NativeMemoryContext | undefined {
  const owner = nativeInboxOwner(ctx)
  if (!owner) return
  const root = assertNativeInboxWorkspace(ctx, deps, server, workspaceId, 'write')!
  return { owner, assertAuthorized: () => {
    assertNativeInboxWorkspace(ctx, deps, server, workspaceId, 'write', root)
    assertNativeInboxPath(root, ['memory'], true)
    assertNativeInboxPath(root, ['skills', '.pending'], true)
    assertNativeInboxPath(dirname(new MemoryFileStore('global').memoryDir), ['memory'], true)
  } }
}

function summarizeIds(ids: Iterable<string>, limit = SESSION_GET_LOG_ID_LIMIT) {
  const all = Array.from(ids)
  return {
    count: all.length,
    ids: all.slice(0, limit),
    truncated: all.length > limit,
  }
}

function sessionWorkspaceDistribution(sessions: Array<{ workspaceId?: string }>): Record<string, number> {
  const distribution: Record<string, number> = {}
  for (const session of sessions) {
    const key = session.workspaceId || '(missing)'
    distribution[key] = (distribution[key] ?? 0) + 1
  }
  return distribution
}

/**
 * Clean up session file watcher for a client.
 * Called from main process disconnect hooks to prevent watcher leaks.
 */
export function cleanupSessionFileWatchForClient(clientId: string): void {
  const state = clientSessionWatches.get(clientId)
  if (!state) return

  if (state.debounceTimer) {
    clearTimeout(state.debounceTimer)
    state.debounceTimer = null
  }

  state.watcher.close()
  clientSessionWatches.delete(clientId)
}

// Recursive directory scanner for session files
// Filters out internal files (session.jsonl) and hidden files (. prefix)
// Returns only non-empty directories
async function scanSessionDirectory(dirPath: string): Promise<import('@rox/shared/protocol').SessionFile[]> {
  const { readdir, stat } = await import('fs/promises')
  const entries = await readdir(dirPath, { withFileTypes: true })
  const files: import('@rox/shared/protocol').SessionFile[] = []

  for (const entry of entries) {
    // Skip internal and hidden files
    if (entry.name === 'session.jsonl' || entry.name.startsWith('.')) continue

    const fullPath = join(dirPath, entry.name)

    if (entry.isDirectory()) {
      // Recursively scan subdirectory
      const children = await scanSessionDirectory(fullPath)
      // Only include non-empty directories
      if (children.length > 0) {
        files.push({
          name: entry.name,
          path: fullPath,
          type: 'directory',
          children,
        })
      }
    } else {
      const stats = await stat(fullPath)
      files.push({
        name: entry.name,
        path: fullPath,
        type: 'file',
        size: stats.size,
      })
    }
  }

  // Sort: directories first, then alphabetically
  return files.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.sessions.GET,
  RPC_CHANNELS.sessions.GET_UNREAD_SUMMARY,
  RPC_CHANNELS.sessions.MARK_ALL_READ,
  RPC_CHANNELS.sessions.CREATE,
  RPC_CHANNELS.sessions.DELETE,
  RPC_CHANNELS.sessions.GET_MESSAGES,
  RPC_CHANNELS.sessions.SEND_MESSAGE,
  RPC_CHANNELS.sessions.CANCEL,
  RPC_CHANNELS.sessions.KILL_SHELL,
  RPC_CHANNELS.tasks.GET_OUTPUT,
  RPC_CHANNELS.sessions.RESPOND_TO_PERMISSION,
  RPC_CHANNELS.sessions.RESPOND_TO_CREDENTIAL,
  RPC_CHANNELS.sessions.COMMAND,
  RPC_CHANNELS.sessions.BULK_UPDATE,
  RPC_CHANNELS.sessions.GET_PENDING_PLAN_EXECUTION,
  RPC_CHANNELS.sessions.GET_PERMISSION_MODE_STATE,
  RPC_CHANNELS.sessions.GET_BUDGET,
  RPC_CHANNELS.sessions.SET_BUDGET,
  RPC_CHANNELS.sessions.SET_MEMORY_MODE,
  RPC_CHANNELS.sessions.GET_PROVENANCE,
  RPC_CHANNELS.sessions.SEARCH_CONTENT,
  RPC_CHANNELS.sessions.GET_FILES,
  RPC_CHANNELS.sessions.GET_NOTES,
  RPC_CHANNELS.sessions.SET_NOTES,
  RPC_CHANNELS.sessions.WATCH_FILES,
  RPC_CHANNELS.sessions.UNWATCH_FILES,
  RPC_CHANNELS.sessions.EXPORT,
  RPC_CHANNELS.sessions.IMPORT,
  RPC_CHANNELS.sessions.EXPORT_REMOTE_TRANSFER,
  RPC_CHANNELS.sessions.IMPORT_REMOTE_TRANSFER,
] as const

export function registerSessionsHandlers(server: RpcServer, deps: HandlerDeps): void {
  const { sessionManager, platform } = deps
  if (deps.nativeData) sessionManager.setNativeMemoryContextPolicy?.(workspaceId => deps.nativeData!.authority.isRegisteredWorkspace(workspaceId))
  const log = platform.logger
  server.onShutdown?.(disposeBroInviteService)
  // Provenance comes from the persistence acknowledgement, never an optimistic
  // renderer id or a workspace event subscriber. Completed replies credit only
  // the actor who submitted the preceding canonical user message.
  const nativeTurnOrigins = new Map<string, { context: RequestContext; sessionId: string; messageId: string }>()
  const originKey = (sessionId: string, messageId: string) => JSON.stringify([sessionId, messageId])
  const releaseXpPolicy = sessionManager.setLegacyCompletionXpPolicy?.(event => !deps.nativeData?.authority.isRegisteredWorkspace(event.workspaceId))
  const unsubscribeCompletion = sessionManager.onSessionComplete?.(event => {
    const origins = [...nativeTurnOrigins.entries()].filter(([, origin]) => origin.sessionId === event.sessionId && origin.context.workspaceId === event.workspaceId)
    if (!origins.length) return
    if (event.reason !== 'complete' || !event.finalMessageId) {
      for (const [key] of origins) nativeTurnOrigins.delete(key)
      return
    }
    void (async () => {
      try {
        const session = await sessionManager.getSession(event.sessionId)
        if (!session || session.workspaceId !== event.workspaceId) return
        const finalIndex = session.messages.findIndex(message => message.id === event.finalMessageId)
        const reply = session.messages[finalIndex]
        if (!reply || reply.role !== 'assistant' || reply.isIntermediate || reply.hidden || !reply.content.trim()) return
        const userMessage = session.messages.slice(0, finalIndex).findLast(message => message.role === 'user' && !message.hidden)
        if (!userMessage) return
        const origin = nativeTurnOrigins.get(originKey(event.sessionId, userMessage.id))
        if (!origin || origin.context.workspaceId !== event.workspaceId) return
        assertNativeSession(origin.context, deps, server, event.sessionId)
        awardNativeXpAndBroadcast(server, deps, origin.context, 'session_completed',
          JSON.stringify([event.workspaceId, event.sessionId, userMessage.id, event.finalMessageId]))
      } catch { /* A revoked/disconnected actor never falls back to host XP. */ }
      finally { for (const [key] of origins) nativeTurnOrigins.delete(key) }
    })()
  })
  const unsubscribeOrigins = server.onClientDisconnect?.(clientId => {
    for (const [key, origin] of nativeTurnOrigins) if (origin.context.clientId === clientId) nativeTurnOrigins.delete(key)
  })
  server.onShutdown?.(() => {
    unsubscribeOrigins?.(); unsubscribeCompletion?.(); releaseXpPolicy?.(); nativeTurnOrigins.clear()
  })

  // Get all sessions for the calling window's workspace
  // Waits for initialization to complete so sessions are never returned empty during startup
  server.handle(RPC_CHANNELS.sessions.GET, async (ctx) => {
    const listed = rpcSessionsListResult({ source: 'native' })
    if (!isClaimableLive(listed.result)) return []
    try {
      await sessionManager.waitForInit()
    } catch (error) {
      log.error('GET_SESSIONS continuing after initialization failure:', error)
    }
    const end = perf.start('rpc.getSessions')
    const windowWorkspaceId = ctx.webContentsId != null
      ? deps.windowManager?.getWorkspaceForWindow(ctx.webContentsId)
      : undefined
    const workspaceId = ctx.workspaceId ?? windowWorkspaceId
    if (ctx.principal) assertNativeWorkspace(ctx, deps, workspaceId ?? '')
    const sessions = sessionManager.getSessions(workspaceId ?? undefined)
    end()

    log.info('[sessions:get] result', {
      ctxWorkspaceId: ctx.workspaceId,
      webContentsId: ctx.webContentsId,
      windowWorkspaceId,
      resolvedWorkspaceId: workspaceId,
      returnedCount: sessions.length,
      returnedWorkspaceIds: sessionWorkspaceDistribution(sessions),
      returnedIds: summarizeIds(sessions.map(s => s.id)),
    })

    return ctx.principal ? sessions.map(nativeSession) : sessions
  }, { nativeAction: 'read' })

  // Get unread summary across all workspaces
  server.handle(RPC_CHANNELS.sessions.GET_UNREAD_SUMMARY, async () => {
    try {
      await sessionManager.waitForInit()
    } catch (error) {
      log.error('GET_UNREAD_SUMMARY continuing after initialization failure:', error)
    }
    return sessionManager.getUnreadSummary()
  })

  server.handle(RPC_CHANNELS.sessions.MARK_ALL_READ, async (_ctx, workspaceId: string) => {
    return sessionManager.markAllSessionsRead(workspaceId)
  })

  // Get a single session with messages (for lazy loading)
  server.handle(RPC_CHANNELS.sessions.GET_MESSAGES, async (ctx, sessionId: string) => {
    assertNativeSession(ctx, deps, server, sessionId)
    const read = rpcSessionsReadResult({ source: 'native', nativeId: sessionId })
    if (!isClaimableLive(read.result)) return null
    const end = perf.start('rpc.getSessionMessages')
    const session = await sessionManager.getSession(sessionId)
    end()
    assertNativeSession(ctx, deps, server, sessionId)
    return ctx.principal && session ? nativeSession(session) : session
  }, { nativeAction: 'read' })

  // Create a new session
  server.handle(RPC_CHANNELS.sessions.CREATE, async (ctx, workspaceId: string, options?: import('@rox/shared/protocol').CreateSessionOptions) => {
    assertNativeWorkspace(ctx, deps, workspaceId)
    if (ctx.principal) {
      if (!server.isRequestContextCurrent?.(ctx)) throw new CodedError('AUTH_FAILED', 'Workspace permission changed')
      if (options?.branchFromSessionId) assertNativeSession(ctx, deps, server, options.branchFromSessionId)
      if (options?.parentSessionId) assertNativeSession(ctx, deps, server, options.parentSessionId)
      const workspace = getWorkspaceByNameOrId(workspaceId)
      if (!workspace) throw new CodedError('FORBIDDEN', 'Workspace access denied')
      const configuredConnection = loadWorkspaceConfig(workspace.rootPath)?.defaults?.defaultLlmConnection
      const branchParentId = options?.branchFromSessionId
      const parentConnection = branchParentId
        ? sessionManager.getSessions(workspaceId).find(session => session.id === branchParentId)?.llmConnection : undefined
      if (options?.llmConnection && options.llmConnection !== configuredConnection && options.llmConnection !== parentConnection) {
        throw new CodedError('FORBIDDEN', 'Connection access denied')
      }
      if (options?.workingDirectory && !['none', 'user_default'].includes(options.workingDirectory)
        && !deps.nativeData?.authority.authorize(ctx.principal, workspaceId, 'write', options.workingDirectory)) {
        throw new CodedError('FORBIDDEN', 'Working directory access denied')
      }
      // Explicit construction prevents task/project/system-prompt fields from
      // selecting unrelated host resources. Native sessions start in their own folder.
      options = { name: options?.name, permissionMode: options?.permissionMode,
        thinkingLevel: options?.thinkingLevel, model: options?.model, llmConnection: options?.llmConnection,
        sessionStatus: options?.sessionStatus, labels: options?.labels, isFlagged: options?.isFlagged,
        enabledSourceSlugs: options?.enabledSourceSlugs, branchFromSessionId: options?.branchFromSessionId,
        branchFromMessageId: options?.branchFromMessageId, workingDirectory: options?.workingDirectory && options.workingDirectory !== 'user_default' ? options.workingDirectory : 'none' }
    }
    const act = rpcSessionsActResult({ source: 'native', action: 'write', nativeId: workspaceId || 'session' })
    if (!isClaimableLive(act)) throw new Error('session create is not live')
    const end = perf.start('rpc.createSession', { workspaceId })
    // The renderer adds the session synchronously from this return value (App.tsx handleCreateSession),
    // so suppress the broadcast to avoid a redundant hydrate round-trip.
    const session = await sessionManager.createSession(workspaceId, options, { emitCreatedEvent: false,
      nativeMemoryContext: nativeMemoryContext(ctx, deps, server, workspaceId) })
    end()
    return ctx.principal ? nativeSession(session) : session
  }, { nativeAction: 'write' })

  // Delete a session
  server.handle(RPC_CHANNELS.sessions.DELETE, async (_ctx, sessionId: string) => {
    if (!sessionId) throw new Error('sessionId is required')
    const act = rpcSessionsActResult({ source: 'native', action: 'destroy', granted: true, nativeId: sessionId })
    if (!isClaimableLive(act)) throw new Error('session delete is not live')
    return sessionManager.deleteSession(sessionId)
  })

  // Send a message to a session (with optional file attachments).
  //
  // Behavior:
  //   - Awaits until the user message is persisted to disk, then returns
  //     `{ accepted: true, messageId }`. This guarantees the message survives
  //     a mid-stream crash (#616).
  //   - The actual model-streaming work continues in the background; results
  //     flow back via SESSION_EVENT as before.
  //   - Pre-persist errors (session not found, etc.) reject the RPC so the
  //     caller can show a synchronous error.
  //   - Post-persist errors (model API failures, etc.) are routed via the
  //     event stream as today.
  // attachments: FileAttachment[] for Claude (has content), storedAttachments: StoredAttachment[] for persistence (has thumbnailBase64)
  server.handle(RPC_CHANNELS.sessions.SEND_MESSAGE, async (ctx, sessionId: string, message: string, attachments?: FileAttachment[], storedAttachments?: StoredAttachment[], options?: SendMessageOptions) => {
    assertNativeSession(ctx, deps, server, sessionId)
    if (ctx.principal) {
      if (attachments?.length || storedAttachments?.length || options?.badges?.length || options?.hidden) {
        throw new CodedError('FORBIDDEN', 'Native message attachment access denied')
      }
      options = { skillSlugs: options?.skillSlugs, optimisticMessageId: options?.optimisticMessageId }
      const workingDirectory = sessionManager.getSessionWorkingDirectory(sessionId)
      if (workingDirectory && !deps.nativeData?.authority.authorize(ctx.principal, ctx.workspaceId!, 'write', workingDirectory)) {
        throw new CodedError('FORBIDDEN', 'Working directory access denied')
      }
    }
    // Capture the caller's clientId for error routing
    const callerClientId = ctx.clientId
    const cloudCaller = ctx.principal ? { issuer: ctx.principal.issuer, subject: ctx.principal.subject } : LOCAL_ROX_CALLER
    const roxExecutionContext = await peekRoxAccountAuthority()?.capture(cloudCaller)
    // Native options were stripped above. Invalid producer telemetry cannot turn
    // a generated dispatch into the exception for the user's original input.
    const runtimeLaunch = options?.runtimeLaunch === undefined ? undefined
      : isRuntimeLaunch(options.runtimeLaunch) ? options.runtimeLaunch : { kind: 'unknown' as const }

    return await new Promise<{ accepted: true; messageId: string }>((resolve, reject) => {
      let acked = false
      const onAck = (messageId: string) => {
        if (!acked) {
          acked = true
          if (ctx.principal && server.isRequestContextCurrent?.(ctx, 'write')) {
            nativeTurnOrigins.set(originKey(sessionId, messageId), { context: ctx, sessionId, messageId })
            // Bound abandoned/erroring requests even if a backend never emits completion.
            if (nativeTurnOrigins.size > 4096) nativeTurnOrigins.delete(nativeTurnOrigins.keys().next().value!)
          }
          resolve({ accepted: true, messageId })
        }
      }

      sessionManager
        .sendMessage(sessionId, message, attachments, storedAttachments, options, undefined, undefined, onAck, { callerClientId, roxExecutionContext, runtimeLaunch,
          nativeMemoryContext: nativeMemoryContext(ctx, deps, server, ctx.workspaceId!) })
        .then(() => {
          // sendMessage finished without firing onAck — should not happen in
          // practice (every code path that creates a user message acks).
          // Treat as a defensive failure rather than silently dropping.
          if (!acked) {
            acked = true
            reject(new Error('sendMessage completed without persisting a user message'))
          }
        })
        .catch(err => {
          log.error('Error in sendMessage:', err)
          if (!acked) {
            // Pre-persist error — surface synchronously to the caller.
            acked = true
            reject(err)
            return
          }
          // Post-persist error — route via the event stream as today.
          pushTyped(server, RPC_CHANNELS.sessions.EVENT, { to: 'client', clientId: callerClientId }, {
            type: 'error',
            sessionId,
            error: err instanceof Error ? err.message : 'Unknown error'
          } as SessionEvent)
          pushTyped(server, RPC_CHANNELS.sessions.EVENT, { to: 'client', clientId: callerClientId }, {
            type: 'complete',
            sessionId
          } as SessionEvent)
        })
    })
  }, { nativeAction: 'write' })

  // Cancel processing
  server.handle(RPC_CHANNELS.sessions.CANCEL, async (ctx, sessionId: string, silent?: boolean) => {
    assertNativeSession(ctx, deps, server, sessionId)
    return sessionManager.cancelProcessing(sessionId, silent)
  }, { nativeAction: 'write' })

  // Kill background shell
  server.handle(RPC_CHANNELS.sessions.KILL_SHELL, async (_ctx, sessionId: string, shellId: string) => {
    return sessionManager.killShell(sessionId, shellId)
  })

  // Get background task output
  server.handle(RPC_CHANNELS.tasks.GET_OUTPUT, async (_ctx, taskId: string) => {
    try {
      const output = await sessionManager.getTaskOutput(taskId)
      return output
    } catch (err) {
      log.error('Failed to get task output:', err)
      throw err
    }
  })

  // Respond to a permission request (bash command approval)
  // Returns true if the response was delivered, false if agent/session is gone
  server.handle(RPC_CHANNELS.sessions.RESPOND_TO_PERMISSION, async (_ctx, sessionId: string, requestId: string, allowed: boolean, alwaysAllow: boolean) => {
    return sessionManager.respondToPermission(sessionId, requestId, allowed, alwaysAllow)
  })

  // Respond to a credential request (secure auth input)
  // Returns true if the response was delivered, false if agent/session is gone
  server.handle(RPC_CHANNELS.sessions.RESPOND_TO_CREDENTIAL, async (_ctx, sessionId: string, requestId: string, response: import('@rox/shared/protocol').CredentialResponse) => {
    return sessionManager.respondToCredential(sessionId, requestId, response)
  })

  // ==========================================================================
  // Consolidated Command Handlers
  // ==========================================================================

  // Session commands - consolidated handler for session operations
  server.handle(RPC_CHANNELS.sessions.COMMAND, async (
    ctx,
    sessionId: string,
    command: import('@rox/shared/protocol').SessionCommand
  ) => {
    if (ctx.principal) {
      if (command?.type === 'joinBroInvite') {
        const target = parseInviteUrl(command.url)
        if (!target) return { ok: false, error: 'invalid' }
        // Join follows the invitation target, independently of the caller's open page.
        sessionId = target.sessionId
      }
      assertNativeSession(ctx, deps, server, sessionId)
      if (NATIVE_SHARING_COMMANDS.has(command?.type)) {
        const workspace = getWorkspaceByNameOrId(ctx.workspaceId!)
        const assertCurrent = () => {
          assertNativeSession(ctx, deps, server, sessionId)
          const currentWorkspace = getWorkspaceByNameOrId(ctx.workspaceId!)
          if (!workspace || currentWorkspace?.rootPath !== workspace.rootPath ||
            !deps.nativeData?.authority.authorize(ctx.principal!, ctx.workspaceId!, 'write', workspace.rootPath) ||
            !server.isRequestContextCurrent?.(ctx, 'write')) throw new CodedError('FORBIDDEN', 'Workspace write access denied')
        }
        assertCurrent()
        const session = await sessionManager.getSession(sessionId)
        assertCurrent()
        if (!session || session.workspaceId !== ctx.workspaceId) throw new CodedError('FORBIDDEN', 'Session access denied')
        const displayName = deps.nativeData!.authority.getSelfProfile(ctx.principal, ctx.workspaceId!).name ?? ''
        return getNativeSessionCollaboration(server, deps.nativeData!.authority).command({
          issuer: ctx.principal.issuer, subject: ctx.principal.subject,
          workspaceId: ctx.workspaceId!, workspaceRootPath: workspace!.rootPath, sessionId,
        }, command, session, assertCurrent, log, displayName)
      }
      const allowed = new Set(['addAnnotation', 'removeAnnotation', 'updateAnnotation', 'flag', 'unflag', 'archive', 'unarchive', 'rename', 'markRead', 'markUnread', 'setActiveViewing', 'setSessionStatus', 'setPermissionMode'])
      if (!allowed.has(command?.type)) throw new CodedError('FORBIDDEN', 'Native session command denied')
      if (command.type === 'setActiveViewing' && command.workspaceId !== ctx.workspaceId) throw new CodedError('FORBIDDEN', 'Workspace access denied')
      if (command.type === 'addAnnotation' || command.type === 'removeAnnotation' || command.type === 'updateAnnotation') {
        const messageId = command.messageId
        const session = await sessionManager.getSession(sessionId)
        assertNativeSession(ctx, deps, server, sessionId)
        const message = session?.messages.find(message => message.id === messageId)
        if (!message || (message.role !== 'user' && message.role !== 'assistant')) throw new CodedError('FORBIDDEN', 'Message access denied')
        if (command.type === 'addAnnotation') {
          if (command.annotation?.target?.source?.sessionId !== sessionId || command.annotation.target.source.messageId !== command.messageId) throw new CodedError('FORBIDDEN', 'Annotation target denied')
          command = { ...command, annotation: { ...nativeAnnotation(command.annotation), createdBy: { id: ctx.principal.subject, type: 'user' } } }
        } else {
          const annotationId = command.annotationId
          const annotation = message.annotations?.find(annotation => annotation.id === annotationId)
          if (!annotation || annotation.createdBy?.id !== ctx.principal.subject) throw new CodedError('FORBIDDEN', 'Annotation author denied')
          if (command.type === 'updateAnnotation') command = { ...command, patch: Object.fromEntries(
            Object.entries({ body: command.patch.body, style: command.patch.style, intent: command.patch.intent, status: command.patch.status })
              .filter(([, value]) => value !== undefined),
          ) }
        }
      }
    }
    switch (command.type) {
      case 'flag':
        return sessionManager.flagSession(sessionId)
      case 'unflag':
        return sessionManager.unflagSession(sessionId)
      case 'archive':
        return sessionManager.archiveSession(sessionId)
      case 'unarchive':
        return sessionManager.unarchiveSession(sessionId)
      case 'rename':
        return sessionManager.renameSession(sessionId, command.name)
      case 'setSessionStatus':
        return sessionManager.setSessionStatus(sessionId, command.state)
      case 'markRead':
        return sessionManager.markSessionRead(sessionId)
      case 'markUnread':
        return sessionManager.markSessionUnread(sessionId)
      case 'setActiveViewing':
        // Track which session user is actively viewing (for unread state machine)
        return sessionManager.setActiveViewingSession(sessionId, command.workspaceId)
      case 'setPermissionMode':
        if (ctx.principal) {
          if (!['safe', 'ask', 'allow-all'].includes(command.mode)) throw new CodedError('FORBIDDEN', 'Invalid permission mode')
          assertNativeSession(ctx, deps, server, sessionId)
          if (!server.isRequestContextCurrent?.(ctx, 'write')) throw new CodedError('AUTH_FAILED', 'Workspace permission changed')
        }
        return sessionManager.setSessionPermissionMode(sessionId, command.mode)
      case 'setThinkingLevel':
        // Validate thinking level before passing to session manager
        if (!isValidThinkingLevel(command.level)) {
          throw new Error(`Invalid thinking level: ${command.level}. Valid values: ${VALID_THINKING_LEVELS_LIST}`)
        }
        return sessionManager.setSessionThinkingLevel(sessionId, command.level)
      case 'updateWorkingDirectory':
        return sessionManager.updateWorkingDirectory(sessionId, command.dir)
      case 'setSources':
        return sessionManager.setSessionSources(sessionId, command.sourceSlugs)
      case 'setLabels':
        return sessionManager.setSessionLabels(sessionId, command.labels)
      case 'setProjectId':
        return sessionManager.setSessionProjectId(sessionId, command.projectId)
      case 'setKanbanColumn':
        return sessionManager.setKanbanColumn(sessionId, command.column)
      case 'setPriority':
        return sessionManager.setPriority(sessionId, command.priority)
      case 'setDueDate':
        return sessionManager.setDueDate(sessionId, command.dueDate)
      case 'setRank':
        return sessionManager.setRank(sessionId, command.rank)
      case 'reorderRank':
        return sessionManager.reorderRank(sessionId, command.prevId, command.nextId)
      case 'showInFinder': {
        const sessionPath = sessionManager.getSessionPath(sessionId)
        if (sessionPath) {
          deps.platform.showItemInFolder?.(sessionPath)
        }
        return
      }
      case 'copyPath': {
        // Return the session folder path for copying to clipboard
        const sessionPath = sessionManager.getSessionPath(sessionId)
        return sessionPath ? { success: true, path: sessionPath } : { success: false }
      }
      case 'shareToViewer':
        return sessionManager.shareToViewer(sessionId)
      case 'updateShare':
        return sessionManager.updateShare(sessionId)
      case 'revokeShare':
        return sessionManager.revokeShare(sessionId)
      case 'inviteBro': {
        const session = await sessionManager.getSession(sessionId)
        if (!session) {
          return { success: false, error: 'invalid', errorCode: 'invalid' }
        }
        const invited = await getBroInviteService().invite(sessionId, command.role, { workspaceId: session.workspaceId, session, caller: ctx.principal ? { issuer: ctx.principal.issuer, subject: ctx.principal.subject } : LOCAL_ROX_CALLER })
        if (!invited.success) {
          return {
            success: false,
            error: invited.error,
            errorCode: invited.errorCode,
          }
        }
        return {
          success: true,
          url: invited.card.url,
          qrPayload: invited.card.qrPayload,
          contactShareText: invited.card.contactShareText,
          expiresAt: invited.card.expiresAt,
          role: invited.card.role,
        }
      }
      case 'revokeBroInvite':
        return getBroInviteService().revoke(command.joinKey, ctx.workspaceId, ctx.principal ? { issuer: ctx.principal.issuer, subject: ctx.principal.subject } : LOCAL_ROX_CALLER)
      case 'joinBroInvite': {
        const parsed = parseInviteUrl(command.url)
        if (!parsed) return { ok: false, error: 'invalid' }
        const service = getBroInviteService()
        if (service.usesRemote(ctx.workspaceId)) return service.join(command.url, ctx.workspaceId, ctx.principal ? { issuer: ctx.principal.issuer, subject: ctx.principal.subject } : LOCAL_ROX_CALLER)
        // An invite must not be consumed if its session has been deleted.
        // Resolve the target from the URL, independently of the caller's page.
        const targetSession = await sessionManager.getSession(parsed.sessionId)
        if (!targetSession) return { ok: false, error: 'invalid' }
        const joined = await service.join(command.url, undefined, ctx.principal ? { issuer: ctx.principal.issuer, subject: ctx.principal.subject } : LOCAL_ROX_CALLER)
        return joined.ok ? { ...joined, workspaceId: targetSession.workspaceId } : joined
      }
      case 'listBroPresence':
        return getBroInviteService().listPresence(sessionId, (await sessionManager.getSession(sessionId))?.workspaceId ?? ctx.workspaceId)
      case 'refreshTitle':
        log.info(`IPC: refreshTitle received for session ${sessionId}`)
        return sessionManager.refreshTitle(sessionId, await peekRoxAccountAuthority()?.capture(ctx.principal ? { issuer: ctx.principal.issuer, subject: ctx.principal.subject } : LOCAL_ROX_CALLER))
      case 'improveDraft':
        log.info(`IPC: improveDraft received for session ${sessionId}`)
        return sessionManager.improveDraft(sessionId, command.text, await peekRoxAccountAuthority()?.capture(ctx.principal ? { issuer: ctx.principal.issuer, subject: ctx.principal.subject } : LOCAL_ROX_CALLER))
      // Connection selection (locked after first message)
      case 'setConnection':
        log.info(`IPC: setConnection received for session ${sessionId}, connection: ${command.connectionSlug}`)
        return sessionManager.setSessionConnection(sessionId, command.connectionSlug)
      // Pending plan execution (Accept & Compact flow)
      case 'setPendingPlanExecution':
        return sessionManager.setPendingPlanExecution(sessionId, command.planPath, command.draftInputSnapshot)
      case 'markCompactionComplete':
        return sessionManager.markCompactionComplete(sessionId)
      case 'markPendingPlanExecutionDispatched':
        return sessionManager.markPendingPlanExecutionDispatched(sessionId)
      case 'clearPendingPlanExecution':
        return sessionManager.clearPendingPlanExecution(sessionId)
      case 'addAnnotation':
        return sessionManager.addMessageAnnotation(sessionId, command.messageId, command.annotation)
      case 'removeAnnotation':
        return sessionManager.removeMessageAnnotation(sessionId, command.messageId, command.annotationId)
      case 'updateAnnotation':
        return sessionManager.updateMessageAnnotation(sessionId, command.messageId, command.annotationId, command.patch)
      case 'undo':
        return sessionManager.undoLastUserMessage(sessionId)
      default: {
        const _exhaustive: never = command
        throw new Error(`Unknown session command: ${JSON.stringify(command)}`)
      }
    }
  }, { nativeAction: 'write' })

  // B4: one caller-authorized, per-target atomic collection update.
  server.handle(RPC_CHANNELS.sessions.BULK_UPDATE, async (
    ctx,
    input: BulkUpdateSessionsInput,
  ): Promise<BulkUpdateSessionsResult> => {
    const callerWorkspaceId = ctx.workspaceId ?? (
      ctx.webContentsId === null
        ? undefined
        : deps.windowManager?.getWorkspaceForWindow(ctx.webContentsId)
    )
    if (!callerWorkspaceId) {
      throw new Error('bulk_workspace_context_required')
    }

    assertValidBulkUpdateInput(input)
    if (input.workspaceId !== callerWorkspaceId) {
      throw new Error('bulk_workspace_mismatch')
    }
    assertValidBulkUpdatePatch(input.patch)
    if (input.ids.length === 0) {
      return { ok: [], failed: [] }
    }

    await sessionManager.waitForInit()
    const result = await sessionManager.bulkUpdateSessions(
      callerWorkspaceId,
      { ids: input.ids, patch: input.patch },
    )

    if (result.ok.length > 0) {
      pushTyped(
        server,
        RPC_CHANNELS.sessions.BULK_CHANGED,
        { to: 'workspace', workspaceId: callerWorkspaceId },
        { workspaceId: callerWorkspaceId, ids: result.ok, patch: input.patch },
      )
    }

    return result
  })

  // Read and update the caller's workspace-scoped agent budget.
  server.handle(RPC_CHANNELS.sessions.GET_BUDGET, async (ctx, workspaceId: string) => {
    const callerWorkspaceId = ctx.workspaceId ?? (
      ctx.webContentsId === null
        ? undefined
        : deps.windowManager?.getWorkspaceForWindow(ctx.webContentsId) ?? undefined
    )
    if (!workspaceId || callerWorkspaceId !== workspaceId) {
      throw new CodedError('AUTH_FAILED', 'Workspace access denied')
    }
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new CodedError('NOT_FOUND', `Workspace not found: ${workspaceId}`)
    return sessionManager.getAgentBudget(workspace.id)
  }, { nativeAction: 'read' })

  server.handle(RPC_CHANNELS.sessions.SET_BUDGET, async (
    ctx,
    workspaceId: string,
    input: { limitUsd: number | null },
  ) => {
    const callerWorkspaceId = ctx.workspaceId ?? (
      ctx.webContentsId === null
        ? undefined
        : deps.windowManager?.getWorkspaceForWindow(ctx.webContentsId) ?? undefined
    )
    if (!workspaceId || callerWorkspaceId !== workspaceId) {
      throw new CodedError('AUTH_FAILED', 'Workspace access denied')
    }
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new CodedError('NOT_FOUND', `Workspace not found: ${workspaceId}`)
    if (!input || (input.limitUsd !== null && (
      typeof input.limitUsd !== 'number' || !Number.isFinite(input.limitUsd) || input.limitUsd <= 0
    ))) {
      throw new CodedError('HANDLER_ERROR', 'Budget limit must be a positive finite number or null')
    }
    return sessionManager.setAgentDailyBudget(workspace.id, input.limitUsd)
  }, { nativeAction: 'write' })

  // Get pending plan execution state (for reload recovery)
  server.handle(RPC_CHANNELS.sessions.GET_PENDING_PLAN_EXECUTION, async (
    _ctx,
    sessionId: string
  ) => {
    return sessionManager.getPendingPlanExecution(sessionId)
  })

  // Get authoritative permission mode diagnostics for renderer reconciliation
  server.handle(RPC_CHANNELS.sessions.GET_PERMISSION_MODE_STATE, async (
    _ctx,
    sessionId: string
  ) => {
    return sessionManager.getSessionPermissionModeState(sessionId)
  })

  // Set the self-learning memory mode for a session (spec F3).
  // Persists to the session header and broadcasts session_metadata_changed.
  server.handle(RPC_CHANNELS.sessions.SET_MEMORY_MODE, async (
    _ctx,
    sessionId: string,
    mode: SessionMemoryMode
  ) => {
    return sessionManager.setSessionMemoryMode(sessionId, mode)
  })

  // Memory provenance (spec F4): lessons/skills injected into the session's
  // prompts. Null for unknown sessions or sessions with no provenance record.
  server.handle(RPC_CHANNELS.sessions.GET_PROVENANCE, async (
    _ctx,
    sessionId: string
  ) => {
    return sessionManager.getSessionProvenance(sessionId)
  })

  // ============================================================
  // Session Content Search
  // ============================================================

  // Search session content using ripgrep
  server.handle(RPC_CHANNELS.sessions.SEARCH_CONTENT, async (ctx, workspaceId: string, query: string, searchId?: string) => {
    const id = searchId || Date.now().toString(36)
    log.info('[search]','ipc:request', { searchId: id, queryLength: query.length })

    const callerWorkspaceId = ctx.workspaceId ?? (
      ctx.webContentsId === null
        ? undefined
        : deps.windowManager?.getWorkspaceForWindow(ctx.webContentsId) ?? undefined
    )
    const workspace = callerWorkspaceId ? getWorkspaceByNameOrId(callerWorkspaceId) : undefined
    const requestedWorkspace = getWorkspaceByNameOrId(workspaceId)
    if (
      !ctx.principal
      || !workspace
      || !requestedWorkspace
      || workspace.id !== requestedWorkspace.id
    ) {
      throw new Error('Workspace access denied')
    }

    await sessionManager.waitForInit()
    const visibleSessions = sessionManager.getSessions(workspace.id).filter((session) => !session.hidden)
    const allowedSessionIds = visibleSessions.map((session) => session.id)

    const { searchSessions } = await import('@rox/server-core/services')
    const { getWorkspaceSessionsPath } = await import('@rox/shared/workspaces')
    const sessionsDir = getWorkspaceSessionsPath(workspace.rootPath)
    log.debug('SEARCH_SESSIONS: Searching workspace content', { searchId: id, queryLength: query.length })

    const results = await searchSessions(query, sessionsDir, {
      timeout: 5000,
      maxMatchesPerSession: 3,
      maxSessions: 50,
      searchId: id,
      allowedSessionIds,
    })

    const stillVisibleIds = new Set(
      sessionManager.getSessions(workspace.id)
        .filter((session) => !session.hidden)
        .map((session) => session.id),
    )
    const visibleResults = results.filter((result) => stillVisibleIds.has(result.sessionId))
    log.info('[search]','ipc:response', { searchId: id, resultCount: visibleResults.length, totalFound: visibleResults.length })
    return visibleResults
  }, { nativeAction: 'read' })

  // ============================================================
  // Session Info Panel (files, notes, file watching)
  // ============================================================

  // Get files in session directory (recursive tree structure)
  server.handle(RPC_CHANNELS.sessions.GET_FILES, async (_ctx, sessionId: string) => {
    const sessionPath = sessionManager.getSessionPath(sessionId)
    if (!sessionPath) return []

    try {
      return await scanSessionDirectory(sessionPath)
    } catch (error) {
      log.error('Failed to get session files:', error)
      return []
    }
  })

  // Start watching a session directory for file changes (per client)
  server.handle(RPC_CHANNELS.sessions.WATCH_FILES, async (ctx, sessionId: string) => {
    const clientId = ctx.clientId
    cleanupSessionFileWatchForClient(clientId)

    const sessionPath = sessionManager.getSessionPath(sessionId)
    if (!sessionPath) return

    try {
      const { watch } = await import('fs')

      const state: ClientSessionWatchState = {
        watcher: null as unknown as import('fs').FSWatcher,
        sessionId,
        debounceTimer: null,
      }

      state.watcher = watch(sessionPath, { recursive: true }, (_eventType, filename) => {
        if (clientSessionWatches.get(clientId) !== state) return

        // Ignore internal files and hidden path segments.
        const changedPath = filename == null ? '' : String(filename)
        const pathSegments = changedPath.split(/[\\/]/)
        if (pathSegments.some((segment) => segment === 'session.jsonl' || segment.startsWith('.'))) {
          return
        }

        // Debounce: wait 100ms before notifying to batch rapid changes
        if (state.debounceTimer) {
          clearTimeout(state.debounceTimer)
        }

        state.debounceTimer = setTimeout(() => {
          if (clientSessionWatches.get(clientId) !== state) return
          pushTyped(server, RPC_CHANNELS.sessions.FILES_CHANGED, { to: 'client', clientId }, state.sessionId)
        }, 100)
      })

      clientSessionWatches.set(clientId, state)
    } catch (error) {
      log.error('Failed to start session file watcher:', error)
    }
  })

  // Stop watching session files for the calling client
  server.handle(RPC_CHANNELS.sessions.UNWATCH_FILES, async (ctx) => {
    cleanupSessionFileWatchForClient(ctx.clientId)
  })

  // Get session notes (reads notes.md from session directory)
  server.handle(RPC_CHANNELS.sessions.GET_NOTES, async (_ctx, sessionId: string) => {
    const sessionPath = sessionManager.getSessionPath(sessionId)
    if (!sessionPath) return ''

    try {
      const notesPath = join(sessionPath, 'notes.md')
      const content = await readFile(notesPath, 'utf-8')
      return content
    } catch {
      // File doesn't exist yet - return empty string
      return ''
    }
  })

  // Set session notes (writes to notes.md in session directory)
  server.handle(RPC_CHANNELS.sessions.SET_NOTES, async (_ctx, sessionId: string, content: string) => {
    const sessionPath = sessionManager.getSessionPath(sessionId)
    if (!sessionPath) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    try {
      const notesPath = join(sessionPath, 'notes.md')
      await writeFile(notesPath, content, 'utf-8')
    } catch (error) {
      log.error('Failed to save session notes:', error)
      throw error
    }
  })

  // ============================================
  // Export / Import / Dispatch
  // ============================================

  // Export a session as a portable bundle
  server.handle(RPC_CHANNELS.sessions.EXPORT, async (ctx, sessionId: string) => {
    await sessionManager.waitForInit()
    const workspaceId = ctx.workspaceId ?? deps.windowManager?.getWorkspaceForWindow(ctx.webContentsId!)
    if (!workspaceId) throw new Error('No workspace context')

    const bundle = await sessionManager.exportSession(sessionId, workspaceId)
    if (!bundle) throw new Error(`Failed to export session ${sessionId}`)
    return bundle
  })

  // Import a session bundle into a target workspace
  // targetWorkspaceId is passed explicitly (not from context) so the renderer
  // can import into any workspace the server manages, not just the active one.
  const importHandler = async (_ctx: any, targetWorkspaceId: string, bundle: unknown, mode: string) => {
    await sessionManager.waitForInit()
    if (!targetWorkspaceId || typeof targetWorkspaceId !== 'string') throw new Error('targetWorkspaceId is required')
    if (mode !== 'move' && mode !== 'fork') throw new Error(`Invalid dispatch mode: ${mode}`)

    return sessionManager.importSession(targetWorkspaceId, bundle as import('@rox/shared/sessions').SessionBundle, mode)
  }
  server.handle(RPC_CHANNELS.sessions.IMPORT, importHandler)
  // Also register as transferable so chunked transfer can invoke it on commit
  setTransferableHandler(RPC_CHANNELS.sessions.IMPORT, importHandler)

  // Export a session as a summarized remote-transfer payload.
  server.handle(RPC_CHANNELS.sessions.EXPORT_REMOTE_TRANSFER, async (ctx, sessionId: string) => {
    await sessionManager.waitForInit()
    const workspaceId = ctx.workspaceId ?? deps.windowManager?.getWorkspaceForWindow(ctx.webContentsId!)
    if (!workspaceId) throw new Error('No workspace context')

    const payload = await sessionManager.exportRemoteSessionTransfer(sessionId, workspaceId)
    if (!payload) throw new Error(`Failed to export remote transfer for session ${sessionId}`)
    return payload
  })

  // Import a summarized remote-transfer payload into a target workspace.
  server.handle(RPC_CHANNELS.sessions.IMPORT_REMOTE_TRANSFER, async (_ctx, targetWorkspaceId: string, payload: import('@rox/shared/protocol').RemoteSessionTransferPayload) => {
    await sessionManager.waitForInit()
    if (!targetWorkspaceId || typeof targetWorkspaceId !== 'string') throw new Error('targetWorkspaceId is required')
    return sessionManager.importRemoteSessionTransfer(targetWorkspaceId, payload)
  })
}
