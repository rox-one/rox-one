/**
 * Deep Link Handler
 *
 * Parses rox:// URLs and routes to appropriate actions.
 *
 * URL Formats (workspace is optional - uses active window if omitted):
 *
 * Compound format (hierarchical navigation):
 *   rox://allSessions[/session/{sessionId}]            - Session list (all sessions)
 *   rox://flagged[/session/{sessionId}]             - Session list (flagged filter)
 *   rox://state/{stateId}[/session/{sessionId}]     - Session list (state filter)
 *   rox://sources[/source/{sourceSlug}]          - Sources list
 *   rox://settings[/{subpage}]                   - Settings (general, shortcuts, context)
 *   rox://{home|tasks|notes|meetings|knowledge|projects|pages|memory|
 *                  automations|connections|skills|archived|label|view|board|
 *                  table|heatmap|browser|terminal|...}[/...]  - Any renderer view route
 *                  (see COMPOUND_ROUTE_PREFIXES in shared/route-parser.ts)
 *
 * Action format:
 *   rox://action/{actionName}[/{id}][?params]
 *   rox://workspace/{workspaceId}/action/{actionName}[?params]
 *
 * Actions:
 *   new-chat                  - Create new chat, optional ?input=text&name=name&send=true
 *                               If send=true is provided with input, immediately sends the message
 *   resume-sdk-session/{id}   - Resume Claude Code session by SDK session ID
 *   delete-session/{id}       - Delete session
 *   flag-session/{id}         - Flag session
 *   unflag-session/{id}       - Unflag session
 *
 * Examples:
 *   rox://allSessions                               (all sessions view)
 *   rox://allSessions/session/abc123                (specific session)
 *   rox://settings/shortcuts                     (shortcuts page)
 *   rox://sources/source/github                  (github source info)
 *   rox://action/new-chat                        (uses active window)
 *   rox://action/resume-sdk-session/{sdkId}      (resume Claude Code session)
 *   rox://workspace/ws123/allSessions/session/abc123   (targets specific workspace)
 */

import type { BrowserWindow } from 'electron'
import { mainLog } from './logger'
import type { WindowManager } from './window-manager'
import { RPC_CHANNELS } from '../shared/types'
import type { EventSink } from '@rox/server-core/transport'
import { isRoxDeeplinkProtocol } from '@rox/shared/identity'
import { ENTITY_ONLY_ROUTE_PREFIXES, isCompoundRoutePrefix } from '../shared/route-parser'
// W1-07 (#1504)
import { isClosedUnifiedSurfaceRoot, isUnifiedSurfaceRoot } from '../shared/surface-routes'
import { isSurfaceGateSettled, whenSurfaceGateReady } from './surface-routes-ipc'
// W1-02 (#1499): cold-start entity deep links wait for the entities.links.v1 state.
import { ENTITIES_FLAG_WAIT_MS, isEntitiesLinksFlagKnown, whenEntitiesLinksFlagKnown } from './entities-flags'
import { parseRuntimeMapLinkUrl } from '../shared/runtime-map-link'

export interface DeepLinkTarget {
  /** Workspace ID - undefined means use active window */
  workspaceId?: string
  /** Compound route format (e.g., 'allSessions/session/abc123', 'settings/shortcuts') */
  view?: string
  /** Action route (e.g., 'new-chat', 'delete-session') */
  action?: string
  actionParams?: Record<string, string>
  /** Window mode - if set, opens in a new window instead of navigating in existing */
  windowMode?: 'focused' | 'full'
  /** Right sidebar param (e.g., 'files/path/to/file', 'history') */
  rightSidebar?: string
}

export interface DeepLinkResult {
  success: boolean
  error?: string
  windowId?: number
}

/**
 * Navigation payload sent to renderer via IPC
 */
export interface DeepLinkNavigation {
  /** Compound route format (e.g., 'allSessions/session/abc123', 'settings/shortcuts') */
  view?: string
  /** Action route (e.g., 'new-chat', 'delete-session') */
  action?: string
  actionParams?: Record<string, string>
}

/**
 * Parse window mode from URL search params
 */
