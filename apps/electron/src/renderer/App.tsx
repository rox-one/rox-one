import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { waitForTransportConnected } from './lib/transport-wait'
import { decideStartupAppState, isStartupAuthorityDenial, probeWithRetry } from './lib/startup-setup-needs'
import { useTranslation } from 'react-i18next'
import { useTheme } from '@/hooks/useTheme'
import type { ThemeOverrides } from '@config/theme'
import { useSetAtom, useStore, useAtomValue, useAtom } from 'jotai'
import type { Session, Workspace, SessionEvent, Message, FileAttachment, StoredAttachment, PermissionRequest, CredentialRequest, CredentialResponse, SetupNeeds, SessionStatus, NewChatActionParams, ContentBadge, LlmConnectionWithStatus, PermissionModeState } from '../shared/types'
import type { StartupRuntimeSummary } from '@rox/shared/protocol'
import type { SessionDraft, DraftAttachmentRef } from '@rox/shared/config'
import type { SessionOptions, SessionOptionUpdates } from './hooks/useSessionOptions'
import { defaultSessionOptions, mergeSessionOptions } from './hooks/useSessionOptions'
import { generateMessageId } from '../shared/types'
import { useEventProcessor } from './event-processor'
import type { AgentEvent, Effect } from './event-processor'
import { AppShell } from '@/components/app-shell/AppShell'
import { SessionSharingHost } from '@/components/app-shell/SessionSharingHost'
import { collectionBulkOperationRegistry } from '@/components/app-shell/collection/collection-bulk-optimistic'
import { WorkspaceIconRail } from '@/components/app-shell/WorkspaceIconRail'
import { getTopBarLeftInset, shouldShowWorkspaceIconRail, WORKSPACE_SELECTOR_RAIL_CHANGED_EVENT } from '@/components/app-shell/workspace-rail'
import { viewportBand } from '@/platform/viewport-band'
import type { AppShellContextType } from '@/context/AppShellContext'
import { OnboardingWizard, ReauthScreen, ensureRoxRuntimeDefault } from '@/components/onboarding'
import { openFirstSessionWelcome } from '@/components/onboarding/first-session-welcome'
import { WorkspacePicker } from '@/components/workspace'
import { ResetConfirmationDialog } from '@/components/ResetConfirmationDialog'
import { KeyboardShortcutsDialog } from '@/components/KeyboardShortcutsDialog'
import { SplashScreen } from '@/components/SplashScreen'
import { TooltipProvider } from '@rox/ui'
import { FocusProvider } from '@/context/FocusContext'
import { ModalProvider } from '@/context/ModalContext'
import { DismissibleLayerProvider } from '@/context/DismissibleLayerContext'
import { useWindowCloseHandler } from '@/hooks/useWindowCloseHandler'
import { useOnboarding } from '@/hooks/useOnboarding'
import { useNotifications } from '@/hooks/useNotifications'
import { useSession } from '@/hooks/useSession'
import { useUpdateChecker } from '@/hooks/useUpdateChecker'
import { NavigationProvider } from '@/contexts/NavigationContext'
import * as storage from '@/lib/local-storage'
import { markStatusUnseen } from '@/lib/sidebar-unseen-status'
import { navigate, routes } from './lib/navigate'
import { attachmentFromContentRef, toDraftRef } from './lib/drafts'
import { stripMarkdown } from './utils/text'
import { coerceInputText } from './lib/input-text'
import { getSessionsToRefreshAfterStaleReconnect } from './lib/reconnect-recovery'
import { formatSessionLoadFailure, shouldTreatSessionLoadFailureAsTransportFallback } from './lib/session-load'
import { readLocalSessionCapability, loadCallerSessionInventory } from './lib/caller-session-loading'
import { markSessionsReadyThenReconcile } from '@/lib/splash-sessions-ready'
import { extractWorkspaceSlugFromPath } from '@rox/shared/utils/workspace-slug'
import { DEFAULT_THINKING_LEVEL } from '@rox/shared/agent/thinking-levels'
import { initRendererPerf } from './lib/perf'
import {
  initializeSessionsAtom,
  addSessionAtom,
  removeSessionAtom,
  updateSessionAtom,
  replaceLoadedSessionAtom,
  refreshSessionsMetadataAtom,
  sessionAtomFamily,
  sessionMetaMapAtom,
  sessionIdsAtom,
  loadedSessionsAtom,
  forceSessionMessagesReloadAtom,
  backgroundTasksAtomFamily,
  extractSessionMeta,
  windowWorkspaceIdAtom,
  type SessionMeta,
  type BackgroundTask,
} from '@/atoms/sessions'
import { sourcesAtom } from '@/atoms/sources'
import { skillsAtom } from '@/atoms/skills'
import {
  showBackgroundFinishedChipAtom,
  pushBackgroundFinishedAtom,
} from '@/atoms/background-finished'
import { visibleSessionIdsAtom } from '@/atoms/panel-stack'
import { getSessionTitle } from '@/utils/session'
import { extractBadges } from '@/lib/mentions'
import { getDefaultStore } from 'jotai'
import {
  ShikiThemeProvider,
  PlatformProvider,
  ImagePreviewOverlay,
  PDFPreviewOverlay,
  CodePreviewOverlay,
  DocumentFormattedMarkdownOverlay,
  JSONPreviewOverlay,
} from '@rox/ui'
import { useLinkInterceptor, type FilePreviewState } from '@/hooks/useLinkInterceptor'
import { queueInternalBrowserUrl } from '@/components/browser/internal-browser-queue'
import { useTransportConnectionState } from '@/hooks/useTransportConnectionState'
import { useSshConnectionStatus } from '@/hooks/useSshConnectionStatus'
import { useStaleSessionRecovery } from '@/hooks/useStaleSessionRecovery'
import { TransportConnectionBanner, shouldShowTransportConnectionBanner, shouldShowSshBanner } from '@/components/app-shell/TransportConnectionBanner'
import { ToolchainStatusBanner } from '@/components/app-shell/ToolchainStatusBanner'
import {
  markBackgroundTaskSignal,
  markLiveBackgroundTasksOrphaned,
} from '@/components/app-shell/background-task-chip-state'
import { getFileManagerName } from '@/lib/platform'
import { rendererLog } from '@/lib/logger'
import { ActionRegistryProvider } from '@/actions'
import { OmniboxHost } from '@/platform/OmniboxHost'
import { toast } from 'sonner'
import { initializeAuthenticatedWebRenderer, type AuthenticatedWebTransportBootstrap } from '@/lib/authenticated-web-bootstrap'
import { runPersonalTaskScopeTransition, setPersonalTaskScope } from '@/lib/personal-tasks'

type AppState = 'loading' | 'onboarding' | 'reauth' | 'workspace-picker' | 'ready' | 'transport-unavailable'

/** Type for the Jotai store returned by useStore() */
type JotaiStore = ReturnType<typeof getDefaultStore>

type SessionListRefreshOptions = {
  removeMissing?: boolean
  reason?: string
  selectedSessionId?: string | null
}

const SESSION_REFRESH_LOG_ID_LIMIT = 25

function summarizeIds(ids: Iterable<string>, limit = SESSION_REFRESH_LOG_ID_LIMIT) {
  const all = Array.from(ids)
  return {
    count: all.length,
    ids: all.slice(0, limit),
    truncated: all.length > limit,
  }
}

function workspaceDistribution(sessions: Iterable<{ workspaceId?: string }>): Record<string, number> {
  const distribution: Record<string, number> = {}
  for (const session of sessions) {
    const key = session.workspaceId || '(missing)'
    distribution[key] = (distribution[key] ?? 0) + 1
  }
  return distribution
}

/**
 * Helper to handle background task events from the agent.
 * Updates the backgroundTasksAtomFamily based on event type.
 * Extracted to avoid code duplication between streaming and non-streaming paths.
 */
function handleBackgroundTaskEvent(
  store: JotaiStore,
  sessionId: string,
  event: { type: string },
  agentEvent: unknown
): void {
  // Type guard for accessing properties
  const evt = agentEvent as Record<string, unknown>
  const backgroundTasksAtom = backgroundTasksAtomFamily(sessionId)

  if (event.type === 'task_backgrounded' && 'taskId' in evt && 'toolUseId' in evt) {
    const currentTasks = store.get(backgroundTasksAtom)
    const exists = currentTasks.some(t => t.toolUseId === evt.toolUseId)
    if (!exists) {
      const isWorkflow = evt.kind === 'workflow'
      const startTime = Date.now()
      store.set(backgroundTasksAtom, [
        ...currentTasks,
        {
          id: evt.taskId as string,
          type: isWorkflow ? ('workflow' as const) : ('agent' as const),
          toolUseId: evt.toolUseId as string,
          startTime,
          elapsedSeconds: 0,
          lastSignalAt: startTime,
          intent: evt.intent as string | undefined,
          status: 'running' as const,
          ...(isWorkflow ? { workflowId: evt.workflowId as string | undefined, agentsCompleted: 0 } : {}),
        },
      ])
    }
  } else if (event.type === 'workflow_agent_completed' && 'workflowId' in evt) {
    // One sub-agent of a running Workflow finished — bump the owning chip's count
    // and treat it as evidence that a stale workflow is still alive.
    const currentTasks = store.get(backgroundTasksAtom)
    const now = Date.now()
    store.set(backgroundTasksAtom, currentTasks.map(t =>
      t.type === 'workflow' && t.workflowId === evt.workflowId
        ? { ...markBackgroundTaskSignal(t, now), agentsCompleted: (t.agentsCompleted ?? 0) + 1 }
        : t
    ))
  } else if (event.type === 'shell_backgrounded' && 'shellId' in evt && 'toolUseId' in evt) {
    const currentTasks = store.get(backgroundTasksAtom)
    const exists = currentTasks.some(t => t.toolUseId === evt.toolUseId)
    if (!exists) {
      const startTime = Date.now()
      store.set(backgroundTasksAtom, [
        ...currentTasks,
        {
          id: evt.shellId as string,
          type: 'shell' as const,
          toolUseId: evt.toolUseId as string,
          startTime,
          elapsedSeconds: 0,
          lastSignalAt: startTime,
          intent: evt.intent as string | undefined,
          status: 'running' as const,
        },
      ])
    }
  } else if (event.type === 'task_progress' && 'toolUseId' in evt && 'elapsedSeconds' in evt) {
    const currentTasks = store.get(backgroundTasksAtom)
    const now = Date.now()
    store.set(backgroundTasksAtom, currentTasks.map(t =>
      t.toolUseId === evt.toolUseId
        ? { ...markBackgroundTaskSignal(t, now), elapsedSeconds: evt.elapsedSeconds as number }
        : t
    ))
  } else if (event.type === 'task_completed' && 'taskId' in evt) {
    // Transition the chip to a terminal status (keep it visible with a terminal
    // icon + click-through to output). The ActiveTasksBar auto-expiry ticker
    // prunes it after a short linger — we no longer remove it instantly, so the
    // user sees that the task finished rather than the chip just vanishing.
    const status = (evt.status as BackgroundTask['status']) ?? 'completed'
    const currentTasks = store.get(backgroundTasksAtom)
    store.set(backgroundTasksAtom, currentTasks.map(t =>
      t.id === evt.taskId
        ? {
            ...t,
            status,
            completedAt: Date.now(),
            outputFile: (evt.outputFile as string | undefined) ?? t.outputFile,
            summary: (evt.summary as string | undefined) ?? t.summary,
          }
        : t
    ))
  } else if (event.type === 'shell_killed' && 'shellId' in evt) {
    // Mark shell stopped (lingers briefly, then auto-expires) instead of vanishing.
    const currentTasks = store.get(backgroundTasksAtom)
    store.set(backgroundTasksAtom, currentTasks.map(t =>
      t.id === evt.shellId
        ? { ...t, status: 'stopped' as const, completedAt: Date.now() }
        : t
    ))
  } else if (event.type === 'tool_result' && 'toolUseId' in evt) {
    // Remove task when it completes - but NOT if this is the initial backgrounding result
    // Background tasks return immediately with agentId/shell_id/backgroundTaskId,
    // we should only remove when the task actually completes
    const result = typeof evt.result === 'string' ? evt.result : JSON.stringify(evt.result)
    const isBackgroundingResult = result && (
      /agentId:\s*[a-zA-Z0-9_-]+/.test(result) ||
      /shell_id:\s*[a-zA-Z0-9_-]+/.test(result) ||
      /"backgroundTaskId":\s*"[a-zA-Z0-9_-]+"/.test(result)
    )
    if (!isBackgroundingResult) {
      const currentTasks = store.get(backgroundTasksAtom)
      store.set(backgroundTasksAtom, currentTasks.filter(t => t.toolUseId !== evt.toolUseId))
    }
  } else if (event.type === 'complete' || event.type === 'interrupted' || event.type === 'error') {
    // Orphan backstop: without keep-alive, turn teardown is authoritative evidence
    // that both running and uncertain/stale background tasks died with the SDK
    // subprocess. With keep-alive they may genuinely survive, so preserve them for
    // a later progress or task_completed signal.
    if (evt.backgroundTasksAlive === true) {
      return
    }
    const currentTasks = store.get(backgroundTasksAtom)
    const nextTasks = markLiveBackgroundTasksOrphaned(currentTasks, Date.now())
    if (nextTasks !== currentTasks) {
      store.set(backgroundTasksAtom, nextTasks)
    }
  }
}

function SessionLoadErrorScreen({
  message,
  onRetry,
}: {
  message: string
  onRetry: () => void
}) {
  const { t } = useTranslation()

  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="max-w-lg rounded-xl border border-border/50 bg-background shadow-minimal p-6 text-center">
        <h2 className="text-lg font-semibold text-foreground">{t("errors.failedToLoadSessions")}</h2>
        <p className="mt-2 text-sm text-foreground/60">
          {t("errors.failedToLoadSessionsDesc")}
        </p>
        <p className="mt-3 rounded-lg bg-foreground/5 px-3 py-2 text-left text-xs text-foreground/70 break-words">
          {message}
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 inline-flex h-8 items-center justify-center rounded-[8px] bg-foreground text-background px-3 text-sm font-medium hover:opacity-90 transition-opacity"
        >
          {t("errors.retryLoadingSessions")}
        </button>
      </div>
    </div>
  )
}

