/**
 * ISessionManager — abstract interface for the session lifecycle engine.
 *
 * Handler code in server-core programs against this interface;
 * concrete implementations (Electron SessionManager, headless, etc.)
 * satisfy it at runtime.
 */

import type { Workspace, WorkspaceInfo, ActiveSessionInfo } from '@rox/core/types'
import type { StoredAttachment, AnnotationV1 } from '@rox/core/types'
import type { PermissionMode } from '@rox/shared/agent/mode-types'
import type { ThinkingLevel } from '@rox/shared/agent/thinking-levels'
import type { AuthResult } from '@rox/shared/agent'
import type {
  Session,
  SessionStatus,
  SessionPriority,
  CreateSessionOptions,
  FileAttachment,
  SendMessageOptions,
  PermissionResponseOptions,
  CredentialResponse,
  PermissionModeState,
  UnreadSummary,
  ShareResult,
  BulkUpdateSessionsInput,
  BulkUpdateSessionsResult,
} from '@rox/shared/protocol'
import type { SessionBundle, DispatchMode } from '@rox/shared/sessions'
import type { SessionProvenance } from '@rox/shared/memory/types'
import type { AgentBudgetSnapshot } from '@rox/shared/agent'
import type { EventSink } from '../transport'

export interface NativeMemoryContext {
  owner: { issuer: string; subject: string }
  assertAuthorized: () => void
}

export interface ISessionManager {
  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  waitForInit(): Promise<void>
  initialize(): Promise<void>
  cleanup(): void
  setEventSink(sink: EventSink): void
  setNativeMemoryContextPolicy?(required: (workspaceId: string) => boolean): void
  flushAllSessions(): Promise<void>

  // ---------------------------------------------------------------------------
  // Session CRUD
  // ---------------------------------------------------------------------------

  getAgentBudget(workspaceId: string, now?: number): AgentBudgetSnapshot
  setAgentDailyBudget(workspaceId: string, limitUsd: number | null): AgentBudgetSnapshot

  getSessions(workspaceId?: string): Session[]
  getSession(sessionId: string): Promise<Session | null>
  /** Persist a one-time assistant welcome for a fresh installation. Never starts the model. */
  ensureFirstSessionWelcome(workspaceId: string): Promise<Session | null>
  /** Creates a session and (unless `internal.emitCreatedEvent === false`) announces it to the
   *  renderer so it hydrates full metadata instead of fabricating a "New Chat" placeholder. */
  createSession(
    workspaceId: string,
    options?: CreateSessionOptions,
    internal?: { emitCreatedEvent?: boolean; nativeMemoryContext?: NativeMemoryContext },
  ): Promise<Session>
  /** Resolved working directory of a live session (Tasks Conductor uses it so children inherit
   *  the orchestrator's cwd). */
  getSessionWorkingDirectory(sessionId: string): string | undefined
  deleteSession(sessionId: string): Promise<void>
  /** Load one imported session from disk if missing. Must not replace a live session. */
  ingestImportedSession(workspaceId: string, sessionId: string): void
  notifySessionCreated(workspaceId: string, sessionId: string): void

  // ---------------------------------------------------------------------------
  // Session state
  // ---------------------------------------------------------------------------

  flagSession(sessionId: string): Promise<void>
  unflagSession(sessionId: string): Promise<void>
  archiveSession(sessionId: string): Promise<void>
  unarchiveSession(sessionId: string): Promise<void>
  renameSession(sessionId: string, name: string): Promise<void>
  setSessionStatus(sessionId: string, status: SessionStatus): Promise<void>
  markSessionRead(sessionId: string): Promise<void>
  markSessionUnread(sessionId: string): Promise<void>
  markAllSessionsRead(workspaceId: string): Promise<void>
  setActiveViewingSession(sessionId: string | null, workspaceId: string): void
  bulkUpdateSessions(
    workspaceId: string,
    input: Pick<BulkUpdateSessionsInput, 'ids' | 'patch'>,
  ): Promise<BulkUpdateSessionsResult>
  clearActiveViewingSession(workspaceId: string): void

  // ---------------------------------------------------------------------------
  // Session configuration
  // ---------------------------------------------------------------------------