function parseWindowMode(parsed: URL): 'focused' | 'full' | undefined {
  const windowParam = parsed.searchParams.get('window')
  if (windowParam === 'focused' || windowParam === 'full') {
    return windowParam
  }
  return undefined
}

/**
 * Parse right sidebar param from URL search params
 */
function parseRightSidebar(parsed: URL): string | undefined {
  return parsed.searchParams.get('sidebar') || undefined
}

/** Retain view query bytes so malformed escapes reach the recovery boundary. */
function withViewQuery(route: string, parsed: URL): string {
  const query = parsed.search.slice(1).split('&').filter(part => {
    const key = new URLSearchParams(part).keys().next().value
    return key !== 'window' && key !== 'sidebar'
  }).join('&')
  return `${route}${query ? `?${query}` : ''}${parsed.hash}`
}

/**
 * Parse a deep link URL into structured target
 */
export function parseDeepLink(url: string): DeepLinkTarget | null {
  try {
    const parsed = new URL(url)

    if (!isRoxDeeplinkProtocol(parsed.protocol)) {
      return null
    }

    // For custom protocols, the hostname contains the first path segment
    // e.g., rox://workspace/ws123 → hostname='workspace', pathname='/ws123'
    // e.g., rox://allSessions/chat/abc → hostname='allSessions', pathname='/chat/abc'
    const host = parsed.hostname
    // Keep empty segments: collapsing them can turn a malformed link into a
    // different view or an action on an unintended entity.
    const pathParts = parsed.pathname.split('/').slice(1)
    const windowMode = parseWindowMode(parsed)
    const rightSidebar = parseRightSidebar(parsed)

    if (host === 'runtime') {
      const selection = parseRuntimeMapLinkUrl(parsed)
      return selection ? { ...selection, windowMode, rightSidebar } : null
    }

    // rox://auth-callback?... (OAuth callbacks - return null to let existing handler process)
    if (host === 'auth-callback') {
      return null
    }

    // Compound route prefixes — shared with the renderer route parser so every
    // navigable view (home, tasks, notes, meetings, knowledge, projects, …)
    // is reachable via rox://<route>. Entity-only prefixes (docs, goals, …)
    // are gated behind `entities.links.v1` via isCompoundRoutePrefix.
    // rox://allSessions/..., rox://settings/..., etc. (compound routes)
    // W1-07 (#1504): a bare mode root (rox://messenger) follows its own mode
    // flag, pushed from the renderer over IPC (main/surface-routes-ipc.ts).
    if (isClosedUnifiedSurfaceRoot(`${host}${parsed.pathname}`)) return null
    if (isCompoundRoutePrefix(host, `${host}${parsed.pathname}`)) {
      // Reconstruct the full compound route from host + pathname
      const viewRoute = withViewQuery(`${host}${parsed.pathname}`, parsed)
      return {
        workspaceId: undefined,
        view: viewRoute,
        windowMode,
        rightSidebar,
      }
    }

    // rox://workspace/{workspaceId}/... (with workspace targeting)
    if (host === 'workspace') {
      const workspaceId = pathParts[0]
      if (!workspaceId) return null
      decodeURIComponent(workspaceId)

      const result: DeepLinkTarget = { workspaceId, windowMode, rightSidebar }

      // Check what type of route follows the workspace ID
      const routeType = pathParts[1]
      if (pathParts.length > 1 && !routeType) return null

      // Parse compound routes: /workspace/{id}/{compoundRoute}
      // e.g., /workspace/ws123/allSessions/session/abc123
      // W1-07 (#1504): same mode-flag gate for /workspace/{id}/messenger.
      if (routeType && isClosedUnifiedSurfaceRoot(pathParts.slice(1).join('/'))) return null
      if (routeType && isCompoundRoutePrefix(routeType, pathParts.slice(1).join('/'))) {
        const viewRoute = withViewQuery(pathParts.slice(1).join('/'), parsed)
        result.view = viewRoute
        return result
      }

      // Parse /action/{actionName}/...
      if (routeType === 'action') {
        if (pathParts.length < 3 || pathParts.length > 4 || pathParts.some(part => !part) || parsed.hash) return null
        decodeURIComponent(`${parsed.pathname}${parsed.search}`)
        result.action = pathParts[2]
        result.actionParams = {}
        // Handle path-based ID (e.g., /action/delete-session/{sessionId})
        if (pathParts[3]) {
          result.actionParams.id = pathParts[3]
        }
        parsed.searchParams.forEach((value, key) => {
          // Skip the window and sidebar params - they're handled separately
          if (key !== 'window' && key !== 'sidebar') {
            result.actionParams![key] = value
          }
        })
        return result
      }

      return result
    }

    // rox://action/... (no workspace - uses active window)
    if (host === 'action') {
      if (pathParts.length < 1 || pathParts.length > 2 || pathParts.some(part => !part) || parsed.hash) return null
      decodeURIComponent(`${parsed.pathname}${parsed.search}`)
      const result: DeepLinkTarget = {
        workspaceId: undefined,
        action: pathParts[0],
        actionParams: {},
        windowMode,
        rightSidebar,
      }

      if (pathParts[1]) {
        result.actionParams!.id = pathParts[1]
      }

      parsed.searchParams.forEach((value, key) => {
        // Skip the window and sidebar params - they're handled separately
        if (key !== 'window' && key !== 'sidebar') {
          result.actionParams![key] = value
        }
      })

      return result
    }

    return null
  } catch (error) {
    mainLog.error('[DeepLink] Failed to parse URL:', url, error)
    return null
  }
}