export default function App({ webTransportBootstrap }: { webTransportBootstrap?: AuthenticatedWebTransportBootstrap } = {}) {
  const { t } = useTranslation()

  // Initialize renderer perf tracking early (debug mode = running from source)
  // Uses useEffect with empty deps to run once on mount before any session switches
  useEffect(() => {
    let active = true
    void window.electronAPI.isDebugMode().then((isDebug) => {
      if (active) initRendererPerf(isDebug)
    }).catch(() => {
      if (active) initRendererPerf(false)
    })
    return () => { active = false }
  }, [])

  // App state: loading -> check auth -> onboarding or ready
  const [appState, setAppState] = useState<AppState>('loading')
  const [setupNeeds, setSetupNeeds] = useState<SetupNeeds | null>(null)
  const [startupBootstrapError, setStartupBootstrapError] = useState('')
  const [startupAttempt, setStartupAttempt] = useState(0)
  const [callerAuthority, setCallerAuthority] = useState<'native' | 'local' | null>(null)
  const callerAuthorityRef = useRef(callerAuthority)
  callerAuthorityRef.current = callerAuthority

  // Per-session Jotai atom setters for isolated updates
  // NOTE: No sessionsAtom - we don't store a Session[] array anywhere to prevent memory leaks
  // Instead we use:
  // - sessionMetaMapAtom for lightweight listing
  // - sessionAtomFamily(id) for individual session data
  const initializeSessions = useSetAtom(initializeSessionsAtom)
  const addSession = useSetAtom(addSessionAtom)
  const removeSession = useSetAtom(removeSessionAtom)
  const updateSessionDirect = useSetAtom(updateSessionAtom)
  const replaceLoadedSession = useSetAtom(replaceLoadedSessionAtom)
  const store = useStore()

  // Helper to update a session by ID with partial fields
  // Uses per-session atom directly instead of updating an array
  const updateSessionById = useCallback((
    sessionId: string,
    updates: Partial<Session> | ((session: Session) => Partial<Session>)
  ) => {
    updateSessionDirect(sessionId, (prev) => {
      if (!prev) return prev
      const partialUpdates = typeof updates === 'function' ? updates(prev) : updates
      return { ...prev, ...partialUpdates }
    })
  }, [updateSessionDirect])

  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [workspaceSelectorRail, setWorkspaceSelectorRail] = useState(() =>
    storage.get(storage.KEYS.workspaceSelectorRail, true)
  )

  useEffect(() => {
    const handleWorkspaceSelectorRailChanged = (event: Event) => {
      const customEvent = event as CustomEvent<boolean>
      setWorkspaceSelectorRail(
        typeof customEvent.detail === 'boolean'
          ? customEvent.detail
          : storage.get(storage.KEYS.workspaceSelectorRail, true)
      )
    }

    window.addEventListener(WORKSPACE_SELECTOR_RAIL_CHANGED_EVENT, handleWorkspaceSelectorRailChanged)
    return () => {
      window.removeEventListener(WORKSPACE_SELECTOR_RAIL_CHANGED_EVENT, handleWorkspaceSelectorRailChanged)
    }
  }, [])

  // Window's workspace ID — shared atom so Root/ThemeProvider stays in sync on switch
  const [windowWorkspaceId, setWindowWorkspaceId] = useAtom(windowWorkspaceIdAtom)
  const sessionScopeRef = useRef({ authority: callerAuthority, workspaceId: windowWorkspaceId })
  if (sessionScopeRef.current.authority !== callerAuthority || sessionScopeRef.current.workspaceId !== windowWorkspaceId) {
    sessionScopeRef.current = { authority: callerAuthority, workspaceId: windowWorkspaceId }
  }
  useEffect(() => {
    let cancelled = false
    setPersonalTaskScope(null)
    if (!webTransportBootstrap && callerAuthority && windowWorkspaceId) {
      void (async () => {
        const identity = await window.electronAPI.getOrgIdentity()
        const currentWorkspace = await window.electronAPI.getWindowWorkspace()
        if (cancelled || identity.authority !== callerAuthority || currentWorkspace !== windowWorkspaceId) return
        setPersonalTaskScope({ ...identity, workspaceId: currentWorkspace })
      })().catch(() => {})
    }
    return () => { cancelled = true; setPersonalTaskScope(null) }
  }, [callerAuthority, windowWorkspaceId, webTransportBootstrap])

  // Derive workspace slug for SDK skill qualification
  const windowWorkspaceSlug = useMemo(() => {
    if (!windowWorkspaceId) return null
    const workspace = workspaces.find(w => w.id === windowWorkspaceId)
    return workspace?.slug ?? windowWorkspaceId
  }, [windowWorkspaceId, workspaces])

  // Get initial sessionId and focused mode from URL params (for "Open in New Window" feature)
  const { initialSessionId, isFocusedMode } = useMemo(() => {
    const params = new URLSearchParams(window.location.search)
    return {
      initialSessionId: params.get('sessionId'),
      isFocusedMode: params.get('focused') === 'true',
    }
  }, [])

  // Derive remote workspace ID for session matching in NavigationContext
  const windowRemoteWorkspaceId = useMemo(() => {
    if (!windowWorkspaceId) return null
    const workspace = workspaces.find(w => w.id === windowWorkspaceId)
    return workspace?.remoteServer?.remoteWorkspaceId ?? null
  }, [windowWorkspaceId, workspaces])

  // LLM connections with authentication status (for provider selection)
  const [llmConnections, setLlmConnections] = useState<LlmConnectionWithStatus[]>([])
  const [runtimeSummary, setRuntimeSummary] = useState<StartupRuntimeSummary | null>(null)
  const runtimeRefreshGeneration = useRef(0)
  // Workspace default LLM connection (for new sessions)
  const [workspaceDefaultLlmConnection, setWorkspaceDefaultLlmConnection] = useState<string | undefined>()
  // Global default LLM connection slug (from app config)
  const [defaultLlmConnectionSlug, setDefaultLlmConnectionSlug] = useState<string | undefined>()

  // Derive connection default model override from the default LLM connection
  const defaultConnection = useMemo(() => {
    return llmConnections.find(c => c.slug === defaultLlmConnectionSlug) ?? null
  }, [llmConnections, defaultLlmConnectionSlug])

  const [menuNewChatTrigger, setMenuNewChatTrigger] = useState(0)
  // Permission requests per session (queue to handle multiple concurrent requests)
  const [pendingPermissions, setPendingPermissions] = useState<Map<string, PermissionRequest[]>>(new Map())
  // Credential requests per session (queue to handle multiple concurrent requests)
  const [pendingCredentials, setPendingCredentials] = useState<Map<string, CredentialRequest[]>>(new Map())
  // Draft composer state per session (text + attachment refs), preserved across mode
  // switches, conversation changes, and app restarts. Using a ref avoids re-renders
  // during typing; attachments are stored as lightweight refs (path + name) and
  // hydrated via readFileAttachment() on session switch.
  const sessionDraftsRef = useRef<Map<string, SessionDraft>>(new Map())
  // Unified session options for all session-scoped settings
  const [sessionOptions, setSessionOptions] = useState<Map<string, SessionOptions>>(new Map())

  // Theme state (app-level only)
  const [appTheme, setAppTheme] = useState<ThemeOverrides | null>(null)
  // Reset confirmation dialog
  const [showResetDialog, setShowResetDialog] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)

  // Auto-update state
  const updateChecker = useUpdateChecker()

  // Splash screen state - tracks when app is fully ready (all data loaded)
  const [sessionsLoaded, setSessionsLoaded] = useState(false)
  const [sessionLoadError, setSessionLoadError] = useState<string | null>(null)
  const [splashExiting, setSplashExiting] = useState(false)
  const [splashHidden, setSplashHidden] = useState(false)

  // Notifications enabled state (from app settings)
  const [notificationsEnabled, setNotificationsEnabled] = useState(true)

  // Sources and skills for badge extraction
  const sources = useAtomValue(sourcesAtom)
  const skills = useAtomValue(skillsAtom)

  // Compute if app is fully ready (all data loaded)
  const isFullyReady = appState === 'ready' && sessionsLoaded

  // Trigger splash exit animation when fully ready
  useEffect(() => {
    if (isFullyReady && !splashExiting) {
      setSplashExiting(true)
    }
  }, [isFullyReady, splashExiting])

  // Handler for when splash exit animation completes
  const handleSplashExitComplete = useCallback(() => {
    setSplashHidden(true)
  }, [])

  // Apply theme via hook (injects CSS variables)
  // shikiTheme is passed to ShikiThemeProvider to ensure correct syntax highlighting
  // theme for dark-only themes in light system mode
  const { shikiTheme, isDark } = useTheme({ appTheme })

  // Ref for sessionOptions to access current value in event handlers without re-registering
  const sessionOptionsRef = useRef(sessionOptions)
  const permissionModeRequestsRef = useRef(new Map<string, {
    requestId: number
    pending: boolean
    rollbackMode: SessionOptions['permissionMode']
    rollbackVersion?: number
  }>())
  // Keep ref in sync with state
  useEffect(() => {
    sessionOptionsRef.current = sessionOptions
  }, [sessionOptions])

  const applyPermissionModeState = useCallback((sessionId: string, state: PermissionModeState, source: 'event' | 'reconcile') => {
    const pending = permissionModeRequestsRef.current.get(sessionId)
    if (pending && state.modeVersion >= (pending.rollbackVersion ?? -1)) {
      permissionModeRequestsRef.current.set(sessionId, {
        ...pending, rollbackMode: state.permissionMode, rollbackVersion: state.modeVersion,
      })
    }
    setSessionOptions(prev => {
      const next = new Map(prev)
      const current = next.get(sessionId) ?? defaultSessionOptions
      const currentVersion = current.permissionModeVersion ?? -1

      if (state.modeVersion < currentVersion) {
        window.electronAPI.debugLog(
          '[ModeSync] Ignoring stale permission mode update',
          { sessionId, source, incoming: state.modeVersion, current: currentVersion }
        )
        return prev
      }

      if (
        state.modeVersion === currentVersion &&
        current.permissionMode !== state.permissionMode
      ) {
        window.electronAPI.debugLog(
          '[ModeSync] Equal modeVersion with differing mode detected, applying and requesting reconciliation',
          {
            sessionId,
            source,
            modeVersion: state.modeVersion,
            currentMode: current.permissionMode,
            incomingMode: state.permissionMode,
          }
        )
      }

      next.set(sessionId, {
        ...current,
        permissionMode: state.permissionMode,
        permissionModeVersion: state.modeVersion,
      })
      return next
    })
  }, [])

  const reconcilePermissionModeState = useCallback(async (sessionId: string, shouldApply: () => boolean = () => true) => {
    if (callerAuthorityRef.current !== 'local') return null
    try {
      const result = await readLocalSessionCapability({
        getAuthority: () => callerAuthorityRef.current,
        request: () => window.electronAPI.getSessionPermissionModeState(sessionId),
      })
      if (result.kind === 'unavailable' || callerAuthorityRef.current !== 'local' || !shouldApply()) return null
      const state = result.value
      if (!state) return null
      applyPermissionModeState(sessionId, state, 'reconcile')
      return state
    } catch (error) {
      window.electronAPI.debugLog('[ModeSync] Failed to reconcile permission mode', {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      })
      return null
    }
  }, [applyPermissionModeState])

  // Event processor hook - handles all agent events through pure functions
  const { processAgentEvent, clearStreamingState } = useEventProcessor()

  const syncSessionOptionsFromSession = useCallback((session: Session) => {
    setSessionOptions(prev => {
      const next = new Map(prev)
      const current = next.get(session.id)
      const merged = {
        ...defaultSessionOptions,
        ...current,
        permissionMode: session.permissionMode ?? defaultSessionOptions.permissionMode,
        thinkingLevel: session.thinkingLevel ?? DEFAULT_THINKING_LEVEL,
      }

      const hasNonDefaultMode = merged.permissionMode !== defaultSessionOptions.permissionMode
      const hasNonDefaultThinking = merged.thinkingLevel !== DEFAULT_THINKING_LEVEL

      if (!hasNonDefaultMode && !hasNonDefaultThinking && merged.permissionModeVersion == null) {
        next.delete(session.id)
      } else {
        next.set(session.id, merged)
      }

      return next
    })
  }, [])

  const refreshSessionFromServer = useCallback(async (sessionId: string): Promise<'refreshed' | 'preserved_stale_messages' | 'failed'> => {
    const scope = sessionScopeRef.current
    if (!scope.authority || scope.authority === 'native' && !scope.workspaceId) return 'failed'
    try {
      const fresh = await window.electronAPI.getSessionMessages(sessionId)
      if (sessionScopeRef.current !== scope) return 'failed'
      if (!fresh) return 'failed'
      if (scope.authority === 'native' && fresh.workspaceId !== scope.workspaceId) return 'failed'

      const prevSession = store.get(sessionAtomFamily(sessionId))
      const preservedStaleMessages = !!prevSession && prevSession.messages.length > 0 && (!fresh.messages || fresh.messages.length === 0)
      const nextSession = preservedStaleMessages
        ? { ...fresh, messages: prevSession.messages }
        : fresh

      clearStreamingState(sessionId)
      replaceLoadedSession(nextSession)
      syncSessionOptionsFromSession(nextSession)
      void reconcilePermissionModeState(sessionId)
      return preservedStaleMessages ? 'preserved_stale_messages' : 'refreshed'
    } catch (err) {
      console.error(`[App] Failed to refresh session ${sessionId}:`, err)
      return 'failed'
    }
  }, [clearStreamingState, replaceLoadedSession, syncSessionOptionsFromSession, reconcilePermissionModeState, store])

  const markHostSessionsUnavailable = useCallback(() => {
    initializeSessions([])
    setSessionOptions(new Map())
    setSessionLoadError(null)
    setSessionsLoaded(true)
  }, [initializeSessions])

  const readCallerSessionInventory = useCallback(() => loadCallerSessionInventory({
    getAuthority: () => callerAuthorityRef.current,
    getNativeWorkspaceId: () => sessionScopeRef.current.workspaceId,
    getScopeKey: () => sessionScopeRef.current,
    request: () => window.electronAPI.getSessions(),
    markUnavailable: markHostSessionsUnavailable,
  }), [markHostSessionsUnavailable])

  const loadSessionsFromServer = useCallback(async () => {
    setSessionLoadError(null)

    try {
      const inventory = await readCallerSessionInventory()
      if (inventory.kind === 'unavailable' || !callerAuthorityRef.current) return
      const loadedSessions = inventory.sessions

      // Initialize per-session atoms and metadata map
      // NOTE: No sessionsAtom used - sessions are only in per-session atoms
      initializeSessions(loadedSessions)

      // Initialize unified sessionOptions from session data
      const optionsMap = new Map<string, SessionOptions>()
      for (const s of loadedSessions) {
        const hasNonDefaultMode = s.permissionMode && s.permissionMode !== 'ask'
        const hasNonDefaultThinking = s.thinkingLevel && s.thinkingLevel !== DEFAULT_THINKING_LEVEL
        if (hasNonDefaultMode || hasNonDefaultThinking) {
          optionsMap.set(s.id, {
            permissionMode: s.permissionMode ?? 'ask',
            thinkingLevel: s.thinkingLevel ?? DEFAULT_THINKING_LEVEL,
          })
        }
      }
      setSessionOptions(optionsMap)

      // Splash exit gates on sessionsLoaded. Permission mode is already seeded
      // from getSessions() above; per-session getSessionPermissionModeState is
      // N+1 IPC (perf probe detectSessionMetadataNPlusOne) and must not block
      // first paint / splash dismiss. Reconcile in the background.
      markSessionsReadyThenReconcile({
        markReady: () => setSessionsLoaded(true),
        reconcileAll: () =>
          Promise.allSettled(
            loadedSessions.map((s) => reconcilePermissionModeState(s.id)),
          ),
      })

      if (initialSessionId && windowWorkspaceId) {
        const session = loadedSessions.find(s => s.id === initialSessionId)
        if (session) {
          navigate(routes.view.allSessions(session.id))
        }
      }
    } catch (err) {
      console.error('[App] Failed to load sessions:', err)
      if (callerAuthorityRef.current === 'native') {
        setSessionLoadError(t('chat.failedToLoadConversation'))
        setSessionsLoaded(true)
        return
      }
      const transport = await readLocalSessionCapability({
        getAuthority: () => callerAuthorityRef.current,
        request: () => window.electronAPI.getTransportConnectionState().catch(() => null),
      })
      if (transport.kind === 'unavailable' || callerAuthorityRef.current !== 'local') {
        markHostSessionsUnavailable()
        return
      }
      const transportState = transport.value

      if (shouldTreatSessionLoadFailureAsTransportFallback(transportState)) {
        console.error('[App] Treating session load failure as transport fallback:', transportState)
        setSessionsLoaded(true)
        setSessionLoadError(null)
        return
      }

      setSessionLoadError(formatSessionLoadFailure(err))
      setSessionsLoaded(true)
    }
  }, [initializeSessions, initialSessionId, reconcilePermissionModeState, windowWorkspaceId, readCallerSessionInventory, markHostSessionsUnavailable, t])

  const refreshSessionListMetadataFromServer = useCallback(async (options: SessionListRefreshOptions = {}): Promise<Map<string, SessionMeta> | null> => {
    const {
      removeMissing = true,
      reason = 'manual-or-authoritative',
      selectedSessionId = null,
    } = options
    const beforeMetaMap = store.get(sessionMetaMapAtom)
    const beforeIds = new Set(beforeMetaMap.keys())
    const transportState = await window.electronAPI.getTransportConnectionState().catch(() => null)

    try {
      const inventory = await readCallerSessionInventory()
      if (inventory.kind === 'unavailable' || !callerAuthorityRef.current) return null
      const sessions = inventory.sessions
      const returnedIds = new Set(sessions.map(s => s.id))
      const missingIds = Array.from(beforeIds).filter(id => !returnedIds.has(id))
      const addedIds = sessions.map(s => s.id).filter(id => !beforeIds.has(id))
      const logPayload = {
        reason,
        removeMissing,
        windowWorkspaceId,
        windowRemoteWorkspaceId,
        selectedSessionId,
        beforeCount: beforeIds.size,
        returnedCount: sessions.length,
        beforeIds: summarizeIds(beforeIds),
        returnedIds: summarizeIds(returnedIds),
        missingIds: summarizeIds(missingIds),
        addedIds: summarizeIds(addedIds),
        beforeWorkspaceIds: workspaceDistribution(beforeMetaMap.values()),
        returnedWorkspaceIds: workspaceDistribution(sessions),
        transportState,
      }

      rendererLog.info('[App] Session list metadata refresh result', logPayload)
      if (!removeMissing && missingIds.length > 0) {
        rendererLog.warn('[App] Non-destructive refresh preserved sessions omitted by getSessions(); this indicates a partial backend response or workspace-context mismatch', logPayload)
      }

      const loadedSessionIds = store.get(loadedSessionsAtom)

      // Single transactional atom write — all cross-atom mutations happen
      // inside one Jotai write function so React subscribers see one
      // consistent update instead of intermediate states.
      const nextMetaMap = store.set(refreshSessionsMetadataAtom, { sessions, loadedSessionIds, removeMissing })

      // Sync app-level state (React hooks / non-atom concerns) after the atom transaction
      for (const session of sessions) {
        syncSessionOptionsFromSession(session)
      }
      await Promise.allSettled(sessions.map(s => reconcilePermissionModeState(s.id)))

      return nextMetaMap
    } catch (err) {
      rendererLog.error('[App] Failed to refresh session list metadata after reconnect:', {
        reason,
        removeMissing,
        windowWorkspaceId,
        windowRemoteWorkspaceId,
        selectedSessionId,
        beforeCount: beforeIds.size,
        beforeIds: summarizeIds(beforeIds),
        beforeWorkspaceIds: workspaceDistribution(beforeMetaMap.values()),
        transportState,
        error: err,
      })
      return null
    }
  }, [store, syncSessionOptionsFromSession, reconcilePermissionModeState, windowWorkspaceId, windowRemoteWorkspaceId, readCallerSessionInventory])

  // Stale session watchdog — catches stuck sessions that the reconnect protocol misses
  const { trackSessionActivity } = useStaleSessionRecovery({
    store,
    refreshSessionFromServer,
  })

  const DRAFT_SAVE_DEBOUNCE_MS = 500

  const resolveDefaultConnectionSlug = useCallback((connections: LlmConnectionWithStatus[]) => {
    return connections.find(c => c.isDefault)?.slug ?? connections[0]?.slug
  }, [])

  // Refresh LLM connections from config (called on workspace change and after connection updates)
  const refreshLlmConnections = useCallback(async () => {
    // Cookie-authenticated web transport conveys no desktop/native identity
    // and cannot read host provider credentials or seed a runtime default.
    if (webTransportBootstrap) return
    const generation = ++runtimeRefreshGeneration.current
    const identity = await window.electronAPI.getOrgIdentity()
    if (!identity || identity.authority !== 'native' && identity.authority !== 'local') {
      throw new Error('runtime-identity-unavailable')
    }
    if (identity.authority === 'native') {
      const summary = await window.electronAPI.getStartupRuntimeSummary()
      if (generation !== runtimeRefreshGeneration.current) return
      setLlmConnections([])
      setRuntimeSummary(summary)
      setDefaultLlmConnectionSlug(summary?.slug)
      setWorkspaceDefaultLlmConnection(summary?.slug)
      return
    }
    const connections = await window.electronAPI.listLlmConnectionsWithStatus()
    if (generation !== runtimeRefreshGeneration.current) return
    setRuntimeSummary(null)
    setLlmConnections(connections)
    setDefaultLlmConnectionSlug(resolveDefaultConnectionSlug(connections))
    // Also refresh workspace default
    if (windowWorkspaceId) {
      const settings = await window.electronAPI.getWorkspaceSettings(windowWorkspaceId)
      if (generation !== runtimeRefreshGeneration.current) return
      setWorkspaceDefaultLlmConnection(settings?.defaultLlmConnection)
    }
  }, [resolveDefaultConnectionSlug, windowWorkspaceId, webTransportBootstrap])

  // Enter Home only after the selected workspace is confirmed active.
  const handleOnboardingComplete = useCallback(async (): Promise<boolean> => {
    try {
      const identity = await window.electronAPI.getOrgIdentity()
      if (!identity || identity.authority !== 'native' && identity.authority !== 'local') {
        throw new Error('runtime-identity-unavailable')
      }
      setCallerAuthority(identity.authority)
      const ws = await window.electronAPI.getWorkspaces()
      setWorkspaces(ws)
      if (ws.length === 0) {
        if (identity.authority === 'native') throw new Error('native-workspace-unavailable')
        setAppState('workspace-picker')
        return true
      }
      const workspace = ws.find((item) => item.id === windowWorkspaceId) ?? ws[0]
      if (identity.authority === 'native') {
        const current = await window.electronAPI.getWindowWorkspace()
        if (current !== workspace.id) throw new Error('native-workspace-binding-changed')
      } else {
        await window.electronAPI.switchWorkspace(workspace.id)
      }
      setWindowWorkspaceId(workspace.id)
      setAppState('ready')
      return true
    } catch (error) {
      console.error('[App] Failed to open a workspace after onboarding:', error)
      toast.error(t('onboarding.errors.workspaceTransitionFailed'))
      return false
    }
  }, [windowWorkspaceId, t])

  // Onboarding hook — onConfigSaved fires immediately when billing is saved,
  // ensuring connection state updates before the wizard closes.
  const onboarding = useOnboarding({
    onComplete: handleOnboardingComplete,
    onConfigSaved: refreshLlmConnections,
    initialSetupNeeds: setupNeeds || undefined,
    // Onboarding is the single name screen; provider setup lives in Settings → ИИ.
    initialStep: 'welcome',
  })

  // Reauth login handler - placeholder (reauth is not currently used)
  const handleReauthLogin = useCallback(async () => {
    setPersonalTaskScope(null)
    try {
      const identity = await window.electronAPI.getOrgIdentity()
      if (!identity || identity.authority !== 'native' && identity.authority !== 'local') {
        throw new Error('runtime-identity-unavailable')
      }
      setCallerAuthority(identity.authority)
      const needs = identity.authority === 'local' ? await window.electronAPI.getSetupNeeds() : null
      if (identity?.name?.trim()) {
        const runtime = await ensureRoxRuntimeDefault(window.electronAPI)
        if (runtime.status === 'failed') {
          toast.error(t('onboarding.errors.saveConfigFailed'))
          setSetupNeeds(needs)
          setAppState('onboarding')
          return
        }
        const current = await window.electronAPI.getWindowWorkspace()
        if (!current && identity.authority === 'native') throw new Error('native-workspace-unavailable')
        setWindowWorkspaceId(current)
        setAppState(current ? 'ready' : 'workspace-picker')
      } else {
        setSetupNeeds(needs)
        setAppState('onboarding')
      }
    } catch (error) {
      toast.error(t('settings.account.loadFailed', { message: error instanceof Error ? error.message : String(error) }))
      setAppState('onboarding')
    }
  }, [t])

  // Reauth reset handler - open reset confirmation dialog
  const handleReauthReset = useCallback(() => {
    setShowResetDialog(true)
  }, [])

  // Check auth state and get window's workspace ID on mount
  useEffect(() => {
    let cancelled = false
    const initialize = async () => {
      setPersonalTaskScope(null)
      try {
        if (webTransportBootstrap) {
          await initializeAuthenticatedWebRenderer(window.electronAPI, webTransportBootstrap, {
            isCancelled: () => cancelled,
            markHostSessionsUnavailable,
            onWorkspaceReady: workspaceId => {
              setCallerAuthority(null)
              setWindowWorkspaceId(workspaceId)
              setAppState('ready')
            },
          })
          return
        }
        // A failed read is unavailable, never evidence of an absent workspace
        // or a completed Welcome. Only fresh caller identity can authorize entry.
        let workspaceProbe = await probeWithRetry(() => window.electronAPI.getWindowWorkspace())
        if (cancelled) return
        const identityProbe = await probeWithRetry(() => window.electronAPI.getOrgIdentity())
        if (cancelled) return
        if (!identityProbe.ok) throw identityProbe.error
        const identity = identityProbe.value
        if (!identity || identity.authority !== 'native' && identity.authority !== 'local') {
          throw new Error('runtime-identity-unavailable')
        }
        let startupSetupNeeds: SetupNeeds | null = null
        if (identity.authority === 'local') {
          const setupProbe = await probeWithRetry(() => window.electronAPI.getSetupNeeds())
          if (cancelled) return
          if (!setupProbe.ok) throw setupProbe.error
          startupSetupNeeds = setupProbe.value
        }
        if (!workspaceProbe.ok) {
          if (isStartupAuthorityDenial(workspaceProbe.error)) throw workspaceProbe.error
          const transportProbe = await probeWithRetry(
            () => waitForTransportConnected(window.electronAPI, { timeoutMs: 12_000 }),
            { delaysMs: [] },
          )
          if (cancelled) return
          if (!transportProbe.ok) throw transportProbe.error
          workspaceProbe = await probeWithRetry(() => window.electronAPI.getWindowWorkspace())
          if (cancelled) return
        }
        if (!workspaceProbe.ok) throw workspaceProbe.error
        const startupState = decideStartupAppState({ identityProbe, workspaceProbe })
        if (startupState === 'transport-unavailable') throw new Error('runtime-identity-unavailable')
        let startupConnections: LlmConnectionWithStatus[] | null = null
        let startupRuntimeSummary: StartupRuntimeSummary | null = null
        let startupDefaultSlug: string | undefined
        if (startupState !== 'onboarding') {
          const runtimeProbe = await probeWithRetry(
            () => ensureRoxRuntimeDefault(window.electronAPI), { delaysMs: [] },
          )
          if (cancelled) return
          if (!runtimeProbe.ok) throw runtimeProbe.error
          if (runtimeProbe.value.status === 'failed') throw new Error(runtimeProbe.value.error)
          if (identity.authority === 'native') {
            // The configuration-only runtime read already supplies this slug;
            // never request host accounts or credentials for a native caller.
            startupConnections = []
            startupDefaultSlug = runtimeProbe.value.slug
            startupRuntimeSummary = runtimeProbe.value.runtimeSummary ?? null
          } else {
            const connectionsProbe = await probeWithRetry(() => window.electronAPI.listLlmConnectionsWithStatus())
            if (cancelled) return
            if (!connectionsProbe.ok) throw connectionsProbe.error
            startupConnections = connectionsProbe.value
            startupDefaultSlug = resolveDefaultConnectionSlug(connectionsProbe.value)
          }
        }
        // Runtime setup and transport recovery can outlive the original actor
        // or window binding. Publish only after current readback matches both.
        const finalIdentityProbe = await probeWithRetry(() => window.electronAPI.getOrgIdentity())
        if (cancelled) return
        if (!finalIdentityProbe.ok) throw finalIdentityProbe.error
        const currentIdentity = finalIdentityProbe.value
        if (!currentIdentity || currentIdentity.userId !== identity.userId
          || currentIdentity.authority !== identity.authority
          || identity.authority === 'native' && currentIdentity.issuer !== identity.issuer) {
          throw new Error('runtime-identity-changed')
        }
        const finalWorkspaceProbe = await probeWithRetry(() => window.electronAPI.getWindowWorkspace())
        if (cancelled) return
        if (!finalWorkspaceProbe.ok) throw finalWorkspaceProbe.error
        if (finalWorkspaceProbe.value !== workspaceProbe.value) throw new Error('runtime-workspace-changed')
        const finalStartupState = decideStartupAppState({ identityProbe: finalIdentityProbe, workspaceProbe: finalWorkspaceProbe })
        if (finalStartupState === 'transport-unavailable'
          || startupState === 'onboarding' && finalStartupState !== 'onboarding') {
          // A newly completed profile needs a fresh pass through runtime setup.
          throw new Error('runtime-profile-changed')
        }
        setCallerAuthority(identity.authority)
        setWindowWorkspaceId(workspaceProbe.value)
        setSetupNeeds(startupSetupNeeds)
        if (startupConnections !== null && finalStartupState !== 'onboarding') {
          setLlmConnections(startupConnections)
          setRuntimeSummary(startupRuntimeSummary)
          setDefaultLlmConnectionSlug(startupDefaultSlug)
          if (startupRuntimeSummary) setWorkspaceDefaultLlmConnection(startupRuntimeSummary.slug)
        }
        setAppState(finalStartupState)
      } catch (error) {
        if (cancelled) return
        if (webTransportBootstrap) {
          setCallerAuthority(null)
          setStartupBootstrapError(error instanceof Error ? error.message : String(error))
          setAppState('transport-unavailable')
          return
        }
        console.error('Failed to check auth state:', error)
        setCallerAuthority(null)
        setStartupBootstrapError(error instanceof Error ? error.message : String(error))
        setAppState('transport-unavailable')
      }
    }

    void initialize()
    return () => { cancelled = true }
  }, [resolveDefaultConnectionSlug, t, webTransportBootstrap, markHostSessionsUnavailable, startupAttempt])

  // Session selection state
  const [sessionSelection, setSession] = useSession()

  // Notification system - shows native OS notifications and badge count
  const handleNavigateToSession = useCallback((sessionId: string) => {
    // Navigate to the session via central routing (uses allSessions filter)
    navigate(routes.view.allSessions(sessionId))
  }, [])

  const { isWindowFocused, showSessionNotification } = useNotifications({
    workspaceId: windowWorkspaceId,
    // NOTE: sessions removed - hook now uses sessionMetaMapAtom internally
    // to prevent closures from retaining full message arrays
    onNavigateToSession: handleNavigateToSession,
    enabled: notificationsEnabled,
  })

  // Load workspaces, sessions, model, notifications setting, and drafts when app is ready
  useEffect(() => {
    if (appState !== 'ready' || callerAuthority === null) return

    window.electronAPI.getWorkspaces().then(setWorkspaces).catch(() => {})
    if (callerAuthority === 'native') {
      void refreshLlmConnections().catch(() => {})
      // The native handler returns only this actor's authorized workspace sessions.
      void loadSessionsFromServer()
      return
    }
    window.electronAPI.getNotificationsEnabled().then(setNotificationsEnabled).catch(() => {})

    // Show actionable toast for missing system dependencies (Windows only)
    window.electronAPI.getSystemWarnings().then((warnings) => {
      if (warnings.vcredistMissing) {
        toast.warning(t('toast.vcRedistNotFound'), {
          description: t('toast.vcRedistNotFoundDesc'),
          duration: Infinity,
          action: {
            label: 'Install',
            onClick: () => window.electronAPI.openUrl(warnings.downloadUrl ?? 'https://aka.ms/vs/17/release/vc_redist.x64.exe'),
          },
        })
      }
    }).catch(() => { /* non-fatal startup check */ })
    void loadSessionsFromServer()
    // Load LLM connections with authentication status
    window.electronAPI.listLlmConnectionsWithStatus().then((connections) => {
      setLlmConnections(connections)
      setDefaultLlmConnectionSlug(resolveDefaultConnectionSlug(connections))
    })
    // Load persisted input drafts into ref (no re-render needed).
    // Attachment files are not read here — hydration happens lazily when the session
    // is opened so app startup isn't delayed by reading potentially large files.
    window.electronAPI.getAllDrafts().then((drafts) => {
      if (Object.keys(drafts).length > 0) {
        sessionDraftsRef.current = new Map(Object.entries(drafts))
      }
    })
    // Load app-level theme
    window.electronAPI.getAppTheme().then(setAppTheme)
  }, [appState, callerAuthority, loadSessionsFromServer, refreshLlmConnections, resolveDefaultConnectionSlug])

  // Subscribe to theme change events (live updates when theme.json changes)
  useEffect(() => {
    const cleanupApp = window.electronAPI.onAppThemeChange((theme) => {
      setAppTheme(theme)
    })
    return () => {
      cleanupApp()
    }
  }, [])

  // Subscribe to LLM connections change events (live updates when models are fetched)
  useEffect(() => {
    const cleanup = window.electronAPI.onLlmConnectionsChanged(() => {
      void refreshLlmConnections().catch(error => console.error('Failed to refresh LLM connections:', error))
    })
    return () => { cleanup() }
  }, [refreshLlmConnections])

  // Refresh LLM connections and workspace default when workspace changes
  useEffect(() => {
    if (windowWorkspaceId) {
      void refreshLlmConnections().catch(error => console.error('Failed to refresh LLM connections:', error))
    }
  }, [windowWorkspaceId, refreshLlmConnections])

  // Listen for session events - uses centralized event processor for consistent state transitions
  //
  // SOURCE OF TRUTH LOGIC:
  // - During streaming (atom.isProcessing = true): Atom is source of truth
  //   All events read from and write to atom. This preserves streaming data.
  // - When not streaming: React state is source of truth
  //   Events read/write React state, which syncs to atoms via useEffect.
  // - Handoff events (complete, error, etc.): End streaming, sync atom → React state
  //
  // This is simpler and more robust than checking event types - we just ask
  // "is this session currently streaming?" and route accordingly.
  useEffect(() => {
    // Handoff events signal end of streaming - need to sync back to React state
    // Also includes todo_state_changed so status updates immediately reflect in sidebar
    // async_operation included so shimmer effect on session titles updates in real-time
    const handoffEventTypes = new Set(['complete', 'error', 'interrupted', 'typed_error', 'session_status_changed', 'session_metadata_changed', 'session_flagged', 'session_unflagged', 'name_changed', 'labels_changed', 'project_id_changed', 'title_generated', 'async_operation'])

    // Helper to handle side effects (same logic for both paths)
    const handleEffects = (effects: Effect[], sessionId: string, eventType: string) => {
      for (const effect of effects) {
        switch (effect.type) {
          case 'permission_request': {
            setPendingPermissions(prevPerms => {
              const next = new Map(prevPerms)
              const existingQueue = next.get(sessionId) || []
              next.set(sessionId, [...existingQueue, effect.request])
              return next
            })

            // Native notification for approval-required pauses (same gating as completion notifications)
            const notifySession = store.get(sessionAtomFamily(sessionId))
            if (notifySession && !notifySession.hidden) {
              const isAdminPrompt = effect.request.type === 'admin_approval'
              const promptBody = isAdminPrompt
                ? `Admin approval required: ${effect.request.appName || effect.request.toolName}`
                : `Permission required: ${effect.request.toolName}`
              showSessionNotification(notifySession, promptBody)
            }
            break
          }
          case 'permission_mode_changed': {
            if (typeof effect.modeVersion === 'number' && effect.changedAt && effect.changedBy) {
              applyPermissionModeState(effect.sessionId, {
                permissionMode: effect.permissionMode,
                modeVersion: effect.modeVersion,
                changedAt: effect.changedAt,
                changedBy: effect.changedBy,
              }, 'event')
            } else {
              // Backward compatibility: apply mode optimistically then reconcile authoritative state.
              setSessionOptions(prevOpts => {
                const next = new Map(prevOpts)
                const current = next.get(effect.sessionId) ?? defaultSessionOptions
                next.set(effect.sessionId, { ...current, permissionMode: effect.permissionMode })
                return next
              })
              void reconcilePermissionModeState(effect.sessionId)
            }
            break
          }
          case 'credential_request': {
            setPendingCredentials(prevCreds => {
              const next = new Map(prevCreds)
              const existingQueue = next.get(sessionId) || []
              next.set(sessionId, [...existingQueue, effect.request])
              return next
            })
            break
          }
          case 'restore_input': {
            // Queued messages were removed from chat on abort — restore their text to the input field.
            // Append to existing draft (user may have started typing) rather than overwrite.
            const existingDraft = sessionDraftsRef.current.get(sessionId)
            const existingText = coerceInputText(existingDraft?.text)
            const restoredText = coerceInputText(effect.text)
            const restored = existingText
              ? `${existingText}\n\n${restoredText}`
              : restoredText
            handleInputChange(sessionId, restored)
            // handleInputChange updates the ref but ChatPage has local state.
            // Dispatch a custom event so ChatPage re-reads the draft.
            window.dispatchEvent(new CustomEvent('craft:restore-input', {
              detail: { sessionId, text: restored },
            }))
            break
          }
          case 'toast_error': {
            toast.error(effect.message, { duration: 5000 })
            break
          }
        }
      }

      // Clear pending permissions and credentials on complete
      if (eventType === 'complete') {
        setPendingPermissions(prevPerms => {
          if (prevPerms.has(sessionId)) {
            const next = new Map(prevPerms)
            next.delete(sessionId)
            return next
          }
          return prevPerms
        })
        setPendingCredentials(prevCreds => {
          if (prevCreds.has(sessionId)) {
            const next = new Map(prevCreds)
            next.delete(sessionId)
            return next
          }
          return prevCreds
        })
      }
    }

    const eventScope = sessionScopeRef.current
    const cleanup = window.electronAPI.onSessionEvent((event: SessionEvent) => {
      const scope = eventScope
      if (sessionScopeRef.current !== scope || !scope.authority || scope.workspaceId !== windowWorkspaceId) return
      if (!('sessionId' in event)) return

      const sessionId = event.sessionId
      const workspaceId = windowWorkspaceId ?? ''

      // Session lifecycle events are handled explicitly (not by the agent event processor).
      if (event.type === 'session_created') {
        window.electronAPI.getSessionMessages(sessionId)
          .then((createdSession: Session | null) => {
            if (sessionScopeRef.current !== scope) return
            if (createdSession) {
              if (scope.authority === 'native' && createdSession.workspaceId !== scope.workspaceId) return
              const existingMeta = store.get(sessionMetaMapAtom).has(sessionId)
              if (existingMeta) {
                replaceLoadedSession(createdSession)
              } else {
                addSession(createdSession)
              }
              syncSessionOptionsFromSession(createdSession)
              return
            }
            return readCallerSessionInventory().then(inventory => {
              if (inventory.kind === 'available' && sessionScopeRef.current === scope) initializeSessions(inventory.sessions)
            })
          })
          .catch((error: unknown) => console.error('Failed to handle session_created event:', error))
        return
      }

      if (event.type === 'session_deleted') {
        removeSession(sessionId)
        return
      }

      if (event.type === 'messages_replaced') {
        window.electronAPI.getSessionMessages(sessionId)
          .then((updatedSession) => {
            if (sessionScopeRef.current === scope && updatedSession
              && (scope.authority !== 'native' || updatedSession.workspaceId === scope.workspaceId)) replaceLoadedSession(updatedSession)
          })
          .catch((error: unknown) => console.error('Failed to refresh messages after undo:', error))
        return
      }

      const agentEvent = event as unknown as AgentEvent

      // Track activity for stale session watchdog
      trackSessionActivity(sessionId)

      // Dispatch window event when compaction completes
      // This allows FreeFormInput to sequence the plan execution message after compaction
      // Note: markCompactionComplete is called on the backend (sessions.ts) to ensure
      // it happens even if CMD+R occurs during compaction
      if (event.type === 'info' && event.statusType === 'compaction_complete') {
        window.dispatchEvent(new CustomEvent('craft:compaction-complete', {
          detail: { sessionId }
        }))
      }

      // Check if session is currently streaming (atom is source of truth)
      const atomSession = store.get(sessionAtomFamily(sessionId))
      const isStreaming = atomSession?.isProcessing === true
      const isHandoff = handoffEventTypes.has(event.type)

      // During streaming OR for handoff events: use atom as source of truth
      // This ensures all events during streaming see the complete state
      if (isStreaming || isHandoff) {
        const currentSession = atomSession ?? null

        // Process the event
        const { session: updatedSession, effects } = processAgentEvent(
          agentEvent,
          currentSession,
          workspaceId
        )

        // Update atom directly (UI sees update immediately)
        updateSessionDirect(sessionId, () => updatedSession)

        // Handle side effects
        handleEffects(effects, sessionId, event.type)

        // Handle background task events
        handleBackgroundTaskEvent(store, sessionId, event, agentEvent)

        // For handoff events, update metadata map for list display
        if (isHandoff) {
          // Update metadata map
          const metaMap = store.get(sessionMetaMapAtom)
          const prevMeta = metaMap.get(sessionId)
          const newMetaMap = new Map(metaMap)
          const nextMeta = extractSessionMeta(updatedSession)
          newMetaMap.set(sessionId, nextMeta)
          store.set(sessionMetaMapAtom, newMetaMap)

          // Agent/automation flipped status → light sidebar unseen accent.
          if (
            event.type === 'session_status_changed' &&
            nextMeta.sessionStatus &&
            nextMeta.sessionStatus !== prevMeta?.sessionStatus &&
            nextMeta.workspaceId
          ) {
            markStatusUnseen(nextMeta.workspaceId, nextMeta.sessionStatus)
          }

          // Show notification on complete (when window is not focused).
          // Skip hidden sessions (mini-agent sessions) - they shouldn't trigger notifications.
          // Gate on reason + didReceiveNewFinalMessage so error/interrupt cleanup
          // events don't fire success-style notifications previewing stale or
          // never-persisted content (#664). Both fields are optional — when
          // absent (older backends) treat as success to preserve prior behavior.
          if (event.type === 'complete' && !updatedSession.hidden) {
            const completeEvent = event as { reason?: string; didReceiveNewFinalMessage?: boolean }
            const isSuccessfulCompletion =
              (completeEvent.reason === undefined || completeEvent.reason === 'complete') &&
              completeEvent.didReceiveNewFinalMessage !== false

            if (isSuccessfulCompletion) {
            // Get the last assistant/plan message as preview
            const lastMessage = updatedSession.messages.findLast(
              m => (m.role === 'assistant' || m.role === 'plan') && !m.isIntermediate
            )
            // Strip markdown so OS notifications display clean plain text
            const rawPreview = lastMessage?.content?.substring(0, 200) || undefined
            const preview = rawPreview ? stripMarkdown(rawPreview).substring(0, 100) || undefined : undefined
            showSessionNotification(updatedSession, preview)

            // In-app complement to the OS notification: when a *background*
            // session (one not shown in any open panel) finishes, queue a chip
            // above the chat. The OS notification above is suppressed while the
            // window is focused, so the chip is the only completion signal then.
            if (
              store.get(showBackgroundFinishedChipAtom) &&
              !store.get(visibleSessionIdsAtom).has(sessionId)
            ) {
              store.set(pushBackgroundFinishedAtom, {
                sessionId,
                title: getSessionTitle(updatedSession),
                finishedAt: Date.now(),
              })
            }
            }

          }
        }

        return
      }

      // Not streaming: use per-session atoms directly (no sessionsAtom)
      const currentSession = store.get(sessionAtomFamily(sessionId))

      const { session: updatedSession, effects } = processAgentEvent(
        agentEvent,
        currentSession,
        workspaceId
      )

      // Handle side effects
      handleEffects(effects, sessionId, event.type)

      // Handle background task events
      handleBackgroundTaskEvent(store, sessionId, event, agentEvent)

      // Update per-session atom
      updateSessionDirect(sessionId, () => updatedSession)

      // Update metadata map
      const metaMap = store.get(sessionMetaMapAtom)
      const newMetaMap = new Map(metaMap)
      newMetaMap.set(sessionId, extractSessionMeta(updatedSession))
      store.set(sessionMetaMapAtom, newMetaMap)
    })

    return cleanup
  }, [
    processAgentEvent,
    callerAuthority,
    trackSessionActivity,
    windowWorkspaceId,
    store,
    updateSessionDirect,
    replaceLoadedSession,
    showSessionNotification,
    initializeSessions,
    addSession,
    removeSession,
    syncSessionOptionsFromSession,
    applyPermissionModeState,
    reconcilePermissionModeState,
    readCallerSessionInventory,
  ])

  useEffect(() => {
    const cleanup = window.electronAPI.onSessionsBulkChanged((event) => {
      if (event.workspaceId !== windowWorkspaceId) return
      // The originating call performs an authoritative read after its result.
      // Ignore its earlier coalesced push so it cannot clobber a newer local
      // optimistic operation on an overlapping session.
      if (collectionBulkOperationRegistry.hasCurrentTargets()) return
      void refreshSessionListMetadataFromServer({
        removeMissing: false,
        reason: 'bulk-changed',
      })
    })

    return cleanup
  }, [refreshSessionListMetadataFromServer, windowWorkspaceId])

  // Transport reconnect recovery — refresh session metadata plus active/processing
  // session content after stale reconnects.
  useEffect(() => {
    const cleanup = window.electronAPI.onReconnected(async (isStale: boolean) => {
      if (!isStale) {
        // Server replayed buffered events — we're caught up, nothing to do
        console.info('[App] Reconnected with event replay — no refresh needed')
        return
      }

      console.warn('[App] Stale reconnect — refreshing session metadata and active/processing sessions')

      const refreshedMetaMap = await refreshSessionListMetadataFromServer({
        removeMissing: false,
        reason: 'stale-reconnect',
        selectedSessionId: sessionSelection.selected,
      })
      const metaMap = refreshedMetaMap ?? store.get(sessionMetaMapAtom)
      const refreshIds = getSessionsToRefreshAfterStaleReconnect(metaMap, sessionSelection.selected)

      console.info(`[App] Stale reconnect — refreshing ${refreshIds.length} session(s):`, refreshIds)

      // Refresh full message content only for the active session plus any
      // session still marked processing after the metadata refresh.
      for (const sessionId of refreshIds) {
        let refreshResult = await refreshSessionFromServer(sessionId)
        if (refreshResult !== 'refreshed') {
          // Server may need time to restart session subprocess after reconnect,
          // or it may still be lazily loading session messages.
          for (const delay of [2000, 4000]) {
            console.warn(`[App] Retrying session refresh for ${sessionId} after ${delay}ms (${refreshResult})`)
            await new Promise(r => setTimeout(r, delay))
            refreshResult = await refreshSessionFromServer(sessionId)
            if (refreshResult === 'refreshed') break
          }
        }
      }

      // Final fallback: if the active session is still empty, force a reload
      // even when the session is already marked loaded.
      if (sessionSelection.selected) {
        const session = store.get(sessionAtomFamily(sessionSelection.selected))
        if (session && (!session.messages || session.messages.length === 0)) {
          console.warn('[App] Active session still has no messages after stale reconnect refresh — forcing message reload')
          await store.set(forceSessionMessagesReloadAtom, sessionSelection.selected)
        } else if (session) {
          console.info(`[App] Stale reconnect recovery complete — active session has ${session.messages?.length ?? 0} messages`)
        }
      }

    })

    return cleanup
  }, [store, sessionSelection.selected, refreshSessionFromServer, refreshSessionListMetadataFromServer])

  // Listen for menu bar events
  useEffect(() => {
    const unsubNewChat = window.electronAPI.onMenuNewChat(() => {
      setMenuNewChatTrigger(n => n + 1)
    })
    const unsubSettings = window.electronAPI.onMenuOpenSettings(() => {
      handleOpenSettings()
    })
    const unsubShortcuts = window.electronAPI.onMenuKeyboardShortcuts(() => {
      navigate(routes.view.settings('shortcuts'))
    })
    return () => {
      unsubNewChat()
      unsubSettings()
      unsubShortcuts()
    }
  }, [])

  const handleCreateSession = useCallback(async (workspaceId: string, options?: import('../shared/types').CreateSessionOptions): Promise<Session> => {
    const scope = sessionScopeRef.current
    const session = await window.electronAPI.createSession(workspaceId, options)
    if (sessionScopeRef.current !== scope || scope.authority === 'native' && (workspaceId !== scope.workspaceId || session.workspaceId !== scope.workspaceId)) {
      throw new Error('session-workspace-changed')
    }
    // Add to per-session atom and metadata map (no sessionsAtom)
    addSession(session)
    syncSessionOptionsFromSession(session)

    return session
  }, [addSession, syncSessionOptionsFromSession])

  const firstSessionAttemptedRef = useRef(false)
  const firstSessionMountedRef = useRef(true)
  useEffect(() => {
    firstSessionMountedRef.current = true
    return () => { firstSessionMountedRef.current = false }
  }, [])
  useEffect(() => {
    if (appState !== 'ready' || !sessionsLoaded || sessionLoadError || callerAuthority !== 'local'
      || !windowWorkspaceId || initialSessionId || webTransportBootstrap || firstSessionAttemptedRef.current) return
    const workspace = workspaces.find(item => item.id === windowWorkspaceId)
    if (!workspace || workspace.remoteServer) return
    firstSessionAttemptedRef.current = true
    const initialUrl = window.location.href
    void openFirstSessionWelcome({
      workspaceId: windowWorkspaceId,
      isCurrent: () => firstSessionMountedRef.current && callerAuthorityRef.current === 'local'
        && store.get(windowWorkspaceIdAtom) === windowWorkspaceId,
      getWindowWorkspace: () => window.electronAPI.getWindowWorkspace(),
      ensureWelcome: id => window.electronAPI.ensureFirstSessionWelcome(id),
      onSession: session => {
        addSession(session)
        syncSessionOptionsFromSession(session)
      },
      onOpen: id => {
        if (window.location.href === initialUrl) navigate(routes.view.allSessions(id))
      },
    }).catch(error => {
      // A greeting must never gate opening the app or starting an ordinary chat.
      console.warn('[App] Could not open the first-session welcome:', error)
    })
  }, [appState, sessionsLoaded, sessionLoadError, callerAuthority, windowWorkspaceId, initialSessionId,
    webTransportBootstrap, workspaces, addSession, syncSessionOptionsFromSession, store])

  // Deep link navigation is initialized later after handleInputChange is defined

  const handleDeleteSession = useCallback(async (sessionId: string, skipConfirmation = false): Promise<boolean> => {
    // Show confirmation dialog before deleting (unless skipped or session is empty)
    if (!skipConfirmation) {
      // Check if session has any messages using session metadata from Jotai store
      // We use store.get() instead of closing over sessions to prevent memory leaks
      // (closures would retain the full sessions array with all messages)
      const metaMap = store.get(sessionMetaMapAtom)
      const meta = metaMap.get(sessionId)
      // Session is empty if it has no lastFinalMessageId (no assistant responses) and no name (set on first user message)
      const isEmpty = !meta || (!meta.lastFinalMessageId && !meta.name)

      if (!isEmpty) {
        const confirmed = await window.electronAPI.showDeleteSessionConfirmation(meta?.name || 'Untitled')
        if (!confirmed) return false
      }
    }

    await window.electronAPI.deleteSession(sessionId)
    // Remove from per-session atom and metadata map (no sessionsAtom)
    removeSession(sessionId)
    return true
  }, [store, removeSession])

  // Auto-delete handler for empty sessions (fire-and-forget, no confirmation)
  const handleAutoDeleteEmptySession = useCallback((sessionId: string) => {
    window.electronAPI.deleteSession(sessionId)
    removeSession(sessionId)
  }, [removeSession])

  const handleFlagSession = useCallback((sessionId: string) => {
    updateSessionById(sessionId, { isFlagged: true })
    window.electronAPI.sessionCommand(sessionId, { type: 'flag' })
  }, [updateSessionById])

  const handleUnflagSession = useCallback((sessionId: string) => {
    updateSessionById(sessionId, { isFlagged: false })
    window.electronAPI.sessionCommand(sessionId, { type: 'unflag' })
  }, [updateSessionById])

  const handleArchiveSession = useCallback((sessionId: string) => {
    updateSessionById(sessionId, { isArchived: true, archivedAt: Date.now() })
    window.electronAPI.sessionCommand(sessionId, { type: 'archive' })
  }, [updateSessionById])

  const handleUnarchiveSession = useCallback((sessionId: string) => {
    updateSessionById(sessionId, { isArchived: false, archivedAt: undefined })
    window.electronAPI.sessionCommand(sessionId, { type: 'unarchive' })
  }, [updateSessionById])

  /**
   * Set which session user is actively viewing (for unread state machine).
   * Called when user navigates to a session. Main process uses this to determine
   * whether to mark new assistant messages as unread.
   */
  const handleSetActiveViewingSession = useCallback((sessionId: string) => {
    // Optimistic UI update: clear hasUnread immediately
    updateSessionById(sessionId, { hasUnread: false })
    // Tell main process user is viewing this session
    window.electronAPI.sessionCommand(sessionId, { type: 'setActiveViewing', workspaceId: windowWorkspaceId ?? '' })
  }, [updateSessionById, windowWorkspaceId])

  const handleMarkSessionRead = useCallback((sessionId: string) => {
    // Update hasUnread flag (primary source of truth for NEW badge)
    // Also update lastReadMessageId for backwards compatibility
    updateSessionById(sessionId, (s) => {
      const lastFinalId = s.messages.findLast(
        m => (m.role === 'assistant' || m.role === 'plan') && !m.isIntermediate
      )?.id
      return {
        hasUnread: false,
        ...(lastFinalId ? { lastReadMessageId: lastFinalId } : {}),
      }
    })
    window.electronAPI.sessionCommand(sessionId, { type: 'markRead' })
  }, [updateSessionById])

  const handleMarkSessionUnread = useCallback((sessionId: string) => {
    // Set hasUnread flag (primary source of truth for NEW badge)
    updateSessionById(sessionId, { hasUnread: true, lastReadMessageId: undefined })
    window.electronAPI.sessionCommand(sessionId, { type: 'markUnread' })
  }, [updateSessionById])

  const handleSessionStatusChange = useCallback((sessionId: string, state: SessionStatus) => {
    const prev = store.get(sessionMetaMapAtom).get(sessionId)
    updateSessionById(sessionId, { sessionStatus: state })
    window.electronAPI.sessionCommand(sessionId, { type: 'setSessionStatus', state })
    // Sidebar unseen dot when the session moves into a different status bucket.
    // (updateSessionById → extractSessionMeta path does not go through updateSessionMetaAtom.)
    if (prev?.workspaceId && prev.sessionStatus !== state) {
      markStatusUnseen(prev.workspaceId, state)
    }
  }, [updateSessionById, store])

  const handleRenameSession = useCallback((sessionId: string, name: string) => {
    updateSessionById(sessionId, { name })
    window.electronAPI.sessionCommand(sessionId, { type: 'rename', name })
  }, [updateSessionById])

  const handleSendMessage = useCallback(async (sessionId: string, message: string, attachments?: FileAttachment[], skillSlugs?: string[], externalBadges?: ContentBadge[]) => {
    const scope = sessionScopeRef.current
    try {
      if (!scope.authority || scope.authority === 'native' && (!scope.workspaceId
        || store.get(sessionMetaMapAtom).get(sessionId)?.workspaceId !== scope.workspaceId)) {
        throw new Error('session-workspace-unavailable')
      }
      if (scope.authority === 'native' && attachments?.length) throw new Error('attachment-upload-unavailable')
      // Capture pre-send processing state so we can flag mid-stream sends
      // for the queued badge (#616 follow-up — covers Pi steer path which
      // returns status 'accepted', not 'queued').
      const sendingMidStream = store.get(sessionAtomFamily(sessionId))?.isProcessing === true

      // Step 1: Store attachments and get persistent metadata
      let storedAttachments: StoredAttachment[] | undefined
      let processedAttachments: FileAttachment[] | undefined

      if (attachments?.length) {
        // Store each attachment to disk (generates thumbnails, converts Office→markdown)
        // Use allSettled so one failure doesn't kill all attachments
        const storeResults = await Promise.allSettled(
          attachments.map(a => window.electronAPI.storeAttachment(sessionId, a))
        )

        // Filter successful stores, warn about failures
        storedAttachments = []
        const successfulAttachments: FileAttachment[] = []
        storeResults.forEach((result, i) => {
          if (result.status === 'fulfilled') {
            storedAttachments!.push(result.value)
            successfulAttachments.push(attachments[i])
          } else {
            console.warn(`Failed to store attachment "${attachments[i].name}":`, result.reason)
          }
        })

        // Notify user about failed attachments
        const failedCount = storeResults.filter(r => r.status === 'rejected').length
        if (failedCount > 0) {
          console.warn(`${failedCount} attachment(s) failed to store`)
          // Add warning message to session so user knows some attachments weren't included
          const failedNames = attachments
            .filter((_, i) => storeResults[i].status === 'rejected')
            .map(a => a.name)
            .join(', ')
          updateSessionById(sessionId, (s) => ({
            messages: [...s.messages, {
              id: generateMessageId(),
              role: 'warning' as const,
              content: `⚠️ ${failedCount} attachment(s) could not be stored and will not be sent: ${failedNames}`,
              timestamp: Date.now()
            }]
          }))
        }

        // Step 2: Create processed attachments for Claude
        // - Office files: Convert to text with markdown content
        // - Others: Use original FileAttachment
        // - All: Include storedPath so agent knows where files are stored
        // - Resized images: Use resizedBase64 instead of original large base64
        processedAttachments = await Promise.all(
          successfulAttachments.map(async (att, i) => {
            const stored = storedAttachments?.[i]
            if (!stored) {
              console.error(`Missing stored attachment at index ${i}`)
              return att // Fall back to original
            }
            // Include storedPath and markdownPath for all attachment types
            // Agent will use Read tool to access text/office files via these paths
            // If image was resized, use the resized base64 for Claude API
            return {
              ...att,
              storedPath: stored.storedPath,
              markdownPath: stored.markdownPath,
              // Use resized base64 if available (for images that exceeded size limits)
              base64: stored.resizedBase64 ?? att.base64,
            }
          })
        )
      }

      // Step 3: Extract badges from mentions (sources/skills) with embedded icons
      // Badges are self-contained for display in UserMessageBubble and viewer
      // Merge with any externally provided badges (e.g., from EditPopover context badges)
      // Use workspace slug (not UUID) for skill qualification - SDK expects "workspaceSlug:skillSlug"
      const mentionBadges: ContentBadge[] = windowWorkspaceSlug
        ? extractBadges(message, skills, sources, windowWorkspaceSlug)
        : []
      const badges: ContentBadge[] = [...(externalBadges || []), ...mentionBadges]

      // Step 4.1: Detect SDK slash commands (e.g., /compact) and create command badges
      // This makes /compact render as an inline badge rather than raw text
      const commandMatch = message.match(/^\/([a-z]+)(\s|$)/i)
      if (commandMatch && commandMatch[1].toLowerCase() === 'compact') {
        const commandText = commandMatch[0].trimEnd() // "/compact" without trailing space
        badges.unshift({
          type: 'command',
          label: 'Compact',
          rawText: commandText,
          start: 0,
          end: commandText.length,
        })
      }

      // Step 4.2: Detect plan execution messages and create file badges
      // Pattern: "Read the plan at <path> and execute it."
      // This is sent after compaction when accepting a plan, displays as clickable file badge
      // Only the file path is replaced with a badge - surrounding text remains visible
      const planExecuteMatch = message.match(/^(Read the plan at )(.+?)( and execute it\.?)$/i)
      if (planExecuteMatch) {
        const prefix = planExecuteMatch[1]      // "Read the plan at "
        const filePath = planExecuteMatch[2]    // the actual path
        const fileName = filePath.split('/').pop() || 'plan.md'
        badges.push({
          type: 'file',
          label: fileName,
          rawText: filePath,
          filePath: filePath,
          start: prefix.length,
          end: prefix.length + filePath.length,
        })
      }

      if (sessionScopeRef.current !== scope) return
      // Native sends carry text and actor-scoped skill references; local badges may
      // contain host file paths and are not part of the native transport contract.
      const persistedBadges = scope.authority === 'native' ? undefined : badges.length > 0 ? badges : undefined

      // Step 5: Create user message with StoredAttachments (for UI display)
      // Mark as isPending for optimistic UI — will be confirmed by user_message
      // event. Flag mid-stream sends as queued so the bubble renders with the
      // dashed-draft treatment immediately. Applies to both backends:
      // Pi steers (server emits status: 'accepted' but the renderer preserves
      // isQueued through that update) and Claude queues (server emits 'queued'
      // which confirms it). Cleared by 'processing' status or when the current
      // turn ends.
      const userMessage: Message = {
        id: generateMessageId(),
        role: 'user',
        content: message,
        timestamp: Date.now(),
        attachments: storedAttachments,
        badges: persistedBadges,
        isPending: true,  // Optimistic - will be confirmed by backend
        isQueued: sendingMidStream,
      }

      // Optimistic UI update - add user message and set processing state
      updateSessionById(sessionId, (s) => ({
        messages: [...s.messages, userMessage],
        isProcessing: true,
        lastMessageAt: Date.now()
      }))

      // Step 6: Send to Claude with processed attachments + stored attachments for persistence
      await window.electronAPI.sendMessage(sessionId, message, processedAttachments, storedAttachments, {
        skillSlugs,
        badges: persistedBadges,
        optimisticMessageId: userMessage.id,
      })
    } catch (error) {
      console.error('Failed to send message:', error)
      if (sessionScopeRef.current !== scope) return
      cancelChatUserTurn(sessionId)
      updateSessionById(sessionId, (s) => ({
        isProcessing: false,
        messages: [
          ...s.messages,
          {
            id: generateMessageId(),
            role: 'error' as const,
            content: t('chat.failedToSendMessage', {
              error: scope.authority === 'native' ? t('toast.unknownError') : error instanceof Error ? error.message : t('toast.unknownError'),
            }),
            timestamp: Date.now()
          }
        ]
      }))
    }
  }, [sessionOptions, updateSessionById, skills, sources, windowWorkspaceId, t])

  /**
   * Unified handler for all session option changes.
   * Handles persistence and backend sync for each option type.
   */
  const handleSessionOptionsChange = useCallback((sessionId: string, updates: SessionOptionUpdates) => {
    const previous = sessionOptionsRef.current.get(sessionId) ?? defaultSessionOptions
    const optimistic = new Map(sessionOptionsRef.current)
    optimistic.set(sessionId, mergeSessionOptions(previous, updates))
    sessionOptionsRef.current = optimistic
    setSessionOptions(prev => {
      const next = new Map(prev)
      const current = next.get(sessionId) ?? defaultSessionOptions
      next.set(sessionId, mergeSessionOptions(current, updates))
      return next
    })

    // Handle persistence/backend for specific options
    if (updates.permissionMode !== undefined) {
      const requestedMode = updates.permissionMode
      const requestAuthority = callerAuthorityRef.current
      const previousRequest = permissionModeRequestsRef.current.get(sessionId)
      const requestId = (previousRequest?.requestId ?? 0) + 1
      permissionModeRequestsRef.current.set(sessionId, {
        requestId, pending: true,
        rollbackMode: previousRequest?.pending ? previousRequest.rollbackMode : previous.permissionMode,
        rollbackVersion: previousRequest?.pending ? previousRequest.rollbackVersion : previous.permissionModeVersion,
      })
      const isCurrent = () => permissionModeRequestsRef.current.get(sessionId)?.requestId === requestId
        && callerAuthorityRef.current === requestAuthority && sessionOptionsRef.current.has(sessionId)
      void (async () => {
        try {
          await window.electronAPI.sessionCommand(sessionId, { type: 'setPermissionMode', mode: requestedMode })
          if (isCurrent()) await reconcilePermissionModeState(sessionId, isCurrent)
        } catch (error) {
          if (!isCurrent()) return
          const authoritative = await reconcilePermissionModeState(sessionId, isCurrent)
          if (!isCurrent()) return
          const rollback = permissionModeRequestsRef.current.get(sessionId)!
          if (!authoritative || authoritative.modeVersion < (rollback.rollbackVersion ?? -1)) {
            // No readback is available. Restore only our pending optimistic mode;
            // an authoritative event with a newer version must keep its value.
            setSessionOptions(prev => {
              const current = prev.get(sessionId) ?? defaultSessionOptions
              if (current.permissionMode !== requestedMode || (current.permissionModeVersion ?? -1) > (rollback.rollbackVersion ?? -1)) return prev
              const next = new Map(prev)
              next.set(sessionId, { ...current, permissionMode: rollback.rollbackMode, permissionModeVersion: rollback.rollbackVersion })
              return next
            })
          }
          toast.error(t('toast.failedToChangePermissionMode'), {
            description: error instanceof Error ? error.message : t('toast.unknownError'),
          })
        } finally {
          const current = permissionModeRequestsRef.current.get(sessionId)
          if (current?.requestId === requestId) permissionModeRequestsRef.current.set(sessionId, { ...current, pending: false })
        }
      })()
    }
    if (updates.thinkingLevel !== undefined) {
      // Sync thinking level change with backend (session-level, persisted)
      window.electronAPI.sessionCommand(sessionId, { type: 'setThinkingLevel', level: updates.thinkingLevel })
    }
  }, [reconcilePermissionModeState, t])

  // Handle input draft changes per session with debounced persistence
  const draftSaveTimeoutRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  // Cleanup draft save timers on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      draftSaveTimeoutRef.current.forEach(clearTimeout)
      draftSaveTimeoutRef.current.clear()
    }
  }, [])

  // Getter for draft text - reads from ref without triggering re-renders
  const getDraft = useCallback((sessionId: string): string => {
    const draft = sessionDraftsRef.current.get(sessionId) as unknown
    const text = draft && typeof draft === 'object'
      ? (draft as { text?: unknown }).text
      : draft
    return coerceInputText(text)
  }, [])

  // Getter for persisted attachment refs (path + name only — not hydrated files).
  // Consumers that need FileAttachment objects should call hydrateDraftAttachments.
  const getDraftAttachmentRefs = useCallback((sessionId: string): DraftAttachmentRef[] => {
    const attachments = sessionDraftsRef.current.get(sessionId)?.attachments
    return Array.isArray(attachments) ? attachments : []
  }, [])

  // Hydrate persisted attachment refs into full FileAttachment objects.
  //  - Track C (ref.content set): reconstruct directly from the inlined bytes.
  //  - Track P (path-only): re-read from disk via the readUserAttachment RPC.
  // Missing/moved files on Track P are silently dropped with a console warn — same
  // UX as any other editor draft restore when the backing file is gone.
  const hydrateDraftAttachments = useCallback(async (sessionId: string): Promise<FileAttachment[]> => {
    const attachments = sessionDraftsRef.current.get(sessionId)?.attachments
    const refs = Array.isArray(attachments) ? attachments : []
    if (refs.length === 0) return []
    const results = await Promise.all(
      refs.map(async (ref) => {
        if (ref.content) {
          return attachmentFromContentRef(ref)
        }
        try {
          const attachment = await window.electronAPI.readUserAttachment(ref.path)
          if (!attachment) {
            console.warn('[drafts] Attachment missing on restore, dropping:', ref.path)
            return null
          }
          return attachment
        } catch (err) {
          console.warn('[drafts] Failed to restore attachment, dropping:', ref.path, err)
          return null
        }
      })
    )
    return results.filter((a): a is FileAttachment => a !== null)
  }, [])

  // Write a debounced snapshot of the current ref entry to disk.
  const schedulePersistDraft = useCallback((sessionId: string) => {
    const existingTimeout = draftSaveTimeoutRef.current.get(sessionId)
    if (existingTimeout) {
      clearTimeout(existingTimeout)
    }
    const timeout = setTimeout(() => {
      const draft = sessionDraftsRef.current.get(sessionId) ?? { text: '' }
      window.electronAPI.setDraft(sessionId, draft)
      draftSaveTimeoutRef.current.delete(sessionId)
    }, DRAFT_SAVE_DEBOUNCE_MS)
    draftSaveTimeoutRef.current.set(sessionId, timeout)
  }, [])

  const handleInputChange = useCallback((sessionId: string, value: string) => {
    const text = coerceInputText(value)
    const existing = sessionDraftsRef.current.get(sessionId)
    const existingAttachments = Array.isArray(existing?.attachments) ? existing.attachments : []
    const nextDraft: SessionDraft = {
      text,
      ...(existingAttachments.length > 0
        ? { attachments: existingAttachments }
        : {}),
    }
    const isEmpty = !nextDraft.text && (!nextDraft.attachments || nextDraft.attachments.length === 0)
    if (isEmpty) {
      sessionDraftsRef.current.delete(sessionId)
    } else {
      sessionDraftsRef.current.set(sessionId, nextDraft)
    }
    schedulePersistDraft(sessionId)
  }, [schedulePersistDraft])

  const handleAttachmentsChange = useCallback((sessionId: string, attachments: FileAttachment[]) => {
    const existing = sessionDraftsRef.current.get(sessionId)
    const refs: DraftAttachmentRef[] = []
    for (const a of attachments) {
      const ref = toDraftRef(a)
      if (ref) {
        refs.push(ref)
      } else {
        console.warn('[drafts] attachment exceeds per-draft size cap, not persisted:', a.name, a.size)
      }
    }
    const nextDraft: SessionDraft = {
      text: coerceInputText(existing?.text),
      ...(refs.length > 0 ? { attachments: refs } : {}),
    }
    const isEmpty = !nextDraft.text && (!nextDraft.attachments || nextDraft.attachments.length === 0)
    if (isEmpty) {
      sessionDraftsRef.current.delete(sessionId)
    } else {
      sessionDraftsRef.current.set(sessionId, nextDraft)
    }
    schedulePersistDraft(sessionId)
  }, [schedulePersistDraft])

  // Open new chat - creates session and selects it
  // Used by components via AppShellContext and for programmatic navigation
  const openNewChat = useCallback(async (params: NewChatActionParams = {}) => {
    if (!windowWorkspaceId) {
      console.warn('[App] Cannot open new chat: no workspace ID')
      return
    }

    const session = await handleCreateSession(windowWorkspaceId)

    if (params.name) {
      await window.electronAPI.sessionCommand(session.id, { type: 'rename', name: params.name })
    }

    // Navigate to the chat view - this sets both selectedSession and activeView
    navigate(routes.view.allSessions(session.id))

    // Pre-fill input if provided (after a small delay to ensure component is mounted)
    if (params.input) {
      setTimeout(() => handleInputChange(session.id, params.input!), 100)
    }
  }, [windowWorkspaceId, handleCreateSession, handleInputChange])

  const handleRespondToPermission = useCallback(async (
    sessionId: string,
    requestId: string,
    allowed: boolean,
    alwaysAllow: boolean,
    options?: import('../shared/types').PermissionResponseOptions,
  ) => {
    const success = await window.electronAPI.respondToPermission(sessionId, requestId, allowed, alwaysAllow, options)

    if (success) {
      // Remove only the first permission from the queue (the one we just responded to)
      setPendingPermissions(prev => {
        const next = new Map(prev)
        const queue = next.get(sessionId) || []
        const remainingQueue = queue.slice(1) // Remove first item
        if (remainingQueue.length === 0) {
          next.delete(sessionId)
        } else {
          next.set(sessionId, remainingQueue)
        }
        return next
      })
      // Note: No need to force session refresh - per-session atoms update automatically
    } else {
      // Response failed (agent/session gone) - clear the permission anyway
      // to avoid UI being stuck with stale permission
      setPendingPermissions(prev => {
        const next = new Map(prev)
        const queue = next.get(sessionId) || []
        const remainingQueue = queue.slice(1)
        if (remainingQueue.length === 0) {
          next.delete(sessionId)
        } else {
          next.set(sessionId, remainingQueue)
        }
        return next
      })
    }
  }, [])

  const handleRespondToCredential = useCallback(async (sessionId: string, requestId: string, response: CredentialResponse) => {
    const success = await window.electronAPI.respondToCredential(sessionId, requestId, response)

    if (success) {
      // Remove only the first credential from the queue (the one we just responded to)
      setPendingCredentials(prev => {
        const next = new Map(prev)
        const queue = next.get(sessionId) || []
        const remainingQueue = queue.slice(1) // Remove first item
        if (remainingQueue.length === 0) {
          next.delete(sessionId)
        } else {
          next.set(sessionId, remainingQueue)
        }
        return next
      })
      // Note: No need to force session refresh - per-session atoms update automatically
    } else {
      // Response failed (agent/session gone) - clear the credential anyway
      // to avoid UI being stuck with stale credential request
      setPendingCredentials(prev => {
        const next = new Map(prev)
        const queue = next.get(sessionId) || []
        const remainingQueue = queue.slice(1)
        if (remainingQueue.length === 0) {
          next.delete(sessionId)
        } else {
          next.set(sessionId, remainingQueue)
        }
        return next
      })
    }
  }, [])

  // Centralized link interceptor: classifies file types and decides whether to
  // show an in-app preview overlay or open externally. Replaces the old
  // handleOpenFile/handleOpenUrl that always opened in external apps.
  const linkInterceptor = useLinkInterceptor({
    openFileExternal: async (path) => {
      try {
        await window.electronAPI.openFile(path)
      } catch (error) {
        const message = error instanceof Error ? error.message : t('toast.unknownError')
        console.error('Failed to open file:', error)
        toast.error(t('toast.failedToOpenFile'), {
          description: message,
        })
      }
    },
    openUrl: async (url) => {
      try {
        await window.electronAPI.openUrl(url)
      } catch (error) {
        const message = error instanceof Error ? error.message : t('toast.unknownError')
        console.error('Failed to open URL:', error)
        // The blocked-URL classifier already explains WHY and (for file:)
        // points the user at preview blocks. Don't append the generic
        // "use Open File instead" hint when the message already carries
        // that guidance.
        const hasRichGuidance = /URL blocked/.test(message)
        const tail = hasRichGuidance ? '' : `. ${t('toast.localPathUseOpenFile')}`
        toast.error(t('toast.failedToOpenLink'), {
          description: `${message}${tail}`,
        })
      }
    },
    openInAppBrowser: (url) => {
      queueInternalBrowserUrl(url)
      window.dispatchEvent(new CustomEvent('craft:open-vps-browser'))
    },
    showInFolder: async (path) => {
      try {
        await window.electronAPI.showInFolder(path)
      } catch (error) {
        const message = error instanceof Error ? error.message : t('toast.unknownError')
        console.error('Failed to show in folder:', error)
        toast.error(t("toast.failedToReveal", { fileManager: getFileManagerName() }), {
          description: message,
        })
      }
    },
    readFile: (path) => window.electronAPI.readFile(path),
    readFileDataUrl: (path) => window.electronAPI.readFileDataUrl(path),
    readFileBinary: (path) => window.electronAPI.readFileBinary(path),
  })

  const connectionState = useTransportConnectionState()
  // SSH-backed workspace: surface SSH-level status in front of the ws transport
  // so the banner never shows a raw ws error for the (ephemeral) forwarded port.
  const windowSshHostId = useMemo(() => {
    if (!windowWorkspaceId) return null
    const workspace = workspaces.find(w => w.id === windowWorkspaceId)
    return workspace?.remoteServer?.sshHostId ?? null
  }, [windowWorkspaceId, workspaces])
  const sshConnectionStatus = useSshConnectionStatus(windowSshHostId)
  const showTransportConnectionBanner =
    shouldShowTransportConnectionBanner(connectionState) || shouldShowSshBanner(sshConnectionStatus)

  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth)
  useEffect(() => {
    const handleResize = () => setViewportWidth(window.innerWidth)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])
  const showWorkspaceIconRail = !webTransportBootstrap && shouldShowWorkspaceIconRail(workspaceSelectorRail, viewportWidth)

  const handleReconnectTransport = useCallback(() => {
    void window.electronAPI.reconnectTransport().catch((error) => {
      const message = error instanceof Error ? error.message : t('toast.unknownError')
      toast.error(t('toast.reconnectFailed'), { description: message })
    })
  }, [t])

  const handleOpenFile = linkInterceptor.handleOpenFile
  const handleOpenUrl = linkInterceptor.handleOpenUrl

  const handleOpenSettings = useCallback(() => {
    navigate(routes.view.settings())
  }, [])

  const handleOpenKeyboardShortcuts = useCallback(() => {
    setShowShortcuts(true)
  }, [])

  const handleOpenStoredUserPreferences = useCallback(() => {
    navigate(routes.view.settings('context'))
  }, [])

  // Show reset confirmation dialog
  const handleReset = useCallback(() => {
    setShowResetDialog(true)
  }, [])

  // Execute reset after user confirms in dialog
  const executeReset = useCallback(async () => {
    const scope = sessionScopeRef.current
    try {
      await runPersonalTaskScopeTransition(() => window.electronAPI.logout(), () => sessionScopeRef.current === scope, scope)
      // Reset all state
      // Clear session atoms - initialize with empty array clears all per-session atoms
      initializeSessions([])
      setWorkspaces([])
      setWindowWorkspaceId(null)
      // Reset setupNeeds to force fresh onboarding start
      setSetupNeeds({
        needsBillingConfig: true,
        needsCredentials: true,
        isFullyConfigured: false,
      })
      // Reset onboarding hook state
      onboarding.reset()
      setAppState('onboarding')
    } catch (error) {
      console.error('Reset failed:', error)
    } finally {
      setShowResetDialog(false)
    }
  }, [onboarding, initializeSessions])

  // Handle workspace selection
  // - Default: switch workspace in same window (in-window switching)
  // - With openInNewWindow=true: open in new window (or focus existing)
  const handleSelectWorkspace = useCallback(async (workspaceId: string, openInNewWindow = false) => {
    // If selecting current workspace, do nothing
    if (workspaceId === windowWorkspaceId) return

    if (openInNewWindow) {
      // Open (or focus) the window for the selected workspace
      window.electronAPI.openWorkspace(workspaceId)
    } else {
      const scope = sessionScopeRef.current
      // Switch workspace in current window
      // 1. Update the main process's window-workspace mapping
      await runPersonalTaskScopeTransition(() => window.electronAPI.switchWorkspace(workspaceId), () => sessionScopeRef.current === scope, scope)

      // 2. Update React state to trigger re-renders
      setWindowWorkspaceId(workspaceId)

      // 3. Clear selected session - the old session belongs to the previous workspace
      // and should not remain selected when switching to a new workspace.
      // This prevents showing stale session data from the wrong workspace.
      setSession({ selected: null })

      // 4. Clear pending permissions/credentials (not relevant to new workspace)
      setPendingPermissions(new Map())
      setPendingCredentials(new Map())

      // 5. Clear session options from previous workspace
      // (session IDs are unique UUIDs, but clearing prevents unbounded memory growth
      // and ensures no stale state from old workspace persists)
      setSessionOptions(new Map())

      // 6. Clear message drafts from previous workspace
      // (prevents memory growth on repeated workspace switches)
      sessionDraftsRef.current.clear()

      // 7. Reset sources and skills atoms to empty
      // (prevents stale data flash during workspace switch - AppShell will reload)
      store.set(sourcesAtom, [])
      store.set(skillsAtom, [])

      // 8. Clear session atoms BEFORE workspace switch
      // This prevents stale session data from the previous workspace being visible.
      store.set(sessionMetaMapAtom, new Map())
      store.set(sessionIdsAtom, [])

      // Note: NavigationContext detects the workspaceId change and handles
      // panel restoration from the stored workspace URL (or defaults to allSessions).
      // Sessions and theme will reload automatically due to windowWorkspaceId dependency
      // in useEffect hooks.
    }
  }, [windowWorkspaceId, setSession, store])

  // Handle workspace switch by slug (called by NavigationContext on popstate when ?ws= changes)
  const handleSwitchWorkspaceBySlug = useCallback((slug: string) => {
    const target = workspaces.find(w => w.slug === slug)
    if (target) {
      handleSelectWorkspace(target.id)
    }
  }, [workspaces, handleSelectWorkspace])

  // Handle workspace refresh (e.g., after icon upload)
  const handleRefreshWorkspaces = useCallback(() => {
    window.electronAPI.getWorkspaces().then(setWorkspaces)
  }, [])

  // Handle cancel during onboarding
  const handleOnboardingCancel = useCallback(() => {
    onboarding.handleCancel()
  }, [onboarding])

  // Build context value for AppShell component
  // This is memoized to prevent unnecessary re-renders
  // IMPORTANT: Must be before early returns to maintain consistent hook order
  const appShellContextValue = useMemo<AppShellContextType>(() => ({
    // Data
    // NOTE: sessions is NOT included - use sessionMetaMapAtom for listing
    // and useSession(id) hook for individual sessions. This prevents memory leaks.
    workspaces,
    activeWorkspaceId: windowWorkspaceId,
    activeWorkspaceSlug: windowWorkspaceSlug,
    llmConnections,
    runtimeSummary,
    workspaceDefaultLlmConnection,
    refreshLlmConnections,
    pendingPermissions,
    pendingCredentials,
    getDraft,
    getDraftAttachmentRefs,
    hydrateDraftAttachments,
    sessionOptions,
    // Session callbacks
    onCreateSession: handleCreateSession,
    onSendMessage: handleSendMessage,
    onRenameSession: handleRenameSession,
    onFlagSession: handleFlagSession,
    onUnflagSession: handleUnflagSession,
    onArchiveSession: handleArchiveSession,
    onUnarchiveSession: handleUnarchiveSession,
    onMarkSessionRead: handleMarkSessionRead,
    onMarkSessionUnread: handleMarkSessionUnread,
    onSetActiveViewingSession: handleSetActiveViewingSession,
    onSessionStatusChange: handleSessionStatusChange,
    onDeleteSession: handleDeleteSession,
    onRespondToPermission: handleRespondToPermission,
    onRespondToCredential: handleRespondToCredential,
    // File/URL handlers
    onOpenFile: handleOpenFile,
    onOpenUrl: handleOpenUrl,
    // Workspace
    onSelectWorkspace: handleSelectWorkspace,
    onRefreshWorkspaces: handleRefreshWorkspaces,
    // App actions
    onOpenSettings: handleOpenSettings,
    onOpenKeyboardShortcuts: handleOpenKeyboardShortcuts,
    onOpenStoredUserPreferences: handleOpenStoredUserPreferences,
    onReset: handleReset,
    // Session options
    onSessionOptionsChange: handleSessionOptionsChange,
    onInputChange: handleInputChange,
    onAttachmentsChange: handleAttachmentsChange,
    // New chat (via deep link navigation)
    openNewChat,
  }), [
    // NOTE: sessions removed to prevent memory leaks - components use atoms instead
    workspaces,
    windowWorkspaceId,
    windowWorkspaceSlug,
    llmConnections,
    runtimeSummary,
    workspaceDefaultLlmConnection,
    refreshLlmConnections,
    pendingPermissions,
    pendingCredentials,
    getDraft,
    getDraftAttachmentRefs,
    hydrateDraftAttachments,
    sessionOptions,
    handleCreateSession,
    handleSendMessage,
    handleRenameSession,
    handleFlagSession,
    handleUnflagSession,
    handleArchiveSession,
    handleUnarchiveSession,
    handleMarkSessionRead,
    handleMarkSessionUnread,
    handleSetActiveViewingSession,
    handleSessionStatusChange,
    handleDeleteSession,
    handleRespondToPermission,
    handleRespondToCredential,
    handleOpenFile,
    handleOpenUrl,
    handleSelectWorkspace,
    handleRefreshWorkspaces,
    handleOpenSettings,
    handleOpenKeyboardShortcuts,
    handleOpenStoredUserPreferences,
    handleReset,
    handleSessionOptionsChange,
    handleInputChange,
    handleAttachmentsChange,
    openNewChat,
  ])

  // Platform actions for @rox/ui components (overlays, etc.)
  // Memoized to prevent re-renders when these callbacks don't change
  // NOTE: Must be defined before early returns to maintain consistent hook order
  const platformActions = useMemo(() => ({
    onOpenFile: handleOpenFile,
    onOpenUrl: handleOpenUrl,
    // Bypass link interceptor — opens file directly in system editor.
    // Used by overlay header badges (when already viewing a file, "Open" should launch editor).
    onOpenFileExternal: linkInterceptor.openFileExternal,
    // Read file contents as UTF-8 string (used by datatable/spreadsheet/html-preview src fields)
    onReadFile: (path: string) => window.electronAPI.readFile(path),
    // Read file as data URL (used by image-preview blocks)
    onReadFileDataUrl: (path: string) => window.electronAPI.readFileDataUrl(path),
    // Read file as binary Uint8Array (used by PDF preview blocks)
    onReadFileBinary: (path: string) => window.electronAPI.readFileBinary(path),
    // Reveal a file in the system file manager (Finder on macOS, Explorer on Windows, etc.)
    onRevealInFinder: (path: string) => {
      window.electronAPI.showInFolder(path).catch(() => {})
    },
    // Platform-specific file manager name for UI labels
    fileManagerName: getFileManagerName(),
    // Hide/show macOS traffic lights when fullscreen overlays are open
    onSetTrafficLightsVisible: (visible: boolean) => {
      window.electronAPI.setTrafficLightsVisible(visible)
    },
  }), [handleOpenFile, handleOpenUrl, linkInterceptor.openFileExternal])

  // Loading state - show splash screen
  if (appState === 'loading') {
    return <SplashScreen isExiting={false} />
  }

  if (appState === 'transport-unavailable') {
    return (
      <div role="alert" className="flex h-screen flex-col items-center justify-center gap-3 px-4 text-center">
        <h1>{t('webui.connectionFailed')}</h1>
        <p>{startupBootstrapError}</p>
        <button type="button" className="rounded px-3 py-2 hover:bg-muted" onClick={() => {
          setStartupBootstrapError('')
          setAppState('loading')
          setStartupAttempt(attempt => attempt + 1)
        }}>{t('common.retry')}</button>
      </div>
    )
  }

  // Reauth state - session expired, need to re-login
  // ModalProvider + WindowCloseHandler ensures X button works on Windows
  if (appState === 'reauth') {
    return (
      <DismissibleLayerProvider>
        <ModalProvider>
          <WindowCloseHandler />
          <ReauthScreen
            onLogin={handleReauthLogin}
            onReset={handleReauthReset}
          />
          <ResetConfirmationDialog
            open={showResetDialog}
            onConfirm={executeReset}
            onCancel={() => setShowResetDialog(false)}
          />
        </ModalProvider>
      </DismissibleLayerProvider>
    )
  }

  // Onboarding state
  // ModalProvider + WindowCloseHandler ensures X button works on Windows
  // (without this, the close IPC message has no listener and window stays open)
  if (appState === 'onboarding') {
    return (
      <DismissibleLayerProvider>
        <ModalProvider>
          <WindowCloseHandler />
          <OnboardingWizard
            state={onboarding.state}
            onContinue={onboarding.handleContinue}
            onBack={onboarding.handleBack}
            onSelectProvider={onboarding.handleSelectProvider}
            roxConnectCodes={onboarding.roxConnectCodes}
            roxConnectStatus={onboarding.roxConnectStatus}
            roxConnectError={onboarding.roxConnectError}
            roxAuthBaseUrl={onboarding.roxAuthBaseUrl}
            onStartRoxConnect={onboarding.handleStartRoxConnect}
            onOpenRoxConnectBrowser={onboarding.handleOpenRoxConnectBrowser}
            onSelectApiSetupMethod={onboarding.handleSelectApiSetupMethod}
            onSubmitCredential={onboarding.handleSubmitCredential}
            onSubmitOmpCredential={onboarding.handleSubmitOmpCredential}
            onSubmitLocalModel={onboarding.handleSubmitLocalModel}
            onStartOAuth={onboarding.handleStartOAuth}
            onFinish={onboarding.handleFinish}
            isWaitingForCode={onboarding.isWaitingForCode}
            isProviderOAuthPending={onboarding.isProviderOAuthPending}
            onSubmitAuthCode={onboarding.handleSubmitAuthCode}
            onCancelOAuth={onboarding.handleCancelOAuth}
            copilotDeviceCode={onboarding.copilotDeviceCode}
            onBrowseGitBash={onboarding.handleBrowseGitBash}
            onUseGitBashPath={onboarding.handleUseGitBashPath}
            onRecheckGitBash={onboarding.handleRecheckGitBash}
            onClearError={onboarding.handleClearError}
          />
        </ModalProvider>
      </DismissibleLayerProvider>
    )
  }

  // Workspace picker — thin client with no workspace selected
  if (appState === 'workspace-picker') {
    return (
      <DismissibleLayerProvider>
        <ModalProvider>
          <WindowCloseHandler />
          <WorkspacePicker
            onSelectWorkspace={async (id) => {
              const scope = sessionScopeRef.current
              await runPersonalTaskScopeTransition(() => window.electronAPI.switchWorkspace(id), () => sessionScopeRef.current === scope, scope)
              setWindowWorkspaceId(id)
              setAppState('ready')
            }}
          />
        </ModalProvider>
      </DismissibleLayerProvider>
    )
  }

  // Show splash until exit animation completes
  const showSplash = !splashHidden

  // Ready state - main app with splash overlay during data loading
  return (
    <PlatformProvider actions={platformActions}>
    <ShikiThemeProvider shikiTheme={shikiTheme}>
      <ActionRegistryProvider>
      <FocusProvider>
        <DismissibleLayerProvider>
        <ModalProvider>
        <TooltipProvider delayDuration={0}>
        <NavigationProvider
          workspaceId={windowWorkspaceId}
          workspaceSlug={windowWorkspaceSlug}
          onSwitchWorkspaceBySlug={handleSwitchWorkspaceBySlug}
          onCreateSession={handleCreateSession}
          onInputChange={handleInputChange}
          getDraft={getDraft}
          onAutoDeleteEmptySession={handleAutoDeleteEmptySession}
          isReady={appState === 'ready'}
          isSessionsReady={sessionsLoaded}
          remoteWorkspaceId={windowRemoteWorkspaceId}
        >
          {/* Handle window close requests (X button, Cmd+W) - close modal first if open */}
          <WindowCloseHandler />

          {/* W3 Omnibox — unified ⌘K palette (S-04). Renderer hotkey + embedded
              SiYuan webContents ⌘K bridge are both implemented. */}
          <OmniboxHost />
          <SessionSharingHost activeWorkspaceId={windowWorkspaceId} onSwitchWorkspace={handleSelectWorkspace} />

          {/* Splash screen overlay - fades out when fully ready */}
          {showSplash && (
            <SplashScreen
              isExiting={splashExiting}
              onExitComplete={handleSplashExitComplete}
            />
          )}

          {/* Main UI - always rendered, splash fades away to reveal it */}
          <div className="flex h-full text-foreground" data-viewport={viewportBand(viewportWidth)}>
            {showWorkspaceIconRail && !sessionLoadError && (
              <WorkspaceIconRail
                workspaces={workspaces}
                activeWorkspaceId={windowWorkspaceId}
                onSelect={handleSelectWorkspace}
                onWorkspaceCreated={handleRefreshWorkspaces}
              />
            )}
            <div
              className="flex min-w-0 flex-1 flex-col"
              style={{ paddingTop: 'var(--topbar-height)' }}
            >
              {showTransportConnectionBanner && connectionState && (
                <TransportConnectionBanner
                  state={connectionState}
                  sshStatus={sshConnectionStatus}
                  onRetry={handleReconnectTransport}
                />
              )}
              <ToolchainStatusBanner />
              {webTransportBootstrap && (
                <div role="status" data-host-session-capability="unavailable" className="border-b border-border px-4 py-2 text-sm text-muted-foreground">
                  {t('sidebar.allSessions')}: {t('common.unavailable')}
                </div>
              )}
              {sessionLoadError && callerAuthority === 'native' && (
                <div role="alert" className="flex items-center gap-3 border-b border-border bg-muted px-4 py-2 text-sm text-muted-foreground">
                  <span className="min-w-0 flex-1">{sessionLoadError}</span>
                  <button type="button" className="shrink-0 rounded px-2 py-1 hover:bg-background focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                    onClick={() => { void loadSessionsFromServer() }}>{t('common.retry')}</button>
                </div>
              )}
              <div className="min-h-0 flex-1">
                {sessionLoadError && callerAuthority !== 'native' ? (
                  <SessionLoadErrorScreen
                    message={sessionLoadError}
                    onRetry={() => { void loadSessionsFromServer() }}
                  />
                ) : (
                  <AppShell
                    contextValue={appShellContextValue}
                    defaultLayout={[20, 32, 48]}
                    menuNewChatTrigger={menuNewChatTrigger}
                    isFocusedMode={isFocusedMode}
                    showTopBarWorkspaceSelector={!webTransportBootstrap && !showWorkspaceIconRail}
                    topBarLeftInset={getTopBarLeftInset(showWorkspaceIconRail)}
                    workbenchOperatorCapability={true}
                  />
                )}
              </div>
              <ResetConfirmationDialog
                open={showResetDialog}
                onConfirm={executeReset}
                onCancel={() => setShowResetDialog(false)}
              />
              <KeyboardShortcutsDialog
                open={showShortcuts}
                onOpenChange={setShowShortcuts}
              />
            </div>
          </div>

          {/* File preview overlay — rendered by the link interceptor when a previewable file is clicked */}
          {linkInterceptor.previewState && (
            <FilePreviewRenderer
              state={linkInterceptor.previewState}
              onClose={linkInterceptor.closePreview}
              loadDataUrl={linkInterceptor.readFileDataUrl}
              loadPdfData={linkInterceptor.readFileBinary}
              isDark={isDark}
            />
          )}
        </NavigationProvider>
        </TooltipProvider>
        </ModalProvider>
        </DismissibleLayerProvider>
      </FocusProvider>
      </ActionRegistryProvider>
    </ShikiThemeProvider>
    </PlatformProvider>
  )
}