  setSessionPermissionMode(sessionId: string, mode: PermissionMode): void
  setSessionThinkingLevel(sessionId: string, level: ThinkingLevel): void
  updateWorkingDirectory(sessionId: string, path: string): void
  setSessionSources(sessionId: string, sourceSlugs: string[]): Promise<void>
  setSessionLabels(sessionId: string, labels: string[]): void
  /** Apply the reserved Task labeling (mint / inherit the per-task item label under the Task
   *  root). Returns the resolved ITEM label id, or undefined if the session is unknown.
   *  See SessionManager.applyTaskLabel. */
  applyTaskLabel(
    sessionId: string,
    opts?: { parentSessionId?: string },
  ): Promise<{ labelId: string } | undefined>
  setSessionProjectId(sessionId: string, projectId: string | null): Promise<void>
  /** Optional owner port; metadata only, never project permission. */
  unlinkProjectFromSessions?(workspaceId: string, projectId: string): Promise<number>
  setKanbanColumn(sessionId: string, column: string | null): Promise<void>
  setPriority(sessionId: string, priority: SessionPriority): Promise<void>
  setDueDate(sessionId: string, dueDate: number | null): Promise<void>
  setRank(sessionId: string, rank: string): Promise<void>
  reorderRank(sessionId: string, prevId?: string, nextId?: string): Promise<void>
  setTaskNodeCount(sessionId: string, count: number): Promise<void>
  setSessionMemoryMode(sessionId: string, mode: import('@rox/core/types').SessionMemoryMode): Promise<void>
  adoptGeneratedTaskOrchestrator(
    sessionId: string,
    taskSlug: string,
    reconcile?: { name?: string; projectId?: string; workingDirectory?: string; model?: string; llmConnection?: string; permissionMode?: PermissionMode },
  ): Promise<boolean>
  bindExistingSessionToTask(
    sessionId: string,
    taskSlug: string,
    reconcile?: { name?: string; projectId?: string; workingDirectory?: string; model?: string; llmConnection?: string; permissionMode?: PermissionMode },
  ): Promise<boolean>
  setSessionConnection(sessionId: string, connectionSlug: string): Promise<void>
  updateSessionModel(sessionId: string, workspaceId: string, model: string | null, connection?: string): Promise<void>

  // ---------------------------------------------------------------------------
  // Messaging
  // ---------------------------------------------------------------------------

  sendMessage(
    sessionId: string,
    message: string,
    attachments?: FileAttachment[],
    storedAttachments?: StoredAttachment[],
    options?: SendMessageOptions,
    existingMessageId?: string,
    _isAuthRetry?: boolean,
    onAck?: (messageId: string) => void,
    rpcContext?: { callerClientId?: string; nativeMemoryContext?: NativeMemoryContext },
    _internalRetryKind?: 'auth' | 'failover',
  ): Promise<void>
  cancelProcessing(sessionId: string, silent?: boolean): Promise<void>
  killShell(sessionId: string, shellId: string): Promise<{ success: boolean; error?: string }>
  getTaskOutput(taskId: string): Promise<string | null>

  // --- Tasks Conductor seams (in-process; not renderer events, not agent-facing) ---
  /**
   * Subscribe to the in-process session-completion signal. Fires once per turn
   * when the session's message queue drains (true completion), carrying the stop
   * reason. Returns an unsubscribe function.
   */
  onSessionComplete(
    listener: (evt: import('../sessions/SessionManager').SessionCompletionEvent) => void,
  ): () => void
  /** Server composition decides whether a workspace completion belongs to its legacy host profile. */
  setLegacyCompletionXpPolicy?(policy: (evt: import('../sessions/SessionManager').SessionCompletionEvent) => boolean): () => void
  /** Read a session's final assistant message text (Conductor output reader). */
  getSessionFinalText(sessionId: string): string | undefined
  undoLastUserMessage(sessionId: string): Promise<{ success: boolean; userMessage?: string }>
  addMessageAnnotation(sessionId: string, messageId: string, annotation: AnnotationV1): void
  removeMessageAnnotation(sessionId: string, messageId: string, annotationId: string): void
  updateMessageAnnotation(
    sessionId: string,
    messageId: string,
    annotationId: string,
    patch: Partial<AnnotationV1>,
  ): void

  // ---------------------------------------------------------------------------
  // Permissions & credentials
  // ---------------------------------------------------------------------------