/**
 * Wait for window's renderer to signal ready
 */
function waitForWindowReady(window: BrowserWindow): Promise<void> {
  return new Promise((resolve) => {
    if (window.webContents.isLoading()) {
      window.webContents.once('did-finish-load', () => {
        // TIMING NOTE: This 100ms delay allows React to mount and register
        // IPC listeners before we send the deep link. `did-finish-load` fires
        // when the HTML is loaded, but React's useEffect hooks haven't run yet.
        // A proper handshake (renderer signals "ready") would be cleaner but
        // adds complexity for minimal gain - this delay is sufficient for all
        // practical cases and only affects reload scenarios.
        setTimeout(resolve, 100)
      })
    } else {
      resolve()
    }
  })
}

/**
 * Build a deep link URL without the window query parameter
 */
function buildDeepLinkWithoutWindowParam(url: string): string {
  const parsed = new URL(url)
  parsed.searchParams.delete('window')
  return parsed.toString()
}

/**
 * W1-07 (#1504): true for `rox://<mode>` / `rox://workspace/{id}/<mode>` whose
 * mode gate is currently closed — the only links worth re-parsing once the
 * renderer has pushed its flags.
 */
export function isClosedSurfaceRootDeepLink(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (!isRoxDeeplinkProtocol(parsed.protocol)) return false
    if (isClosedUnifiedSurfaceRoot(`${parsed.hostname}${parsed.pathname}`)) return true
    if (parsed.hostname !== 'workspace') return false
    const parts = parsed.pathname.split('/').slice(1)
    return Boolean(parts[0]) && isClosedUnifiedSurfaceRoot(parts.slice(1).join('/'))
  } catch {
    return false
  }
}

/**
 * W1-02 (#1499): true for `rox://<entity-only prefix>/…` and
 * `rox://workspace/{id}/<entity-only prefix>/…` (docs, goals, base, …) —
 * the links whose acceptance depends on `entities.links.v1`.
 * W1-07 (#1504): a bare unified mode root (`rox://messenger`,
 * `rox://workspace/{id}/goals`) is excluded — it follows its mode flag (the
 * surface hold), not `entities.links.v1`.
 */
export function isEntityOnlyDeepLink(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (!isRoxDeeplinkProtocol(parsed.protocol)) return false
    if (parsed.hostname === 'workspace') {
      const parts = parsed.pathname.split('/').slice(1)
      return Boolean(parts[0]) && ENTITY_ONLY_ROUTE_PREFIXES.has(parts[1] ?? '') && !isUnifiedSurfaceRoot(parts.slice(1).join('/'))
    }
    return ENTITY_ONLY_ROUTE_PREFIXES.has(parsed.hostname) && !isUnifiedSurfaceRoot(`${parsed.hostname}${parsed.pathname}`)
  } catch {
    return false
  }
}