/**
 * Component that handles window close requests.
 * Must be inside ModalProvider to access the modal registry.
 */
function WindowCloseHandler() {
  useWindowCloseHandler()
  return null
}

/**
 * FilePreviewRenderer - Routes file preview state to the correct overlay component.
 *
 * Handles all preview types from the link interceptor:
 * - image → ImagePreviewOverlay (binary, loaded via data URL)
 * - pdf → PDFPreviewOverlay (binary, embedded via Chromium viewer)
 * - code/text → CodePreviewOverlay (syntax highlighted)
 * - markdown → DocumentFormattedMarkdownOverlay
 * - json → JSONPreviewOverlay
 *
 * File path badges with "Open" / "Reveal in {file manager}" menus are provided
 * automatically by PlatformContext — no per-overlay callback props needed.
 */
function FilePreviewRenderer({
  state,
  onClose,
  loadDataUrl,
  loadPdfData,
  isDark,
}: {
  state: FilePreviewState
  onClose: () => void
  loadDataUrl: (path: string) => Promise<string>
  loadPdfData: (path: string) => Promise<Uint8Array>
  isDark: boolean
}) {
  const theme = isDark ? 'dark' : 'light' as const

  switch (state.type) {
    case 'image':
      return (
        <ImagePreviewOverlay
          isOpen
          onClose={onClose}
          filePath={state.filePath}
          loadDataUrl={loadDataUrl}
          theme={theme}
        />
      )

    case 'pdf':
      return (
        <PDFPreviewOverlay
          isOpen
          onClose={onClose}
          filePath={state.filePath}
          loadPdfData={loadPdfData}
          theme={theme}
        />
      )

    case 'code':
    case 'text':
      return (
        <CodePreviewOverlay
          isOpen
          onClose={onClose}
          filePath={state.filePath}
          content={state.content ?? ''}
          language={state.type === 'code' ? state.language : 'plaintext'}
          mode="read"
          theme={theme}
          error={state.error}
        />
      )

    case 'markdown': {
      // Show PLAN header for .md files in plans folder (handles both absolute and relative paths)
      const isPlanFile =
        (state.filePath.includes('/plans/') || state.filePath.startsWith('plans/')) &&
        state.filePath.endsWith('.md')
      return (
        <DocumentFormattedMarkdownOverlay
          isOpen
          onClose={onClose}
          content={state.content ?? ''}
          filePath={state.filePath}
          variant={isPlanFile ? 'plan' : 'response'}
        />
      )
    }

    case 'json': {
      // JSONPreviewOverlay expects parsed data, not a raw string.
      // @uiw/react-json-view crashes on null value, so guard against it.
      let parsedData: unknown = null
      try {
        if (state.content) parsedData = JSON.parse(state.content)
      } catch {
        // If parsing fails, fall back to showing as code
        return (
          <CodePreviewOverlay
            isOpen
            onClose={onClose}
            filePath={state.filePath}
            content={state.content ?? ''}
            language="json"
            mode="read"
            theme={theme}
            error={state.error}
          />
        )
      }
      // If read failed and content is empty, show raw code overlay with the read error.
      if ((!state.content || !state.content.trim()) && state.error) {
        return (
          <CodePreviewOverlay
            isOpen
            onClose={onClose}
            filePath={state.filePath}
            content={state.content ?? ''}
            language="json"
            mode="read"
            theme={theme}
            error={state.error}
          />
        )
      }
      return (
        <JSONPreviewOverlay
          isOpen
          onClose={onClose}
          filePath={state.filePath}
          title={state.filePath.split('/').pop() ?? 'JSON'}
          data={parsedData}
          theme={theme}
          error={state.error}
        />
      )
    }

    default:
      return null
  }
}