  respondToPermission(
    sessionId: string,
    requestId: string,
    allowed: boolean,
    alwaysAllow: boolean,
    options?: PermissionResponseOptions,
  ): boolean
  respondToCredential(sessionId: string, requestId: string, response: CredentialResponse): Promise<boolean>
  getSessionPermissionModeState(sessionId: string): PermissionModeState | null

  // ---------------------------------------------------------------------------
  // Plans
  // ---------------------------------------------------------------------------

  setPendingPlanExecution(sessionId: string, planPath: string, draftInputSnapshot?: string): Promise<void>
  markPendingPlanExecutionDispatched(sessionId: string): Promise<void>
  clearPendingPlanExecution(sessionId: string): Promise<void>
  getPendingPlanExecution(sessionId: string): { planPath: string; draftInputSnapshot?: string; awaitingCompaction: boolean; executionDispatched: boolean } | null
  markCompactionComplete(sessionId: string): Promise<void>

  /**
   * Send the plan-approval "I approve this plan, please execute it" message
   * to the session as if the user had clicked "Accept plan" in the desktop UI.
   * If the session is in Explore (safe) mode, also switches it to allow-all
   * so the plan can actually run without per-tool prompts.
   *
   * Used by the messaging gateway so Telegram/WhatsApp accept buttons produce
   * the same server-side effect as the desktop accept button.
   */
  acceptPlan(sessionId: string, planPath?: string): Promise<void>

  // ---------------------------------------------------------------------------
  // Sharing
  // ---------------------------------------------------------------------------

  shareToViewer(sessionId: string): Promise<ShareResult>
  updateShare(sessionId: string): Promise<ShareResult>
  revokeShare(sessionId: string): Promise<ShareResult>

  // ---------------------------------------------------------------------------
  // Export / Import
  // ---------------------------------------------------------------------------

  /**
   * Export a session as a portable bundle.
   * Flushes pending writes, serializes session data + files.
   * Session must be stopped before export.
   */
  exportSession(sessionId: string, workspaceId: string): Promise<SessionBundle | null>

  /**
   * Export a session as a summary-based payload for cross-server transfer.
   * Generates a mini-model summary instead of shipping the full transcript.
   */
  exportRemoteSessionTransfer(
    sessionId: string,
    workspaceId: string,
  ): Promise<import('@rox/shared/protocol').RemoteSessionTransferPayload | null>

  /**
   * Import a session bundle into a target workspace.
   * Creates session directory, writes JSONL + files, registers in memory.
   * Returns the new session ID and any compatibility warnings.
   */
  importSession(
    workspaceId: string,
    bundle: SessionBundle,
    mode: DispatchMode,
  ): Promise<{ sessionId: string; warnings?: string[] }>

  /**
   * Import a summary-based remote transfer payload into a target workspace.
   */
  importRemoteSessionTransfer(
    workspaceId: string,
    payload: import('@rox/shared/protocol').RemoteSessionTransferPayload,
  ): Promise<import('@rox/shared/protocol').ImportRemoteSessionTransferResult>

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------

  getSessionPath(sessionId: string): string | null
  /** Memory provenance (spec F4): lessons/skills injected into the session's prompts; null when absent. */
  getSessionProvenance(sessionId: string): SessionProvenance | null
  /** One-shot mini completion against the workspace's default connection (self-learning
   *  spec L2 conflict checks). Resolves the workspace by id — throws when unknown. */
  runDistillOneShot(workspaceId: string, prompt: string): Promise<string>
  refreshTitle(sessionId: string): Promise<{ success: boolean; title?: string; error?: string }>
  improveDraft(sessionId: string, text: string): Promise<{ success: boolean; text?: string; error?: string }>
  /** Connection/model a sessionless one-shot on this workspace would use (Project screen AI). */
  describeWorkspaceLlm?(workspaceId: string): { available: boolean; connectionName?: string; model?: string; reason?: string }
  /** Sessionless one-shot on the workspace's default connection/model; throws the real provider error. */
  queryWorkspaceLlm?(
    workspaceId: string,
    request: { prompt: string; systemPrompt?: string; maxTokens?: number; temperature?: number },
    options?: { timeoutMs?: number },
  ): Promise<{ text: string; model?: string; requestedModel?: string; effectiveModel?: string | null; warning?: string }>
  /** One-shot LLM query on the session's connection/model; throws the real provider error. */
  querySessionLlm?(
    sessionId: string,
    request: { prompt: string; systemPrompt?: string; maxTokens?: number; temperature?: number },
    options?: { preferFastModel?: boolean },
  ): Promise<{ text: string; model?: string; warning?: string }>
  refreshBadge(): void
  getUnreadSummary(): UnreadSummary