/**
 * How long a cold-start mode-root link waits for the renderer's first gate
 * push. The first timeout latches the gate (see surface-routes-ipc): later
 * links never wait again in this process.
 */
export const SURFACE_GATE_WAIT_MS = 10_000

/**
 * Per-app EXTERNAL deep-link sequence: every link arriving through external
 * ingress (`handleDeepLink`: OS open-url, second instance, cold start) takes
 * the next number. A held external link that resolves after a LATER
 * external link arrived is dropped, so the user's most recent link wins (a
 * held link would otherwise navigate after a later link that was handled
 * immediately). Internal navigations (`createWindow({ initialDeepLink })`,
 * e.g. OPEN_SESSION_IN_NEW_WINDOW) neither bump nor supersede.
 */
let deepLinkSequence = 0

export type DeepLinkDropReason = 'timeout' | 'superseded'

/**
 * `resolveDeepLinkTarget` with the reason a held link was dropped
 * (`target: null` plus `dropped`); a plain unparseable link has no reason.
 *
 * Two holds, in order:
 *  1. W1-02 (#1499) entity hold — an entity-only link that arrives before
 *     main knows the `entities.links.v1` state waits for that state.
 *  2. W1-07 (#1504) surface hold — a mode-root link that hits a still-closed
 *     gate before the renderer's first push waits for that push and is
 *     re-parsed. The first timeout latches the gate: no later link waits.
 * Either hold drops the link on timeout (logged) or when a later external
 * link superseded it. Once both states are known nothing waits, so
 * flags-off behaviour is main's.
 */
export async function resolveDeepLinkTargetDetailed(
  url: string,
  options: { timeoutMs?: number; external?: boolean } = {},
): Promise<{ target: DeepLinkTarget | null; dropped?: DeepLinkDropReason }> {
  const sequence = options.external ? ++deepLinkSequence : null
  const superseded = () => sequence !== null && sequence !== deepLinkSequence

  // 1. Entity hold (#1499).
  if (!isEntitiesLinksFlagKnown() && isEntityOnlyDeepLink(url)) {
    mainLog.info('[DeepLink] Holding entity link until the entities.links.v1 state is known:', url)
    const ready = await whenEntitiesLinksFlagKnown(options.timeoutMs ?? ENTITIES_FLAG_WAIT_MS)
    if (superseded()) {
      mainLog.info('[DeepLink] Dropping held entity link superseded by a later link:', url)
      return { target: null, dropped: 'superseded' }
    }
    if (!ready) {
      mainLog.warn('[DeepLink] entities.links.v1 state never arrived; dropping entity link:', url)
      return { target: null, dropped: 'timeout' }
    }
  }

  // 2. Surface hold (#1504).
  const target = parseDeepLink(url)
  if (target || isSurfaceGateSettled() || !isClosedSurfaceRootDeepLink(url)) return { target }
  mainLog.info('[DeepLink] Holding mode-root link until the renderer pushes the surface gate:', url)
  const ready = await whenSurfaceGateReady(options.timeoutMs ?? SURFACE_GATE_WAIT_MS)
  if (superseded()) {
    mainLog.info('[DeepLink] Dropping held mode-root link superseded by a later link:', url)
    return { target: null, dropped: 'superseded' }
  }
  if (!ready) {
    mainLog.warn('[DeepLink] Surface gate never arrived; dropping mode-root link:', url)
    return { target: null, dropped: 'timeout' }
  }
  return { target: parseDeepLink(url) }
}

/**
 * `resolveDeepLinkTargetDetailed` without the drop reason. Internal callers
 * (window-manager's `initialDeepLink`) use this form: they never supersede a
 * held external link and are never superseded.
 */
export async function resolveDeepLinkTarget(
  url: string,
  options: { timeoutMs?: number } = {},
): Promise<DeepLinkTarget | null> {
  return (await resolveDeepLinkTargetDetailed(url, options)).target
}

/** Test seam. */
export function __resetDeepLinkSequenceForTests(): void {
  deepLinkSequence = 0
}

