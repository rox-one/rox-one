/**
 * NavigationContext
 *
 * Provides a global `navigate()` function that decouples components from
 * direct session/action imports. All navigation goes through typed routes.
 *
 * PEER PANEL MODEL:
 * All panels are equal. The **focused** panel drives the NavigationState
 * (which determines sidebar highlight, navigator content, etc.).
 * `navigate(route)` updates the focused panel's route.
 *
 * URL-DRIVEN HISTORY:
 * The URL is the source of truth. Every meaningful navigation pushes a
 * browser history entry via pushState. Back/forward uses the browser's
 * native popstate, with smart panel reconciliation to preserve React keys
 * (and thus scroll position, streaming state, etc.).
 *
 * Usage:
 *   import { useNavigation, useNavigationState } from '@/contexts/NavigationContext'
 *   import { routes } from '@/shared/routes'
 *
 *   const { navigate } = useNavigation()
 *   const navState = useNavigationState()
 *
 *   navigate(routes.view.allSessions())
 *   navigate(routes.action.newChat())
 */

import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useMemo,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useAtomValue, useSetAtom, useStore } from 'jotai'
import { useSession } from '@/hooks/useSession'
import { useLabels } from '@/hooks/useLabels'
import { matchesLabelFilter } from '@rox/shared/labels'
import {
  parseRoute,
  parseRouteToNavigationState,
  resolveRouteNavigationState,
  parseRouteToNavigationStateOrUnavailable,
  buildRouteFromNavigationState,
  buildRightSidebarParam,
  type ParsedRoute,
} from '../../shared/route-parser'
import { routes, type Route, type ViewRoute } from '../../shared/routes'
import { parsePermissionMode } from '@rox/shared/agent/mode-types'
import { NAVIGATE_EVENT, type NavigateOptions } from '../lib/navigate'
import { preserveRouteQuery, normalizePanelRouteForReconcile } from './navigation-reconcile'
import { encodePanelEntries, decodePanelEntries } from '@/lib/panel-url'
import { buildSemanticHistoryKey, canRunInitialRestore } from './navigation-history'
import * as storage from '@/lib/local-storage'
import type {
  DeepLinkNavigation,
  Session,
  NavigationState,
  SessionFilter,
  RightSidebarPanel,
  ContentBadge,
} from '../../shared/types'
import {
  isSessionsNavigation,
  isSourcesNavigation,
  isSettingsNavigation,
  isSkillsNavigation,
  isNotesNavigation,
  isAutomationsNavigation,
  isProjectsNavigation,
  isPagesNavigation,
  isBrowserNavigation,
  isMemoryNavigation,
  isTasksNavigation,
  isMeetingsNavigation,
  isInboxNavigation,
  isFeedNavigation,
  isConnectionsNavigation,
  isHomeNavigation,
  isKnowledgeNavigation,
  isDiffNavigation,
  isCloudRunNavigation,
  isTerminalNavigation,
  isExtensionNavigation,
  DEFAULT_NAVIGATION_STATE,
} from '../../shared/types'
import { sessionMetaMapAtom, updateSessionMetaAtom, type SessionMeta } from '@/atoms/sessions'
import {
  panelStackAtom,
  pushPanelAtom,
  reconcilePanelStackAtom,
  focusedPanelIdAtom,
  focusedPanelRouteAtom,
  focusedPanelIndexAtom,
  updateFocusedPanelRouteAtom,
  parseSessionIdFromRoute,
} from '@/atoms/panel-stack'

// Re-export routes for convenience
export { routes }
export type { Route }

// Re-export navigation state types for consumers
export type { NavigationState, SessionFilter }
export { isSessionsNavigation, isSourcesNavigation, isSettingsNavigation, isSkillsNavigation, isNotesNavigation, isAutomationsNavigation, isProjectsNavigation, isPagesNavigation, isBrowserNavigation, isMemoryNavigation, isTasksNavigation, isMeetingsNavigation, isInboxNavigation, isFeedNavigation, isConnectionsNavigation, isHomeNavigation, isKnowledgeNavigation, isDiffNavigation, isCloudRunNavigation, isTerminalNavigation, isExtensionNavigation }

// =============================================================================
// Context
// =============================================================================

interface NavigationContextValue {
  /** Navigate to a route */
  navigate: (route: Route, options?: NavigateOptions) => void | Promise<void>
  /** Check if navigation is ready */
  isReady: boolean
  /** Metadata readiness is separate from transport readiness. */
  isSessionsReady?: boolean
  /** Requested workspace has not resolved to the window's canonical workspace. */
  unavailableWorkspaceSlug?: string | null
  /** Unified navigation state — derived from focused panel + right sidebar */
  navigationState: NavigationState
  /** Accepted navigation requests include reopening the current entity address. */
  navigationRevision: number
  /** Whether we can go back in history */
  canGoBack: boolean
  /** Whether we can go forward in history */
  canGoForward: boolean
  /** Go back in history */
  goBack: () => void
  /** Go forward in history */
  goForward: () => void
  /** Update right sidebar panel */
  updateRightSidebar: (panel: RightSidebarPanel | undefined) => void
  /** Toggle right sidebar (with optional panel) */
  toggleRightSidebar: (panel?: RightSidebarPanel) => void
  /** Navigate to a source (or source list if no slug), preserving the current filter type */
  navigateToSource: (sourceSlug?: string) => void
  /** Navigate to a session, preserving the current filter type */
  navigateToSession: (sessionId: string) => void
}

export const NavigationContext = createContext<NavigationContextValue | null>(null)

interface NavigationProviderProps {
  children: ReactNode
  /** Current workspace ID */
  workspaceId: string | null
  /** Current workspace slug (used for URL ?ws= param and localStorage) */
  workspaceSlug: string | null
  /** Switch by slug; false or rejection means the history target is unavailable. */
  onSwitchWorkspaceBySlug?: (slug: string) => boolean | Promise<boolean>
  /** Session creation handler */
  onCreateSession: (workspaceId: string, options?: import('../../shared/types').CreateSessionOptions) => Promise<Session>
  /** Input change handler for pre-filling chat input */
  onInputChange?: (sessionId: string, value: string) => void
  /** Get draft input text for a session (reads from ref, no re-render) */
  getDraft?: (sessionId: string) => string
  /** Auto-delete an empty session (no confirmation needed) */
  onAutoDeleteEmptySession?: (sessionId: string) => void
  /** Whether the app is ready to navigate */
  isReady?: boolean
  /** Whether session metadata has been initialized (required for deterministic route restoration) */
  isSessionsReady?: boolean
  /** Remote workspace ID — when set, sessions with this ID are also considered part of the workspace */
  remoteWorkspaceId?: string | null
}