  // ---------------------------------------------------------------------------
  // Workspace
  // ---------------------------------------------------------------------------

  getWorkspaces(): Workspace[]
  /** Return client-safe workspace list (no rootPath) for remote clients. */
  getWorkspacesInfo(): WorkspaceInfo[]
  setupConfigWatcher(workspaceRootPath: string, workspaceId: string): void
  retryBuiltinMcpSources?(workspaceId: string): void
  /**
   * Manually notify the ConfigWatcher of a file change.
   * Workaround for Bun's fs.watch on Linux not detecting atomic renames.
   */
  notifyConfigFileChange(workspaceRootPath: string, relativePath: string): void

  /**
   * Request a (re)capture of a page's preview poster. No-op unless a capturer
   * was injected (Electron main only); headless/WebUI hosts fall back to the
   * placeholder tile.
   */
  enqueuePageThumbnail(workspaceId: string, workspaceRootPath: string, slug: string): void

  // ---------------------------------------------------------------------------
  // Server-level observability
  // ---------------------------------------------------------------------------

  /** Count of sessions with active backend processes. Pass workspaceId to scope. */
  getActiveSessionCount(workspaceId?: string): number
  /** Automation summary for a workspace (count of configured automations + scheduler state). */
  getWorkspaceAutomationSummary(workspaceId: string): { automationCount: number; schedulerRunning: boolean }
  /**
   * Emit an AppEvent into the workspace AutomationSystem event bus (P6 knowledge watcher).
   * No-op when the workspace has no AutomationSystem yet.
   */
  emitWorkspaceEvent?(workspaceId: string, event: string, payload: Record<string, unknown>): Promise<void>
  /** Active sessions across all workspaces (sessions with running backend processes). */
  getActiveSessionsInfo(): ActiveSessionInfo[]

  // ---------------------------------------------------------------------------
  // Auth
  // ---------------------------------------------------------------------------

  reinitializeAuth(connectionSlug?: string): Promise<void>
  /**
   * Push runtime updates (e.g. capability toggles) to every active session
   * that uses the given connection. Backstopped by the lazy refresh path in
   * `getOrCreateAgent`.
   */
  refreshConnectionRuntime(connectionSlug: string): Promise<void>
  completeAuthRequest(sessionId: string, result: AuthResult): Promise<void>
  executePromptAutomation(input: ExecutePromptAutomationInput): Promise<{ sessionId: string }>

  /**
   * Install a callback invoked from `executePromptAutomation` after a session
   * is created when the matcher declared `telegramTopic`. Wired by the
   * messaging-gateway bootstrap so the SessionManager doesn't need to import
   * the messaging package (avoids a circular package-level import).
   *
   * The callback should be best-effort: failures must not block the session.
   */
  setAutomationBinder?(
    fn: (input: { workspaceId: string; sessionId: string; topicName: string }) => Promise<void>,
  ): void
}

/**
 * Input for executePromptAutomation. Options-object form replaces the
 * previous positional-args signature once the param list grew past
 * readability — new optional fields (thinkingLevel, future cwd/permissions
 * overrides) can be added without churn at every call site.
 */
export interface ExecutePromptAutomationInput {
  workspaceId: string
  workspaceRootPath: string
  prompt: string
  labels?: string[]
  permissionMode?: PermissionMode
  mentions?: string[]
  llmConnection?: string
  model?: string
  /** Override the workspace default thinking level for the spawned session. */
  thinkingLevel?: ThinkingLevel
  automationName?: string
  /**
   * Optional Telegram forum-topic name. When set and the workspace has a
   * paired supergroup, the new session is bound to a topic of this name
   * (created on first use). Silently ignored when prerequisites aren't met.
   */
  telegramTopic?: string
  /**
   * When `false`, `executePromptAutomation` returns as soon as the session is
   * created and the prompt is dispatched, instead of awaiting the whole turn.
   * Used by the automation **Test** action so a long run (tools / >30s output)
   * doesn't trip the RPC client timeout (craft-agents-oss#943). The session
   * still streams live and run errors are logged. Defaults to awaiting completion.
   */
  waitForCompletion?: boolean
}