/**
 * Handle a deep link by navigating to the target
 */
export async function handleDeepLink(
  url: string,
  windowManager: WindowManager,
  sink?: EventSink,
  resolveClientId?: (webContentsId: number) => string | undefined,
  preferredClientId?: string,
): Promise<DeepLinkResult> {
  const { target, dropped } = await resolveDeepLinkTargetDetailed(url, { external: true })

  if (dropped === 'superseded') return { success: false, error: 'Deep link superseded by a later link' }
  if (!target) {
    // Return success for null targets (like auth-callback) - they're handled elsewhere
    if (url.includes('auth-callback')) {
      return { success: true }
    }
    return { success: false, error: 'Invalid deep link URL' }
  }

  mainLog.info('[DeepLink] Handling:', target)

  // If windowMode is set, create a new window instead of navigating in existing
  if (target.windowMode) {
    mainLog.info('[DeepLink] windowMode detected:', target.windowMode)
    // Get workspaceId from target or from current window
    let wsId = target.workspaceId
    if (!wsId) {
      const focusedWindow = windowManager.getFocusedWindow()
      mainLog.info('[DeepLink] focusedWindow:', focusedWindow?.id)
      if (focusedWindow) {
        wsId = windowManager.getWorkspaceForWindow(focusedWindow.webContents.id) ?? undefined
        mainLog.info('[DeepLink] wsId from focused window:', wsId)
      }
      if (!wsId) {
        const allWindows = windowManager.getAllWindows()
        mainLog.info('[DeepLink] allWindows count:', allWindows.length)
        if (allWindows.length > 0) {
          wsId = allWindows[0].workspaceId
          mainLog.info('[DeepLink] wsId from first window:', wsId)
        }
      }
    }

    if (!wsId) {
      mainLog.error('[DeepLink] No workspace available for new window')
      return { success: false, error: 'No workspace available for new window' }
    }

    // Build URL without window param for navigation inside the new window
    const navUrl = buildDeepLinkWithoutWindowParam(url)
    mainLog.info('[DeepLink] Creating new window with navUrl:', navUrl)

    const window = windowManager.createWindow({
      workspaceId: wsId,
      focused: target.windowMode === 'focused',
      initialDeepLink: navUrl,
    })
    mainLog.info('[DeepLink] Window created:', window.webContents.id)

    return { success: true, windowId: window.webContents.id }
  }

  // 1. Get target window (existing behavior for non-window-mode links)
  let window: BrowserWindow | null = null

  if (target.workspaceId) {
    // Workspace specified - focus or create window for that workspace
    window = windowManager.focusOrCreateWindow(target.workspaceId)
  } else {
    // No workspace - use focused window or last active
    window = windowManager.getFocusedWindow() ?? windowManager.getLastActiveWindow()

    if (!window) {
      // No windows at all - can't navigate without a workspace
      return { success: false, error: 'No active window to navigate' }
    }

    // Focus the window
    if (window.isMinimized()) {
      window.restore()
    }
    window.focus()
  }

  // 2. Wait for window to be ready (renderer loaded)
  await waitForWindowReady(window)

  // 3. Send navigation command to renderer
  if (target.view || target.action) {
    const navigation: DeepLinkNavigation = {
      view: target.view,
      action: target.action,
      actionParams: target.actionParams,
    }
    const wsId = target.workspaceId ?? windowManager.getWorkspaceForWindow(window.webContents.id)
    const resolvedClientId = resolveClientId?.(window.webContents.id)

    // Prefer the resolved target window client. Only use preferredClientId as
    // fallback when no resolver was provided (legacy call sites).
    const clientId = resolvedClientId ?? (!resolveClientId ? preferredClientId : undefined)

    if (sink && clientId) {
      sink(RPC_CHANNELS.deeplink.NAVIGATE, { to: 'client', clientId }, navigation)
    } else if (sink && wsId) {
      sink(RPC_CHANNELS.deeplink.NAVIGATE, { to: 'workspace', workspaceId: wsId }, navigation)
    }
  }

  return { success: true, windowId: window.isDestroyed() ? -1 : window.webContents.id }
}