export function NavigationProvider({
  children,
  workspaceId,
  workspaceSlug,
  onSwitchWorkspaceBySlug,
  onCreateSession,
  onInputChange,
  getDraft,
  onAutoDeleteEmptySession,
  isReady = true,
  isSessionsReady = true,
  remoteWorkspaceId,
}: NavigationProviderProps) {
  const { t } = useTranslation()
  const navigationOwnerRef = useRef({ active: true, revision: 0 })
  useLayoutEffect(() => {
    const owner = { active: true, revision: 0 }
    navigationOwnerRef.current.active = false
    navigationOwnerRef.current = owner
    suppressAutoSelectRef.current = false
    return () => { owner.active = false }
  }, [workspaceId, remoteWorkspaceId])
  const [, setSession] = useSession()

  // Read session metadata directly from atom (reactive to session changes)
  const sessionMetaMap = useAtomValue(sessionMetaMapAtom)
  const sessionMetas = useMemo(() => Array.from(sessionMetaMap.values()), [sessionMetaMap])
  const updateSessionMeta = useSetAtom(updateSessionMetaAtom)
  // Label tree for filter matching (auto-select must agree with the visible list).
  const { labels: labelConfigs } = useLabels(workspaceId)

  const pushPanel = useSetAtom(pushPanelAtom)

  // Store reference for reading fresh atom values in callbacks (avoids stale closures)
  const store = useStore()

  // =========================================================================
  // DERIVED NAVIGATION STATE (from focused panel + right sidebar)
  // =========================================================================

  const focusedRoute = useAtomValue(focusedPanelRouteAtom)
  const [navigationRevision, setNavigationRevision] = useState(0)
  const [requestedWorkspaceSlug, setRequestedWorkspaceSlug] = useState<string | null>(
    () => new URLSearchParams(window.location.search).get('ws'),
  )
  const requestedWorkspaceSlugRef = useRef(requestedWorkspaceSlug)
  const unavailableWorkspaceSlug = requestedWorkspaceSlug && requestedWorkspaceSlug !== workspaceSlug
    ? requestedWorkspaceSlug : null

  // Right sidebar is independent of panels (not per-panel state)
  const [rightSidebar, setRightSidebar] = useState<RightSidebarPanel | undefined>()
  const rightSidebarRef = useRef<RightSidebarPanel | undefined>(rightSidebar)

  // NavigationState derived from the focused panel's route
  const navigationState: NavigationState = useMemo(() => {
    const base: NavigationState = unavailableWorkspaceSlug
      ? { navigator: 'unavailable', route: focusedRoute ?? 'allSessions', details: null }
      : focusedRoute
      ? resolveRouteNavigationState(focusedRoute)
      : DEFAULT_NAVIGATION_STATE
    let state = base
    if (isSessionsNavigation(base) && base.details) {
      const meta = sessionMetaMap.get(base.details.sessionId)
      const matchesWorkspace = !workspaceId
        || meta?.workspaceId === workspaceId
        || (remoteWorkspaceId && meta?.workspaceId === remoteWorkspaceId)
      if (meta && !matchesWorkspace) {
        state = { navigator: 'unavailable', route: focusedRoute!, reason: 'workspace-mismatch' }
      }
    }
    return rightSidebar ? { ...state, rightSidebar } : state
  }, [focusedRoute, rightSidebar, sessionMetaMap, workspaceId, remoteWorkspaceId, unavailableWorkspaceSlug])

  // =========================================================================
  // BROWSER HISTORY TRACKING
  // =========================================================================

  const [canGoBack, setCanGoBack] = useState(false)
  const [canGoForward, setCanGoForward] = useState(false)

  // Sequence numbers stored in history.state for tracking position
  const historySeqRef = useRef(0)                // Current history position
  const historyMaxSeqRef = useRef(0)              // Highest pushed seq (for canGoForward)
  const nextHistorySeqRef = useRef(1)             // Next seq to assign on pushState

  // Suppress pushState in atom subscriptions during restore/reconciliation
  const suppressPushRef = useRef(false)

  // Coalesce compound atom writes (e.g. pushPanelAtom sets both panelStackAtom
  // and focusedPanelIdAtom) into a single pushState via microtask debounce
  const pendingPushRef = useRef(false)

  // Flag: workspace switch was triggered by popstate (URL already correct)
  const isPopstateSwitchRef = useRef(false)
  const pendingUrlRestoreRef = useRef<string | null>(null)
  const previousWorkspaceSlugRef = useRef<string | null>(null)

  // Queue navigation if not ready yet
  const pendingNavigationRef = useRef<{
    route: Route; options?: NavigateOptions; workspaceId: string | null;
    owner: { active: boolean; revision: number }
  } | null>(null)

  // Suppress auto-select for one cycle (used by skipAutoSelect to prevent the effect from re-selecting)
  const suppressAutoSelectRef = useRef(false)

  // Track whether initial route restoration has been attempted
  const initialRouteRestoredRef = useRef(false)

  // A slow action may finish after its workspace or subsequent navigation has
  // changed. Creation belongs to the original workspace; its UI continuation
  // must not take over the newly focused workspace/panel.
  const workspaceIdRef = useRef(workspaceId)
  const actionEpochRef = useRef(0)
  const workspaceSwitchRequestRef = useRef(0)
  useLayoutEffect(() => {
    workspaceIdRef.current = workspaceId
    actionEpochRef.current++
  }, [workspaceId])

  const requestWorkspaceSwitch = useCallback((slug: string): boolean => {
    if (!onSwitchWorkspaceBySlug) return false
    const request = ++workspaceSwitchRequestRef.current
    const reconcileRevision = ++historyReconcileRevisionRef.current
    const failed = () => {
      if (!historyMountedRef.current || request !== workspaceSwitchRequestRef.current
        || reconcileRevision !== historyReconcileRevisionRef.current
        || requestedWorkspaceSlugRef.current !== slug) return
      isPopstateSwitchRef.current = false
      initialRouteRestoredRef.current = true
      suppressPushRef.current = false
      pendingNavigationRef.current = null
      toast.error(t('common.unavailable'))
    }
    try {
      const accepted = onSwitchWorkspaceBySlug(slug)
      if (accepted === false) { failed(); return false }
      actionEpochRef.current++
      void Promise.resolve(accepted).then(result => { if (result === false) failed() }, failed)
      return true
    } catch {
      failed()
      return false
    }
  }, [onSwitchWorkspaceBySlug, t])

  // Semantic key for the last history entry we intentionally pushed/reconciled.
  // Excludes layout-only values (like panel proportions) so resize does not create history entries.
  const lastSemanticHistoryKeyRef = useRef('')
  const historyReconcileRevisionRef = useRef(0)
  const historyMountedRef = useRef(false)

  // History belongs to the local workspace. Remote ownership and panel focus
  // rotate action custody, but cannot strand a pending history switch.
  useLayoutEffect(() => {
    ++historyReconcileRevisionRef.current
    return () => { ++historyReconcileRevisionRef.current }
  }, [workspaceId])

  const updateCanGoBackForward = useCallback(() => {
    setCanGoBack(historySeqRef.current > 0)
    setCanGoForward(historySeqRef.current < historyMaxSeqRef.current)
  }, [])

  const getSemanticHistoryKey = useCallback(() => {
    const panels = store.get(panelStackAtom)
    const focusedIdx = store.get(focusedPanelIndexAtom)
    const sidebarKey = buildRightSidebarParam(rightSidebarRef.current) ?? ''
    return buildSemanticHistoryKey({
      workspaceSlug,
      panelRoutes: panels.map(p => p.route),
      focusedPanelIndex: focusedIdx,
      sidebarParam: sidebarKey,
    })
  }, [store, workspaceSlug])

  // =========================================================================
  // URL SYNC (builds URL from current state, push or replace)
  // =========================================================================

  /**
   * Build the current URL from atom state and either push or replace.
   *
   * push=true: creates a new browser history entry (meaningful navigation)
   * push=false: updates the current entry (resize, auto-select, etc.)
   *
   * Also persists the URL per-workspace in localStorage for workspace switch restoration.
   */
  const syncUrl = useCallback((push: boolean = false) => {
    if (!historyMountedRef.current || isPopstateSwitchRef.current) return
    // Do not rewrite a foreign/unknown requested workspace into the current one.
    if (requestedWorkspaceSlugRef.current && requestedWorkspaceSlugRef.current !== workspaceSlug) return
    if (!isReady || !isSessionsReady || pendingUrlRestoreRef.current !== null) return
    if (previousWorkspaceSlugRef.current !== null && previousWorkspaceSlugRef.current !== workspaceSlug) return
    const panels = store.get(panelStackAtom)
    const focusedIdx = store.get(focusedPanelIndexAtom)
    if (panels.length === 0) return

    const focusedPanel = panels[focusedIdx] ?? panels[0]
    const url = new URL(window.location.href)

    // ?ws= workspace slug
    if (workspaceSlug) {
      url.searchParams.set('ws', workspaceSlug)
    }

    // ?route= is the focused panel's route
    url.searchParams.set('route', focusedPanel.route)

    // ?panels= encodes ALL panels in stack order
    if (panels.length > 1) {
      const encoded = encodePanelEntries(panels.map(({ route, proportion }) => ({ route, proportion })))
      url.searchParams.set('panels', encoded)
    } else {
      url.searchParams.delete('panels')
    }

    // ?fi= is focused panel index (for multi-panel layouts)
    if (panels.length > 1) {
      url.searchParams.set('fi', String(focusedIdx))
    } else {
      url.searchParams.delete('fi')
    }

    // ?sidebar=
    const sidebarParam = buildRightSidebarParam(rightSidebarRef.current)
    if (sidebarParam) {
      url.searchParams.set('sidebar', sidebarParam)
    } else {
      url.searchParams.delete('sidebar')
    }

    const urlStr = url.toString()

    if (push) {
      const seq = nextHistorySeqRef.current++
      history.pushState({ seq }, '', urlStr)
      historySeqRef.current = seq
      historyMaxSeqRef.current = seq // Forward history discarded by browser
      updateCanGoBackForward()
    } else {
      history.replaceState({ ...history.state, seq: historySeqRef.current }, '', urlStr)
    }

    // Persist per-workspace URL for workspace switch restoration
    if (workspaceSlug) {
      storage.set(storage.KEYS.workspaceUrl, url.search, workspaceSlug)
    }
  }, [store, workspaceSlug, isReady, isSessionsReady, updateCanGoBackForward])

  const syncUrlRef = useRef(syncUrl)
  useEffect(() => { syncUrlRef.current = syncUrl }, [syncUrl])

  const maybePushHistoryForSemanticChange = useCallback(() => {
    if (!historyMountedRef.current || isPopstateSwitchRef.current) return
    if (requestedWorkspaceSlugRef.current && requestedWorkspaceSlugRef.current !== workspaceSlug) return
    if (!isReady || !isSessionsReady || pendingUrlRestoreRef.current !== null) return
    if (previousWorkspaceSlugRef.current !== null && previousWorkspaceSlugRef.current !== workspaceSlug) return
    const currentSemanticKey = getSemanticHistoryKey()
    if (currentSemanticKey === lastSemanticHistoryKeyRef.current) return

    syncUrlRef.current?.(true)
    lastSemanticHistoryKeyRef.current = currentSemanticKey
  }, [getSemanticHistoryKey, isReady, isSessionsReady, workspaceSlug])

  const finishHistoryReconcile = useCallback(() => {
    const revision = ++historyReconcileRevisionRef.current
    lastSemanticHistoryKeyRef.current = getSemanticHistoryKey()
    requestAnimationFrame(() => {
      if (!historyMountedRef.current || revision !== historyReconcileRevisionRef.current) return
      suppressPushRef.current = false
      // Explicit navigation can arrive before this frame. Preserve that change
      // as history rather than replacing the restored workspace's address.
      maybePushHistoryForSemanticChange()
    })
  }, [getSemanticHistoryKey, maybePushHistoryForSemanticChange])

  useEffect(() => {
    historyMountedRef.current = true
    return () => { historyMountedRef.current = false }
  }, [])

  // replaceState sync when panel stack, focus, or sidebar changes (catches resize, etc.)
  const panelStack = useAtomValue(panelStackAtom)
  const focusedPanelId = useAtomValue(focusedPanelIdAtom)
  useEffect(() => {
    if (!initialRouteRestoredRef.current) return
    syncUrlRef.current(false)
  }, [panelStack, focusedPanelId, rightSidebar])

  // =========================================================================
  // ATOM SUBSCRIPTIONS FOR pushState (meaningful navigation)
  // =========================================================================

  // Panel stack changes: push history on add/remove/route change (NOT resize)
  useEffect(() => {
    let prevRoutes = store.get(panelStackAtom).map(p => p.route)
    const unsub = store.sub(panelStackAtom, () => {
      if (suppressPushRef.current || !initialRouteRestoredRef.current) return
      const currRoutes = store.get(panelStackAtom).map(p => p.route)
      if (currRoutes.length !== prevRoutes.length || !currRoutes.every((r, i) => r === prevRoutes[i])) {
        if (!pendingPushRef.current) {
          pendingPushRef.current = true
          queueMicrotask(() => { pendingPushRef.current = false; maybePushHistoryForSemanticChange() })
        }
      }
      prevRoutes = currRoutes
    })
    return unsub
  }, [store, maybePushHistoryForSemanticChange])

  // Focus changes: push history when active panel changes
  useEffect(() => {
    let prevFocusId = store.get(focusedPanelIdAtom)
    const unsub = store.sub(focusedPanelIdAtom, () => {
      const newFocusId = store.get(focusedPanelIdAtom)
      if (newFocusId !== prevFocusId) {
        // A focus-away-and-back intent must invalidate pending work even when
        // the original panel identity and route become equal again.
        navigationOwnerRef.current.revision += 1
        suppressAutoSelectRef.current = false
        prevFocusId = newFocusId
        if (suppressPushRef.current || !initialRouteRestoredRef.current) return
        if (!pendingPushRef.current) {
          pendingPushRef.current = true
          queueMicrotask(() => { pendingPushRef.current = false; maybePushHistoryForSemanticChange() })
        }
      }
    })
    return unsub
  }, [store, maybePushHistoryForSemanticChange])

  // Right sidebar changes: push history
  const prevSidebarTypeRef = useRef(rightSidebar?.type)
  useEffect(() => {
    if (rightSidebar?.type === prevSidebarTypeRef.current) return
    prevSidebarTypeRef.current = rightSidebar?.type
    if (suppressPushRef.current) return
    if (!initialRouteRestoredRef.current) return
    maybePushHistoryForSemanticChange()
  }, [rightSidebar, maybePushHistoryForSemanticChange])

  // =========================================================================
  // RECONCILE PANELS FROM URL PARAMS
  // =========================================================================

  /**
   * Parse URL search params and reconcile the panel stack + sidebar.
   * Uses reconcilePanelStackAtom for smart matching (preserves React keys).
   */
  const reconcileFromUrlParams = useCallback(
    (params: URLSearchParams) => {
      const initialRoute = params.get('route')
      const sidebarParam = params.get('sidebar') || undefined
      const panelsParam = params.get('panels')
      const focusedIndexParam = params.get('fi')

      // Restore right sidebar
      if (sidebarParam) {
        const parsed = parseRouteToNavigationState('allSessions', sidebarParam)
        rightSidebarRef.current = parsed?.rightSidebar
        setRightSidebar(parsed?.rightSidebar)
      } else {
        rightSidebarRef.current = undefined
        setRightSidebar(undefined)
      }

      // Parse panel entries from URL
      let entries: { route: ViewRoute; proportion: number }[] = []
      let focusedIndex = 0

      if (panelsParam) {
        entries = decodePanelEntries(panelsParam).map(({ route, proportion }) => ({
          route: normalizePanelRouteForReconcile(route as ViewRoute, state => resolveAutoSelectionRef.current(state)),
          proportion,
        }))

        const hasUsableProportions = entries.every(e => e.proportion > 0)
        if (!hasUsableProportions) {
          const equal = 1 / entries.length
          entries.forEach(e => { e.proportion = equal })
        } else {
          const total = entries.reduce((s, e) => s + e.proportion, 0)
          if (total > 0 && Math.abs(total - 1) > 0.001) {
            entries.forEach(e => { e.proportion = e.proportion / total })
          }
        }

        focusedIndex = focusedIndexParam != null ? (parseInt(focusedIndexParam, 10) || 0) : 0
      }
      if (entries.length === 0 && initialRoute) {
        // Single panel from ?route=
        const route = normalizePanelRouteForReconcile(initialRoute as ViewRoute, (state) => resolveAutoSelectionRef.current(state))
        entries = [{ route, proportion: 1 }]
      }

      if (entries.length === 0 && (initialRoute || panelsParam)) {
        entries = [{ route: normalizePanelRouteForReconcile((initialRoute || panelsParam!) as ViewRoute, (state) => resolveAutoSelectionRef.current(state)), proportion: 1 }]
      }
      if (entries.length > 0) {
        store.set(reconcilePanelStackAtom, { entries, focusedIndex })
      }
    },
    [store]
  )

  // Keep ref fresh for use in event handlers / effects that capture stale closures
  const reconcileFromUrlParamsRef = useRef(reconcileFromUrlParams)
  useEffect(() => { reconcileFromUrlParamsRef.current = reconcileFromUrlParams }, [reconcileFromUrlParams])

  // =========================================================================
  // EMPTY SESSION CLEANUP (reactive — covers navigate, close tab, etc.)
  // =========================================================================

  // Track which session IDs are visible across all panels. When a session ID
  // disappears (navigate away, close tab, Cmd+W), check if it was empty and
  // auto-delete it. This is the single codepath for all navigate-away cleanup.
  const prevVisibleSessionIdsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    const currentIds = new Set<string>()
    for (const entry of panelStack) {
      const sessionId = parseSessionIdFromRoute(entry.route)
      if (sessionId) currentIds.add(sessionId)
    }

    // Only check after we've seen at least one set of IDs
    // (skip first render to avoid false positives during initialization)
    if (onAutoDeleteEmptySession && prevVisibleSessionIdsRef.current.size > 0) {
      for (const prevId of prevVisibleSessionIdsRef.current) {
        if (!currentIds.has(prevId)) {
          const meta = store.get(sessionMetaMapAtom).get(prevId)
          const belongsToWorkspace = meta && workspaceId && (meta.workspaceId === workspaceId || meta.workspaceId === remoteWorkspaceId)
          const isEmpty = isSessionsReady && belongsToWorkspace && !meta.lastFinalMessageId && !meta.name && !meta.isProcessing
          const hasDraft = getDraft?.(prevId)?.trim()
          if (isEmpty && !hasDraft) {
            onAutoDeleteEmptySession(prevId)
          }
        }
      }
    }

    prevVisibleSessionIdsRef.current = currentIds
  }, [panelStack, onAutoDeleteEmptySession, store, getDraft, workspaceId, remoteWorkspaceId, isSessionsReady])

  // =========================================================================
  // SESSION SELECTION SYNC
  // =========================================================================

  // Keep the global session selection in sync with the focused panel
  useEffect(() => {
    if (isSessionsNavigation(navigationState) && navigationState.details) {
      const meta = store.get(sessionMetaMapAtom).get(navigationState.details.sessionId)
      // The explicit address remains recoverable while ownership is unresolved,
      // but selection also drives the shell's message loader.
      if (!isSessionsReady || !meta || !workspaceId || (meta.workspaceId !== workspaceId && meta.workspaceId !== remoteWorkspaceId)) return
      setSession({ selected: navigationState.details.sessionId })
      if (meta.workspaceId === workspaceId) {
        storage.set(storage.KEYS.lastSelectedSessionId, navigationState.details.sessionId, workspaceId)
      }
    }
  }, [navigationState, setSession, workspaceId, remoteWorkspaceId, isSessionsReady, sessionMetaMap, store])

  // =========================================================================
  // HELPERS
  // =========================================================================

  // Helper: Filter sessions by SessionFilter
  // Always excludes hidden sessions - they should never appear in navigation
  const filterSessionsByFilter = useCallback(
    (filter: SessionFilter): SessionMeta[] => {
      // First filter out hidden sessions - they should never appear in any view
      const visibleSessions = sessionMetas.filter(
        s => !s.hidden && !!workspaceId && (s.workspaceId === workspaceId || s.workspaceId === remoteWorkspaceId)
      )

      return visibleSessions.filter((session) => {
        switch (filter.kind) {
          case 'allSessions':
            return session.isArchived !== true
          case 'flagged':
            return session.isFlagged === true && session.isArchived !== true
          case 'archived':
            return session.isArchived === true
          case 'state':
            return session.sessionStatus === filter.stateId && session.isArchived !== true
          case 'label': {
            if (session.isArchived === true) return false
            // Shared predicate — descendant-aware and project-scoped, matching
            // exactly what the session list renders (auto-select must agree).
            return matchesLabelFilter(session, filter, labelConfigs)
          }
          case 'view':
            if (session.isArchived === true) return false
            return true
          default:
            return false
        }
      })
    },
    [sessionMetas, workspaceId, remoteWorkspaceId, labelConfigs]
  )

  const getFirstSessionId = useCallback(
    (filter: SessionFilter): string | null => {
      const filtered = filterSessionsByFilter(filter)
      return filtered[0]?.id ?? null
    },
    [filterSessionsByFilter]
  )

  const getLastSelectedSessionId = useCallback(
    (filter: SessionFilter): string | null => {
      if (!workspaceId) return null
      const storedId = storage.get<string | null>(
        storage.KEYS.lastSelectedSessionId,
        null,
        workspaceId
      )
      if (!storedId) return null
      const filtered = filterSessionsByFilter(filter)
      return filtered.some(session => session.id === storedId) ? storedId : null
    },
    [workspaceId, filterSessionsByFilter]
  )

  // =========================================================================
  // AUTO-SELECTION (pure computation, no side effects)
  // =========================================================================

  /**
   * Resolve auto-selection for a NavigationState.
   * When navigating to a filter without explicit details, auto-select the
   * first available item. Returns the final state (no side effects).
   */
  const resolveAutoSelection = useCallback(
    (newState: NavigationState, options?: { skipAutoSelect?: boolean }): NavigationState => {
      let nextState = newState

      // Validate session exists in current workspace (local or remote ID)
      if (isSessionsNavigation(nextState) && nextState.details) {
        const freshMetaMap = store.get(sessionMetaMapAtom)
        const meta = freshMetaMap.get(nextState.details.sessionId)
        const matchesWorkspace = !workspaceId
          || meta?.workspaceId === workspaceId
          || (remoteWorkspaceId && meta?.workspaceId === remoteWorkspaceId)
        if (meta && !matchesWorkspace) {
          return {
            navigator: 'unavailable',
            route: buildRouteFromNavigationState(nextState),
            reason: 'workspace-mismatch',
            ...(nextState.rightSidebar ? { rightSidebar: nextState.rightSidebar } : {}),
          }
        }
        // Explicit identity survives metadata loading and deletion. ChatPage
        // handles its missing state; auto-selection belongs to list-only routes.
        return nextState
      }

      // Sessions: auto-select last/first session.
      // Board/table have no per-session detail chrome, so skip auto-selection —
      // otherwise navigating there would immediately resolve into a chat route.
      if (
        isSessionsNavigation(nextState) &&
        nextState.viewMode !== 'board' &&
        nextState.viewMode !== 'table' &&
        nextState.viewMode !== 'heatmap' &&
        !nextState.details &&
        !options?.skipAutoSelect
      ) {
        const lastSelectedSessionId = getLastSelectedSessionId(nextState.filter)
        const fallbackSessionId = lastSelectedSessionId ?? getFirstSessionId(nextState.filter)
        if (fallbackSessionId) {
          return { ...nextState, details: { type: 'session', sessionId: fallbackSessionId } }
        }
        return nextState
      }

      // Sources: stay on the list route. Explicit row click in SourcesListPanel
      // opens sources/source/<slug>. Do not auto-drill to the first source.

      // Skills stay on the list until an explicit row click.

      return nextState
    },
    [getLastSelectedSessionId, getFirstSessionId, store, workspaceId, remoteWorkspaceId]
  )

  // Ref keeps resolveAutoSelection fresh for reconcileFromUrlParams (defined earlier in the file)
  const resolveAutoSelectionRef = useRef(resolveAutoSelection)
  useEffect(() => { resolveAutoSelectionRef.current = resolveAutoSelection }, [resolveAutoSelection])

  // =========================================================================
  // ACTION NAVIGATION
  // =========================================================================

  const handleActionNavigation = useCallback(
    async (parsed: ParsedRoute, options?: { newPanel?: boolean; targetLaneId?: 'main' }) => {
      if (!workspaceId) return
      const actionEpoch = actionEpochRef.current
      const owner = navigationOwnerRef.current
      let requestRevision = owner.revision
      let targetPanelId = store.get(focusedPanelIdAtom)
      let targetRoute = store.get(focusedPanelRouteAtom)
      const isCurrent = () => workspaceIdRef.current === workspaceId && actionEpochRef.current === actionEpoch
        && owner.active && navigationOwnerRef.current === owner && owner.revision === requestRevision
        && store.get(focusedPanelIdAtom) === targetPanelId && store.get(focusedPanelRouteAtom) === targetRoute

      switch (parsed.name) {
        case 'new-chat':
        case 'new-session': {
          const previousSuppression = suppressAutoSelectRef.current
          suppressAutoSelectRef.current = true
          try {
            const createOptions: import('../../shared/types').CreateSessionOptions = {}
            if (parsed.params.mode) {
              const parsedMode = parsePermissionMode(parsed.params.mode)
              if (parsedMode) {
                createOptions.permissionMode = parsedMode
              }
            }
            if (parsed.params.workdir) {
              createOptions.workingDirectory = parsed.params.workdir as 'user_default' | 'none' | string
            }
            if (parsed.params.model) {
              createOptions.model = parsed.params.model
            }
            if (parsed.params.systemPrompt) {
              createOptions.systemPromptPreset = parsed.params.systemPrompt as 'default' | 'mini' | string
            }
            if (parsed.params.status) {
              createOptions.sessionStatus = parsed.params.status
            }
            if (parsed.params.label) {
              createOptions.labels = [parsed.params.label]
            }
            if (parsed.params.project) {
              createOptions.projectId = parsed.params.project
            }
            const session = await onCreateSession(workspaceId, createOptions)
            if (!isCurrent()) return

            if (parsed.params.name) {
              await window.electronAPI.sessionCommand(session.id, { type: 'rename', name: parsed.params.name })
              if (!isCurrent()) return
            }

            if (parsed.params.status) {
              updateSessionMeta(session.id, { sessionStatus: parsed.params.status })
            }
            if (parsed.params.label) {
              updateSessionMeta(session.id, { labels: [parsed.params.label] })
            }

            if (parsed.params.status) {
              await window.electronAPI.sessionCommand(session.id, { type: 'setSessionStatus', state: parsed.params.status })
              if (!isCurrent()) return
            }
            if (parsed.params.label) {
              await window.electronAPI.sessionCommand(session.id, { type: 'setLabels', labels: [parsed.params.label] })
              if (!isCurrent()) return
            }

            // Determine navigation filter
            const filter: import('../../shared/types').SessionFilter =
              parsed.params.status ? { kind: 'state', stateId: parsed.params.status } :
              parsed.params.label ? { kind: 'label', labelId: parsed.params.label } :
              { kind: 'allSessions' }

            if (options?.newPanel) {
              // Open the new session in a new panel using lane-aware routing (pushPanel auto-focuses it)
              pushPanel({
                route: routes.view.allSessions(session.id) as ViewRoute,
                targetLaneId: options.targetLaneId,
                intent: 'explicit',
              })
            } else {
              // Navigate the focused panel to the new session
              const newState: NavigationState = {
                navigator: 'sessions',
                filter,
                details: { type: 'session', sessionId: session.id },
              }
              const route = buildRouteFromNavigationState(newState) as ViewRoute
              store.set(updateFocusedPanelRouteAtom, route)
              // Session selection sync handled by effect
            }

            targetPanelId = store.get(focusedPanelIdAtom)
            targetRoute = store.get(focusedPanelRouteAtom)
            // Our own synchronous panel commit can change focus. Delayed input
            // belongs to that committed target, with a fresh intent revision.
            requestRevision = owner.revision
            setNavigationRevision(revision => revision + 1)

            // Parse badges from params
            let badges: ContentBadge[] | undefined
            if (parsed.params.badges) {
              try {
                badges = JSON.parse(parsed.params.badges) as ContentBadge[]
              } catch (e) {
                console.warn('[Navigation] Failed to parse badges param:', e)
              }
            }

            // Handle input: either auto-send or pre-fill
            if (parsed.params.input) {
              const shouldSend = parsed.params.send === 'true'
              if (shouldSend) {
                setTimeout(() => {
                  if (!isCurrent()) return
                  void window.electronAPI.sendMessage(
                    session.id,
                    parsed.params.input!,
                    undefined,
                    undefined,
                    badges ? { badges } : undefined
                  ).catch(() => { toast.error(t('common.unavailable')) })
                }, 100)
              } else if (onInputChange) {
                setTimeout(() => {
                  if (!isCurrent()) return
                  onInputChange(session.id, parsed.params.input!)
                }, 100)
              }
            }
          } finally {
            if (owner.active && navigationOwnerRef.current === owner && owner.revision === requestRevision) {
              suppressAutoSelectRef.current = previousSuppression
            }
          }
          break
        }

        case 'rename-session':
          if (parsed.id && parsed.params.name) {
            await window.electronAPI.sessionCommand(parsed.id, { type: 'rename', name: parsed.params.name })
          }
          break

        case 'delete-session':
          if (parsed.id) {
            await window.electronAPI.deleteSession(parsed.id)
          }
          break

        case 'flag-session':
          if (parsed.id) {
            await window.electronAPI.sessionCommand(parsed.id, { type: 'flag' })
          }
          break

        case 'unflag-session':
          if (parsed.id) {
            await window.electronAPI.sessionCommand(parsed.id, { type: 'unflag' })
          }
          break

        case 'oauth':
          if (parsed.id) {
            await window.electronAPI.performOAuth({ sourceSlug: parsed.id })
          }
          break

        case 'delete-source':
          if (parsed.id) {
            await window.electronAPI.deleteSource(workspaceId, parsed.id)
          }
          break

        case 'set-mode':
          if (parsed.id && parsed.params.mode) {
            const parsedMode = parsePermissionMode(parsed.params.mode)
            if (!parsedMode) {
              console.warn('[Navigation] Invalid permission mode:', parsed.params.mode)
              break
            }
            await window.electronAPI.sessionCommand(
              parsed.id,
              { type: 'setPermissionMode', mode: parsedMode }
            )
          }
          break

        case 'copy':
          if (parsed.params.text) {
            await navigator.clipboard.writeText(parsed.params.text)
          }
          break

        default:
          console.warn('[Navigation] Unknown action:', parsed.name)
      }
    },
    [workspaceId, onCreateSession, onInputChange, pushPanel, store, updateSessionMeta, t]
  )

  // =========================================================================
  // NAVIGATE
  // =========================================================================

  const navigate = useCallback(
    async (route: Route, options?: NavigateOptions) => {
      navigationOwnerRef.current.revision += 1
      if (isPopstateSwitchRef.current) {
        isPopstateSwitchRef.current = false
        suppressPushRef.current = false
        ++historyReconcileRevisionRef.current
      }
      // Reset auto-select suppression on any normal navigation
      if (!options?.skipAutoSelect) {
        suppressAutoSelectRef.current = false
      }

      const parsed = parseRoute(route)
      if (!parsed && route.startsWith('action/')) {
        console.warn('[Navigation] Invalid route:', route)
        return
      }

      if (!isReady || !isSessionsReady || !initialRouteRestoredRef.current || isPopstateSwitchRef.current) {
        pendingNavigationRef.current = {
          route, options: options ? { ...options } : undefined, workspaceId,
          owner: navigationOwnerRef.current,
        }
        return
      }

      // An explicit in-app request recovers from a stale workspace URL.
      requestedWorkspaceSlugRef.current = workspaceSlug
      setRequestedWorkspaceSlug(workspaceSlug)
      actionEpochRef.current++

      // Handle actions (side effects)
      if (parsed?.type === 'action') {
        await handleActionNavigation(parsed, options)
        return
      }

      // For view routes with newPanel: push a panel using lane-aware routing.
      //
      // Important distinction:
      // - explicit opens (intent='explicit') can target a specific lane
      // - implicit navigation (updateFocusedPanelRouteAtom path) applies lock/fallback
      // This mirrors VS Code-style "locked group" behavior.
      if (options?.newPanel) {
        pushPanel({
          route: route as ViewRoute,
          targetLaneId: options.targetLaneId,
          intent: 'explicit',
        })
        setNavigationRevision(revision => revision + 1)
        return
      }

      // Parse route to NavigationState. Bare `settings` produces `subpage: null` —
      // navigator-only view in compact mode, App-page fallback on desktop. We
      // intentionally do NOT auto-redirect to the last-visited subpage; doing so
      // would defeat the compact-mode drill-in UX.
      const newNavState = resolveRouteNavigationState(route)

      // Suppress auto-select effect
      if (options?.skipAutoSelect) {
        suppressAutoSelectRef.current = true
      }

      if (newNavState) {
        // Resolve auto-selection (pure — no side effects)
        const resolvedState = resolveAutoSelection(newNavState, options)
        const finalRoute = preserveRouteQuery(route, buildRouteFromNavigationState(resolvedState))

        // Persist last selected session for auto-select on next visit
        if (isSessionsNavigation(resolvedState) && resolvedState.details && workspaceId) {
          const meta = store.get(sessionMetaMapAtom).get(resolvedState.details.sessionId)
          if (meta && (meta.workspaceId === workspaceId || meta.workspaceId === remoteWorkspaceId)) {
            storage.set(storage.KEYS.lastSelectedSessionId, resolvedState.details.sessionId, workspaceId)
          }
        }

        // Update the focused panel's route (atom update is synchronous)
        // The panelStack atom subscription detects the route change and calls syncUrl(true)
        store.set(updateFocusedPanelRouteAtom, finalRoute)
        setNavigationRevision(revision => revision + 1)
      }
    },
    [isReady, isSessionsReady, handleActionNavigation, resolveAutoSelection, store, pushPanel, workspaceId, remoteWorkspaceId, workspaceSlug]
  )

  // =========================================================================
  // BACK / FORWARD (browser history)
  // =========================================================================

  const goBack = useCallback(() => {
    history.back()
  }, [])

  const goForward = useCallback(() => {
    history.forward()
  }, [])

  // =========================================================================
  // POPSTATE HANDLER (browser back/forward)
  // =========================================================================

  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      // A browser-history request supersedes pending create/prefill/send work.
      navigationOwnerRef.current.revision += 1
      // Claim the history intent before readiness or workspace branching. A
      // same-workspace request supersedes any pending foreign switch as well.
      ++historyReconcileRevisionRef.current
      isPopstateSwitchRef.current = false
      suppressPushRef.current = true
      // Update sequence tracking
      const eventSeq = event.state?.seq ?? 0
      historySeqRef.current = eventSeq
      updateCanGoBackForward()

      // Read state from URL (the browser already navigated to it)
      const params = new URLSearchParams(window.location.search)
      const wsSlug = params.get('ws')
      requestedWorkspaceSlugRef.current = wsSlug
      setRequestedWorkspaceSlug(wsSlug)

      // Check if workspace changed
      if (wsSlug && wsSlug !== workspaceSlug) {
        // Workspace boundary crossed — trigger workspace switch
        // The workspace switch effect will handle reconciliation
        isPopstateSwitchRef.current = true
        suppressPushRef.current = true
        if (!requestWorkspaceSwitch(wsSlug)) {
          isPopstateSwitchRef.current = false
          reconcileFromUrlParamsRef.current(params)
          initialRouteRestoredRef.current = true
          finishHistoryReconcile()
        }
        return
      }

      if (!isReady || !isSessionsReady) {
        // Initial restore may already have run. Retain a later history change
        // until this workspace's metadata becomes ready again.
        pendingUrlRestoreRef.current = window.location.search
        return
      }

      // Same workspace — reconcile panels from the URL
      suppressPushRef.current = true
      reconcileFromUrlParamsRef.current(params)
      lastSemanticHistoryKeyRef.current = getSemanticHistoryKey()
      finishHistoryReconcile()
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [workspaceSlug, requestWorkspaceSwitch, updateCanGoBackForward, getSemanticHistoryKey, isReady, isSessionsReady, syncUrl, finishHistoryReconcile])

  useEffect(() => {
    if (!isReady || !isSessionsReady || pendingUrlRestoreRef.current === null) return
    const search = pendingUrlRestoreRef.current
    pendingUrlRestoreRef.current = null
    const params = new URLSearchParams(search)
    const requested = params.get('ws')
    // Workspace restoration owns the boundary; a retained history request
    // cannot reconcile another workspace into the current one.
    if (requested && requested !== workspaceSlug) return
    suppressPushRef.current = true
    reconcileFromUrlParamsRef.current(params)
    lastSemanticHistoryKeyRef.current = getSemanticHistoryKey()
    finishHistoryReconcile()
  }, [isReady, isSessionsReady, workspaceSlug, getSemanticHistoryKey, finishHistoryReconcile])

  // =========================================================================
  // WORKSPACE SWITCH
  // =========================================================================

  useEffect(() => {
    if (!workspaceId || !workspaceSlug || !isReady || !isSessionsReady) return

    if (previousWorkspaceSlugRef.current === null) {
      // First mount — initial route restoration handles it
      previousWorkspaceSlugRef.current = workspaceSlug
      return
    }

    if (previousWorkspaceSlugRef.current === workspaceSlug) return
    previousWorkspaceSlugRef.current = workspaceSlug

    // Suppress pushState during reconciliation
    suppressPushRef.current = true

    if (isPopstateSwitchRef.current) {
      // Popstate-triggered: URL is already correct, just reconcile from it
      isPopstateSwitchRef.current = false
      reconcileFromUrlParamsRef.current(new URLSearchParams(window.location.search))
      lastSemanticHistoryKeyRef.current = getSemanticHistoryKey()
    } else {
      // UI-triggered: load stored URL for the new workspace, push history entry
      requestedWorkspaceSlugRef.current = workspaceSlug
      setRequestedWorkspaceSlug(workspaceSlug)
      const savedSearch = storage.get<string>(storage.KEYS.workspaceUrl, '', workspaceSlug)

      const url = new URL(window.location.href)
      if (savedSearch) {
        // Replace all params with the saved workspace's URL
        url.search = savedSearch
      } else {
        // No saved state — default to allSessions
        for (const key of [...url.searchParams.keys()]) {
          url.searchParams.delete(key)
        }
        url.searchParams.set('ws', workspaceSlug)
        url.searchParams.set('route', 'allSessions')
      }

      // Stored history cannot change the workspace selected by the caller.
      url.searchParams.set('ws', workspaceSlug)

      // Push a new history entry for the workspace switch
      const seq = nextHistorySeqRef.current++
      history.pushState({ seq }, '', url.toString())
      historySeqRef.current = seq
      historyMaxSeqRef.current = seq
      updateCanGoBackForward()

      // Reconcile panels from the new URL
      reconcileFromUrlParamsRef.current(new URLSearchParams(url.search))
      lastSemanticHistoryKeyRef.current = getSemanticHistoryKey()
    }

    initialRouteRestoredRef.current = true

    finishHistoryReconcile()
  }, [workspaceId, workspaceSlug, store, updateCanGoBackForward, getSemanticHistoryKey, isReady, isSessionsReady, finishHistoryReconcile])

  // =========================================================================
  // INITIAL ROUTE RESTORATION (CMD+R reload)
  // =========================================================================

  const initialWorkspaceSwitchRef = useRef<string | null>(null)
  useEffect(() => {
    if (!canRunInitialRestore({
      isReady,
      isSessionsReady,
      workspaceId,
      initialRouteRestored: initialRouteRestoredRef.current,
    })) return
    const params = new URLSearchParams(window.location.search)
    const requested = params.get('ws')
    if (requested && requested !== workspaceSlug && onSwitchWorkspaceBySlug) {
      if (initialWorkspaceSwitchRef.current === requested) return
      initialWorkspaceSwitchRef.current = requested
      isPopstateSwitchRef.current = true
      if (requestWorkspaceSwitch(requested)) return
      isPopstateSwitchRef.current = false
    }
    initialRouteRestoredRef.current = true

    // Suppress pushState during initial restoration
    suppressPushRef.current = true

    // Reconcile panels + sidebar from current URL
    reconcileFromUrlParamsRef.current(params)
    lastSemanticHistoryKeyRef.current = getSemanticHistoryKey()

    // If nothing was in the URL, navigate to default
    if (!params.get('route') && !params.get('panels') && (!requested || requested === workspaceSlug)) {
      navigate(routes.view.allSessions())
    }

    // Initialize history with seq=0 (replaceState so we don't create an extra entry)
    history.replaceState({ seq: 0 }, '', window.location.href)
    historySeqRef.current = 0
    historyMaxSeqRef.current = 0

    finishHistoryReconcile()
  }, [isReady, isSessionsReady, workspaceId, workspaceSlug, onSwitchWorkspaceBySlug, requestWorkspaceSwitch, navigate, store, getSemanticHistoryKey, finishHistoryReconcile])

  // =========================================================================
  // PENDING NAVIGATION
  // =========================================================================

  useEffect(() => {
    if (isReady && isSessionsReady && initialRouteRestoredRef.current && !isPopstateSwitchRef.current && pendingNavigationRef.current) {
      const pending = pendingNavigationRef.current
      pendingNavigationRef.current = null

      // Startup restoration owns the workspace boundary. An old request cannot
      // recover the URL into that workspace or execute an action there.
      if (requestedWorkspaceSlugRef.current && requestedWorkspaceSlugRef.current !== workspaceSlug) return
      if (pending.workspaceId !== workspaceId) return
      if (!pending.owner.active || pending.owner !== navigationOwnerRef.current) return
      void navigate(pending.route, pending.options).catch(() => { toast.error(t('common.unavailable')) })
    }
  }, [isReady, isSessionsReady, workspaceId, workspaceSlug, navigate, t])

  // =========================================================================
  // DEEP LINK LISTENER
  // =========================================================================

  useEffect(() => {
    if (!workspaceId) return

    const owner = navigationOwnerRef.current
    let active = true
    const cleanup = window.electronAPI.onDeepLinkNavigate((nav: DeepLinkNavigation) => {
      if (!active || !owner.active || navigationOwnerRef.current !== owner) return
      let route: string | null = null

      if (nav.view) {
        route = nav.view
      } else if (nav.action) {
        route = `action/${nav.action}`
        if (nav.actionParams?.id) {
          route += `/${nav.actionParams.id}`
        }
        const otherParams = { ...nav.actionParams }
        delete otherParams.id
        if (Object.keys(otherParams).length > 0) {
          const params = new URLSearchParams(otherParams)
          route += `?${params.toString()}`
        }
      }

      if (route) {
        // A view payload cannot acquire action capabilities by changing its text.
        if (nav.view && parseRoute(route)?.type === 'action') {
          toast.error(t('toast.invalidLink'), {
            description: t('toast.invalidLinkDesc'),
          })
          return
        }
        // Keep failed view addresses visible, while reporting rejected actions once.
        void navigate(route as Route).catch(() => { toast.error(t('common.unavailable')) })
      }
    })

    return () => {
      active = false
      cleanup()
    }
  }, [workspaceId, remoteWorkspaceId, navigate, t])

  // =========================================================================
  // INTERNAL NAVIGATION EVENT LISTENER
  // =========================================================================

  useEffect(() => {
    const handleNavigateEvent = (event: Event) => {
      const customEvent = event as CustomEvent<{ route: Route; newPanel?: boolean; targetLaneId?: 'main' }>
      if (customEvent.detail?.route) {
        const { route: r, newPanel, targetLaneId } = customEvent.detail
        navigate(r, newPanel ? { newPanel, targetLaneId } : undefined)
      }
    }

    window.addEventListener(NAVIGATE_EVENT, handleNavigateEvent)
    return () => {
      window.removeEventListener(NAVIGATE_EVENT, handleNavigateEvent)
    }
  }, [navigate])

  // =========================================================================
  // SIDEBAR HELPERS
  // =========================================================================

  const updateRightSidebar = useCallback((panel: RightSidebarPanel | undefined) => {
    rightSidebarRef.current = panel
    setRightSidebar(panel)
    // pushState handled by the rightSidebar change effect
  }, [])

  const toggleRightSidebar = useCallback((panel?: RightSidebarPanel) => {
    const currentSidebar = rightSidebarRef.current
    const newPanel = panel || (currentSidebar && currentSidebar.type !== 'none'
      ? { type: 'none' as const }
      : { type: 'none' as const })
    updateRightSidebar(newPanel)
  }, [updateRightSidebar])

  // =========================================================================
  // PRESERVE-FILTER NAVIGATION HELPERS
  // =========================================================================

  const navigateToSource = useCallback((sourceSlug?: string) => {
    if (isSourcesNavigation(navigationState) && navigationState.filter?.kind === 'type') {
      switch (navigationState.filter.sourceType) {
        case 'api':
          navigate(routes.view.sourcesApi(sourceSlug))
          return
        case 'mcp':
          navigate(routes.view.sourcesMcp(sourceSlug))
          return
        case 'local':
          navigate(routes.view.sourcesLocal(sourceSlug))
          return
      }
    }
    navigate(routes.view.sources(sourceSlug ? { sourceSlug } : undefined))
  }, [navigationState, navigate])

  const navigateToSession = useCallback((sessionId: string) => {
    if (!isSessionsNavigation(navigationState)) {
      navigate(routes.view.allSessions(sessionId))
      return
    }

    const filter = navigationState.filter
    switch (filter.kind) {
      case 'allSessions':
        navigate(routes.view.allSessions(sessionId))
        break
      case 'flagged':
        navigate(routes.view.flagged(sessionId))
        break
      case 'archived':
        navigate(routes.view.archived(sessionId))
        break
      case 'state':
        navigate(routes.view.state(filter.stateId, sessionId))
        break
      case 'label':
        navigate(routes.view.label(filter.labelId, sessionId))
        break
      case 'view':
        navigate(routes.view.view(filter.viewId, sessionId))
        break
      default:
        navigate(routes.view.allSessions(sessionId))
    }
  }, [navigationState, navigate])

  // =========================================================================
  // AUTO-SELECT ON SESSION LOAD
  // =========================================================================

  useEffect(() => {
    if (suppressAutoSelectRef.current) return
    if (!isReady || !isSessionsReady || !workspaceId) return
    if (requestedWorkspaceSlug && requestedWorkspaceSlug !== workspaceSlug) return
    // Earlier restoration effects can change the focused route in this same
    // effect pass; the render-time navigationState may still describe sessions.
    const currentRoute = store.get(focusedPanelRouteAtom)
    const currentState = currentRoute ? parseRouteToNavigationStateOrUnavailable(currentRoute) : null
    if (!currentState || !isSessionsNavigation(currentState) || currentState.details) return

    const resolved = resolveAutoSelection(currentState)
    if (isSessionsNavigation(resolved) && resolved.details) {
      void navigate(preserveRouteQuery(currentRoute, buildRouteFromNavigationState(resolved)))
    }
  }, [
    isReady,
    isSessionsReady,
    workspaceId,
    workspaceSlug,
    requestedWorkspaceSlug,
    navigationState,
    resolveAutoSelection,
    navigate,
    store,
  ])

  // =========================================================================
  // CONTEXT VALUE
  // =========================================================================

  return (
    <NavigationContext.Provider
      value={{
        navigate,
        isReady,
        isSessionsReady,
        unavailableWorkspaceSlug,
        navigationState,
        navigationRevision,
        canGoBack,
        canGoForward,
        goBack,
        goForward,
        updateRightSidebar,
        toggleRightSidebar,
        navigateToSource,
        navigateToSession,
      }}
    >
      {children}
    </NavigationContext.Provider>
  )
}

/**
 * Hook to access navigation functions
 */
export function useNavigation() {
  const context = useContext(NavigationContext)
  if (!context) {
    throw new Error('useNavigation must be used within NavigationProvider')
  }
  return context
}

/**
 * Hook to access just the navigation state
 */
export function useNavigationState(): NavigationState {
  const { navigationState } = useNavigation()
  return navigationState
}
