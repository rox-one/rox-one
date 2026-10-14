/**
 * BrowserPaneManager
 *
 * Owns browser instances as dedicated BrowserWindow objects.
 * Each instance maps 1:1 to a full native window while preserving
 * shared session/cookie partition and CDP automation support.
 */

import { join, parse as parsePath } from 'path'
import { existsSync, mkdirSync } from 'fs'
import { validateFilePath, getWorkspaceAllowedDirs } from '@rox/server-core/handlers'
import { BrowserWindow, WebContentsView, app, ipcMain, nativeTheme, session, shell, type Session as ElectronSession } from 'electron'
import { isOmniboxChord } from './global-input-router'
import { BROWSER_PANE_SESSION_PARTITION } from './browser-pane-session'
import { mainLog } from './logger'
import type { WindowManager } from './window-manager'
import { BrowserCDP, type AccessibilitySnapshot, type ElementGeometry } from './browser-cdp'
import {
  type BrowserEmptyStateLaunchPayload,
  type BrowserEmptyStateLaunchResult,
  type BrowserInstanceInfo,
} from '../shared/types'
import { DEFAULT_THEME, loadAppTheme, getAllowRemoteEvaluate } from '@rox/shared/config'
import { CodedError } from '@rox/shared/protocol'
import { getBrowserLiveFxCornerRadii } from '../shared/browser-live-fx'
import { i18n } from '@rox/shared/i18n'
import type {
  IBrowserPaneManager,
  BrowserInstanceSnapshot,
} from '@rox/server-core/handlers'
import type {
  BrowserCapabilityRequest,
  ScreenshotResultWire,
} from '@rox/server-core/transport'

function escapeOverlayText(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`)
}

export type { BrowserInstanceInfo }

const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL
const TOOLBAR_LOAD_MAX_RETRIES = 4
const TOOLBAR_LOAD_RETRY_DELAY_MS = 500
const TOOLBAR_HEIGHT = 48
/**
 * Grace period before a cold (detached) embedded panel gives up its toolbar
 * renderer. Keeps rapid panel switching cheap while guaranteeing that a panel
 * parked in the stack eventually drops back to a single renderer process.
 */
const EMBEDDED_TOOLBAR_IDLE_TEARDOWN_MS = 30_000
const MAX_CONSOLE_LOG_ENTRIES = 500
const MAX_NETWORK_LOG_ENTRIES = 500
const MAX_DOWNLOAD_LOG_ENTRIES = 200
const DEFAULT_WAIT_TIMEOUT_MS = 10_000
const DEFAULT_WAIT_POLL_MS = 100
const SCREENSHOT_HIDDEN_CAPTURE_ATTEMPTS = 3
const SCREENSHOT_RETRY_DELAY_MS = 120
const SCREENSHOT_RESCUE_PAINT_DELAY_MS = 180
const SCREENSHOT_NETWORK_IDLE_TIMEOUT_MS = 1_000
const SCREENSHOT_NETWORK_IDLE_MS = 300
const THEME_COLOR_SIGNAL_PREFIX = '__craft_theme_color__:'
const THEME_COLOR_NULL_SENTINEL = '__NULL__'
const THEME_OBSERVER_MIN_INTERVAL_MS = 120
const EARLY_THEME_EXTRACTION_DELAY_MS = 100
const BROWSER_EMPTY_STATE_PAGE = 'browser-empty-state.html'
const CRAFT_DEEPLINK_SCHEME_PREFIX = `${process.env.CRAFT_DEEPLINK_SCHEME || 'craftagents'}://`

const THEME_COLOR_EXTRACTOR_FN = String.raw`
() => {
  const toHex = (r, g, b) => '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');

  const parseColor = (str) => {
    if (!str) return null;
    str = str.trim();
    const hm = /^#([0-9a-f]{3,8})$/i.exec(str);
    if (hm) {
      const h = hm[1];
      let r, g, b;
      if (h.length === 3) { r = parseInt(h[0]+h[0],16); g = parseInt(h[1]+h[1],16); b = parseInt(h[2]+h[2],16); }
      else if (h.length >= 6) { r = parseInt(h.slice(0,2),16); g = parseInt(h.slice(2,4),16); b = parseInt(h.slice(4,6),16); }
      else return null;
      return toHex(r, g, b);
    }
    const rm = str.match(/rgba?[\(]\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/);
    if (rm) return toHex(+rm[1], +rm[2], +rm[3]);
    return null;
  };

  const parseBg = (el) => {
    if (!el) return null;
    const bg = getComputedStyle(el).backgroundColor;
    if (!bg || bg === 'transparent' || bg === 'rgba(0, 0, 0, 0)') return null;
    return parseColor(bg);
  };

  // 1. theme-color meta — respect media attribute for light/dark
  const metas = document.querySelectorAll('meta[name="theme-color"]');
  for (const m of metas) {
    const media = m.getAttribute('media');
    if (media && !window.matchMedia(media).matches) continue;
    const c = parseColor(m.content);
    if (c) return c;
  }

  // 2. Safari-like approach: sample fixed/sticky elements at viewport top-center
  const els = document.elementsFromPoint(window.innerWidth / 2, 4);
  for (const el of els) {
    if (el === document.documentElement || el === document.body) continue;
    const style = getComputedStyle(el);
    const pos = style.position;
    if (pos !== 'fixed' && pos !== 'sticky') continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < window.innerWidth * 0.8) continue;
    const c = parseBg(el);
    if (c) return c;
  }

  // 3. Fallback: body then html
  return parseBg(document.body) || parseBg(document.documentElement) || null;
}
`

/** IPC channels for the browser toolbar preload */
const TOOLBAR_CHANNELS = {
  NAVIGATE: 'browser-toolbar:navigate',
  GO_BACK: 'browser-toolbar:go-back',
  GO_FORWARD: 'browser-toolbar:go-forward',
  RELOAD: 'browser-toolbar:reload',
  STOP: 'browser-toolbar:stop',
  MENU_GEOMETRY: 'browser-toolbar:menu-geometry',
  FORCE_CLOSE_MENU: 'browser-toolbar:force-close-menu',
  HIDE: 'browser-toolbar:hide',
  DESTROY: 'browser-toolbar:destroy',
  OPEN_DEVTOOLS: 'browser-toolbar:open-devtools',
  LIST_HISTORY: 'browser-toolbar:list-history',
  LIST_DOWNLOADS: 'browser-toolbar:list-downloads',
  STATE_UPDATE: 'browser-toolbar:state-update',
  THEME_COLOR: 'browser-toolbar:theme-color',
} as const
export const BROWSER_COOKIE_IMPORT_PARTITION = 'persist:browser-cookie-import'
const SESSION_PARTITION = BROWSER_PANE_SESSION_PARTITION

interface AgentControlState {
  active: boolean
  sessionId: string
  displayName?: string
  intent?: string
}

interface AgentControlLockState {
  active: boolean
  previousResizable: boolean
}

/** CSS-pixel rect of an embedded panel relative to the main window's client area. */
export interface EmbeddedBoundsRect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * A native overlay renderer shared by every pane composited onto one host
 * window that uses the same session partition. Materialised on first activation
 * (agent control or a toolbar menu) rather than per panel, so idle panels never
 * pay for an overlay process.
 */
interface NativeOverlayEntry {
  view: WebContentsView
  partition: string
  ready: boolean
  /** Instance currently driving the overlay's bounds/visuals, or null when idle. */
  ownerId: string | null
}

interface BrowserInstance {
  id: string
  partition: string
  /** Null for embedded instances composited onto the main window. */
  window: BrowserWindow | null
  /**
   * Toolbar chrome view. Embedded panels create it lazily on first attach (and
   * drop it again once cold) so a panel that is never shown costs a single
   * renderer process. `null` until materialised.
   */
  toolbarView: WebContentsView | null
  pageView: WebContentsView
  /**
   * Shared native overlay backing this instance's agent-control / toolbar-menu
   * overlay (see {@link BrowserPaneManager.resolveNativeOverlayEntry}). `null`
   * until the overlay is first needed.
   */
  nativeOverlayView: WebContentsView | null
  cdp: BrowserCDP
  /** True for embedded (in-app panel) instances — no OS window is created. */
  embedded: boolean
  /** Last rect reported by the renderer for an embedded instance. */
  embeddedRect: EmbeddedBoundsRect | null
  /** Whether the views are currently attached to a host main window. */
  embeddedAttached: boolean
  /** Host main window the embedded views are currently attached to. */
  embeddedHostWindow: BrowserWindow | null
  /** Resize/closed subscriptions on the current host window. */
  embeddedHostHandlers: { resize: () => void; closed: () => void } | null
  currentUrl: string
  title: string
  favicon: string | null
  isLoading: boolean
  canGoBack: boolean
  canGoForward: boolean
  boundSessionId: string | null
  ownerType: 'session' | 'manual'
  ownerSessionId: string | null
  /**
   * Workspace this instance is associated with, or `null` for unbound manual
   * windows. Renderers in other workspaces filter such entries out of the tab
   * strip / status badge. Stamped at create-time (or first bind) — once non-null,
   * subsequent rebinds may overwrite it with the new binder's workspace.
   */
  workspaceId: string | null
  isVisible: boolean
  isHiding: boolean
  keepAliveOnWindowClose: boolean
  toolbarReady: boolean
  toolbarMenuOpen: boolean
  toolbarMenuHeight: number
  toolbarMenuOverlayActive: boolean
  showOnCreate: boolean
  pendingShowOnReady: boolean
  pendingShowToken: number
  lastAction: LastBrowserAction | null
  agentControl: AgentControlState | null
  lockState: AgentControlLockState
  themeColor: string | null
  inPageThemeTimer: ReturnType<typeof setTimeout> | null
  /** Pending idle teardown of a cold embedded panel's toolbar renderer. */
  toolbarIdleTimer: ReturnType<typeof setTimeout> | null
  themeObserverToken: string | null
  consoleLogs: BrowserConsoleEntry[]
  networkLogs: BrowserNetworkEntry[]
  downloads: BrowserDownloadEntry[]
  lastLaunchToken: string | null
}

interface CreateBrowserInstanceOptions {
  show?: boolean
  ownerType?: 'session' | 'manual'
  ownerSessionId?: string
  workspaceId?: string | null
  useImportedCookies?: boolean
  /** Explicit profile partition; used to mirror an opener's profile for popup-derived tabs. */
  partition?: string
}

export interface BrowserScreenshotOptions {
  mode?: 'raw' | 'agent'
  refs?: string[]
  includeLastAction?: boolean
  includeMetadata?: boolean
  /** Annotate screenshot with @eN labels on all interactive elements from accessibility tree */
  annotate?: boolean
  format?: 'png' | 'jpeg'
  jpegQuality?: number
}

export interface BrowserConsoleEntry {
  timestamp: number
  level: 'log' | 'info' | 'warn' | 'error'
  message: string
}

export interface BrowserConsoleOptions {
  level?: 'all' | BrowserConsoleEntry['level']
  limit?: number
}

export interface BrowserScreenshotRegionTarget {
  x?: number
  y?: number
  width?: number
  height?: number
  ref?: string
  selector?: string
  padding?: number
  format?: 'png' | 'jpeg'
  jpegQuality?: number
}

export interface BrowserNetworkEntry {
  timestamp: number
  method: string
  url: string
  status: number
  resourceType: string
  ok: boolean
}

export interface BrowserNetworkOptions {
  limit?: number
  status?: 'all' | 'failed' | '2xx' | '3xx' | '4xx' | '5xx'
  method?: string
  resourceType?: string
}

export interface BrowserWaitArgs {
  kind: 'selector' | 'text' | 'url' | 'network-idle'
  value?: string
  timeoutMs?: number
  pollMs?: number
  idleMs?: number
}

export interface BrowserWaitResult {
  ok: true
  kind: BrowserWaitArgs['kind']
  elapsedMs: number
  detail: string
}

export interface BrowserKeyArgs {
  key: string
  modifiers?: Array<'shift' | 'control' | 'alt' | 'meta'>
}

export interface BrowserDownloadEntry {
  id: string
  timestamp: number
  url: string
  filename: string
  state: 'started' | 'completed' | 'interrupted' | 'cancelled'
  bytesReceived: number
  totalBytes: number
  mimeType: string
  savePath?: string
}

export interface BrowserDownloadOptions {
  action?: 'list' | 'wait'
  limit?: number
  timeoutMs?: number
}

export interface BrowserScreenshotResult {
  imageBuffer: Buffer
  imageFormat: 'png' | 'jpeg'
  metadata?: {
    mode: 'raw' | 'agent'
    viewport?: {
      width: number
      height: number
      dpr: number
      scrollX: number
      scrollY: number
    }
    targets?: Array<{
      ref: string
      role?: string
      name?: string
      box: { x: number; y: number; width: number; height: number }
      clickPoint: { x: number; y: number }
    }>
    action?: {
      tool: string
      ref?: string
      status: 'succeeded' | 'failed'
      timestamp: number
    }
    annotationPartial?: boolean
    warnings?: string[]
    region?: {
      x: number
      y: number
      width: number
      height: number
    }
    targetMode?: 'coords' | 'ref' | 'selector'
  }
}

interface LastBrowserAction {
  tool: string
  ref?: string
  status: 'succeeded' | 'failed'
  geometry?: ElementGeometry
  timestamp: number
}

let instanceCounter = 0

export class BrowserPaneManager implements IBrowserPaneManager {
  /** Test override so pane-manager tests do not mock.module the real BrowserCDP. */
  static CdpImpl = BrowserCDP

  private instances: Map<string, BrowserInstance> = new Map()
  private cookieImportConsent = false
  private destroyingIds: Set<string> = new Set()
  private stateChangeCallback: ((info: BrowserInstanceInfo) => void) | null = null
  private removedCallback: ((id: string) => void) | null = null
  private interactedCallback: ((id: string) => void) | null = null
  /** Sessions that already have permission handlers attached. */
  private partitionPermissionsInitialized = new WeakSet<ElectronSession>()
  /** Sessions that already have network/download observers attached. */
  private partitionObserversInitialized = new WeakSet<ElectronSession>()
  private inFlightRequestsByWebContentsId = new Map<number, number>()
  private lastNetworkActivityByWebContentsId = new Map<number, number>()
  private popupWindowsByParentInstanceId = new Map<string, Set<BrowserWindow>>()
  private popupParentByWebContentsId = new Map<number, string>()
  private windowManager: WindowManager | null = null
  private sessionPathResolver: ((sessionId: string) => string | null) | null = null
  /**
   * Native overlay renderers, keyed first by host window and then by session
   * partition. One overlay process per window instead of one per embedded
   * panel; entries are created on first activation and never eagerly.
   */
  private nativeOverlaysByHostWindow = new WeakMap<BrowserWindow, Map<string, NativeOverlayEntry>>()

  setWindowManager(windowManager: WindowManager): void {
    this.windowManager = windowManager
  }

  setSessionPathResolver(fn: (sessionId: string) => string | null): void {
    this.sessionPathResolver = fn
  }

  onStateChange(callback: (info: BrowserInstanceInfo) => void): void {
    this.stateChangeCallback = callback
  }

  onRemoved(callback: (id: string) => void): void {
    this.removedCallback = callback
  }

  onInteracted(callback: (id: string) => void): void {
    this.interactedCallback = callback
  }
  setCookieImportConsent(enabled: boolean): void {
    this.cookieImportConsent = enabled
    if (!enabled) {
      for (const instance of [...this.instances.values()]) {
        if (instance.partition === BROWSER_COOKIE_IMPORT_PARTITION) this.destroyInstance(instance.id)
      }
    }
  }

  createInstance(id?: string, options?: CreateBrowserInstanceOptions): string {
    const instanceId = id || `browser-${++instanceCounter}`
    const shouldShow = options?.show ?? false
    const ownerType = options?.ownerType ?? 'manual'
    const ownerSessionId = ownerType === 'session' ? (options?.ownerSessionId ?? null) : null
    const workspaceId = options?.workspaceId ?? null

    if (this.instances.has(instanceId)) {
      mainLog.warn(`[browser-pane] Instance already exists, reusing: ${instanceId}`)
      return instanceId
    }

    const requestedPartition =
      typeof options?.partition === 'string' && options.partition.trim().length > 0
        ? options.partition.trim()
        : null
    const partition =
      requestedPartition === BROWSER_COOKIE_IMPORT_PARTITION
        ? this.cookieImportConsent
          ? BROWSER_COOKIE_IMPORT_PARTITION
          : SESSION_PARTITION
        : requestedPartition
          ?? (options?.useImportedCookies === true && this.cookieImportConsent
            ? BROWSER_COOKIE_IMPORT_PARTITION
            : SESSION_PARTITION)
    const ses = session.fromPartition(partition)
    this.setupSessionPermissions(ses)
    this.setupSessionObservers(ses)

    // Match background to current OS theme to prevent black/white flash on open
    const bgColor = nativeTheme.shouldUseDarkColors ? '#2b292e' : '#fafafb'

    const window = new BrowserWindow({
      width: 1200,
      height: 900,
      minWidth: 700,
      minHeight: 500,
      show: false, // Always hidden until toolbar is painted (ready-to-show)
      backgroundColor: bgColor,
      // Fully chromeless — toolbar is rendered in a dedicated WebContentsView
      frame: false,
      webPreferences: {
        partition,
        session: ses,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    })

    const pageView = new WebContentsView({
      webPreferences: {
        partition,
        session: ses,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    })

    if (typeof window.contentView?.addChildView !== 'function') {
      throw new Error('[browser-pane] Native overlay requires BrowserWindow.contentView.addChildView')
    }

    // Set the page background to match theme so about:blank doesn't flash white
    const pageWcWithBg = pageView.webContents as typeof pageView.webContents & { setBackgroundColor?: (color: string) => void }
    pageWcWithBg.setBackgroundColor?.(bgColor)

    const cdp = new BrowserPaneManager.CdpImpl(pageView.webContents)

    const instance: BrowserInstance = {
      id: instanceId,
      partition,
      window,
      // Windowed instances own an OS window whose ready-to-show gate depends on
      // the toolbar, so their chrome is materialised right below. The native
      // overlay is shared per host window and only appears once agent control /
      // a toolbar menu actually needs it.
      toolbarView: null,
      pageView,
      nativeOverlayView: null,
      cdp,
      currentUrl: 'about:blank',
      title: i18n.t('browser.newTab'),
      favicon: null,
      isLoading: false,
      canGoBack: false,
      canGoForward: false,
      boundSessionId: ownerSessionId,
      ownerType,
      ownerSessionId,
      workspaceId,
      isVisible: false,
      isHiding: false,
      keepAliveOnWindowClose: true,
      toolbarReady: false,
      toolbarMenuOpen: false,
      toolbarMenuHeight: 0,
      toolbarMenuOverlayActive: false,
      showOnCreate: shouldShow,
      pendingShowOnReady: false,
      pendingShowToken: 0,
      lastAction: null,
      agentControl: null,
      lockState: {
        active: false,
        previousResizable: this.getWindowResizable(window),
      },
      themeColor: null,
      inPageThemeTimer: null,
      toolbarIdleTimer: null,
      themeObserverToken: null,
      consoleLogs: [],
      networkLogs: [],
      downloads: [],
      lastLaunchToken: null,
      embedded: false,
      embeddedRect: null,
      embeddedAttached: false,
      embeddedHostWindow: null,
      embeddedHostHandlers: null,
    }

    const defaultUa = pageView.webContents.userAgent || ''
    const sanitizedUa = defaultUa.replace(/\sElectron\/[^\s]+/g, '')
    if (sanitizedUa && sanitizedUa !== defaultUa) {
      pageView.webContents.setUserAgent(sanitizedUa)
    }

    this.addPaneView(window, pageView)
    const toolbarView = this.ensureToolbarView(instance)
    if (toolbarView) {
      this.setTopPaneView(window, toolbarView)
    }

    this.layoutAllViews(instance)

    this.setupWindowListeners(instance)
    this.instances.set(instanceId, instance)
    this.emitStateChange(instance)
    mainLog.info(`[browser-pane] toolbar version: v4-react-chromeless`)
    mainLog.info(`[browser-pane] Created instance: ${instanceId} (show=${shouldShow}, ownerType=${ownerType}, ownerSessionId=${ownerSessionId ?? 'none'})`)

    void this.loadEmptyStatePage(instance).catch((error) => {
      mainLog.warn(`[browser-pane] empty-state load failed id=${instance.id}: ${error instanceof Error ? error.message : String(error)}`)
      void pageView.webContents.loadURL('about:blank')
    })

    return instanceId
  }

  /**
   * Whether an instance is permanently unusable: windowed → the OS window is
   * destroyed; embedded → the page webContents is destroyed.
   */
  private isInstanceGone(instance: BrowserInstance): boolean {
    if (instance.embedded) {
      return instance.pageView.webContents.isDestroyed()
    }
    return !instance.window || instance.window.isDestroyed()
  }

  destroyInstance(id: string): void {
    const instance = this.instances.get(id)
    if (!instance) {
      mainLog.info(`[browser-pane] destroy requested for missing instance id=${id}`)
      return
    }

    const destroyedBefore = this.isInstanceGone(instance)
    mainLog.info(`[browser-pane] destroy requested id=${id} destroyedBefore=${destroyedBefore} keepAlive=${instance.keepAliveOnWindowClose}`)

    // Clear pending timers before destroying the window
    if (instance.inPageThemeTimer) {
      clearTimeout(instance.inPageThemeTimer)
      instance.inPageThemeTimer = null
    }
    this.cancelEmbeddedToolbarTeardown(instance)
    instance.themeObserverToken = null
    instance.pendingShowOnReady = false
    instance.pendingShowToken += 1

    // Clean up in-flight network tracking for this instance's webContents
    const wcId = instance.pageView.webContents.id
    this.inFlightRequestsByWebContentsId.delete(wcId)
    this.lastNetworkActivityByWebContentsId.delete(wcId)

    const runCleanup = (label: string, action: () => void): void => {
      try {
        action()
      } catch (error) {
        mainLog.warn(`[browser-pane] destroy cleanup failed id=${id} step=${label} error=${error instanceof Error ? error.message : String(error)}`)
      }
    }

    runCleanup('closePopupsForParent', () => this.closePopupsForParent(instance.id, 'parent_destroy'))
    runCleanup('applyAgentControlLock', () => this.applyAgentControlLock(instance, false))
    runCleanup('updateNativeOverlayState', () => this.updateNativeOverlayState(instance))
    if (instance.embedded) {
      runCleanup('detachEmbeddedViews', () => this.detachEmbeddedViews(instance))
    }

    try {
      if (instance.window && !instance.window.isDestroyed()) {
        this.destroyingIds.add(id)
        instance.window.destroy()
      }
    } catch (error) {
      mainLog.warn(`[browser-pane] destroy failed id=${id} error=${error instanceof Error ? error.message : String(error)}`)
    } finally {
      // Finalize synchronously in case closed does not fire (or fires later).
      this.finalizeDestroyedInstance(instance, 'destroy')
      mainLog.info(`[browser-pane] destroy completed id=${id} removed=${!this.instances.has(id)}`)
    }
  }

  getInstance(id: string): BrowserInstance | undefined {
    return this.instances.get(id)
  }

  private cleanupDestroyedInstance(instance: BrowserInstance, reason: string): void {
    this.finalizeDestroyedInstance(instance, 'closed')
    mainLog.info(`[browser-pane] cleaned up stale instance ${instance.id}: ${reason}`)
  }

  /**
   * Get an instance that is confirmed alive (window not destroyed).
   * Throws a clear error if the instance is missing or its window was closed.
   * Automatically cleans up stale entries from the instance map.
   */
  private requireAliveInstance(id: string): BrowserInstance {
    const instance = this.instances.get(id)
    if (!instance) throw new Error(`Browser instance not found: ${id}`)
    if (this.isInstanceGone(instance)) {
      this.cleanupDestroyedInstance(instance, `lookup by id ${id}`)
      throw new Error(instance.embedded
        ? `Browser instance was destroyed (instance: ${id})`
        : `Browser window was closed (instance: ${id})`)
    }
    return instance
  }

  async handleEmptyStateLaunchFromRenderer(
    senderWebContentsId: number,
    payload: BrowserEmptyStateLaunchPayload,
  ): Promise<BrowserEmptyStateLaunchResult> {
    const instance = this.findInstanceByPageWebContentsId(senderWebContentsId)
    if (!instance) {
      mainLog.warn(`[browser-pane] empty-state launch ignored: sender not mapped senderWebContentsId=${senderWebContentsId}`)
      return { ok: false, handled: false, reason: 'instance_not_found' }
    }

    const route = payload.route?.trim()
    if (!route) {
      mainLog.warn(`[browser-pane] empty-state launch missing route id=${instance.id}`)
      return { ok: false, handled: false, reason: 'missing_route' }
    }

    const token = payload.token ?? null
    const handled = await this.triggerEmptyStateRouteLaunch(instance, route, token, 'ipc')
    return {
      ok: true,
      handled,
      reason: handled ? undefined : 'duplicate',
    }
  }

  private findInstanceByPageWebContentsId(senderWebContentsId: number): BrowserInstance | undefined {
    for (const instance of this.instances.values()) {
      if (instance.pageView.webContents.id === senderWebContentsId) {
        return instance
      }
    }
    return undefined
  }

  private resolveLaunchWorkspaceId(): string | null {
    if (!this.windowManager) return null

    const lastActiveWindow = this.windowManager.getLastActiveWindow()
    if (lastActiveWindow) {
      const workspaceId = this.windowManager.getWorkspaceForWindow(lastActiveWindow.webContents.id)
      if (workspaceId) return workspaceId
    }

    const managedWindows = this.windowManager.getAllWindows()
    return managedWindows[0]?.workspaceId ?? null
  }

  private buildDeepLinkFromRoute(route: string): string {
    const queryStart = route.indexOf('?')
    const routePath = queryStart >= 0 ? route.slice(0, queryStart) : route
    const routeQuery = queryStart >= 0 ? route.slice(queryStart + 1) : ''
    let normalizedPath = routePath.replace(/^\/+/, '')

    const workspaceId = this.resolveLaunchWorkspaceId()
    if (workspaceId && !normalizedPath.startsWith('workspace/')) {
      normalizedPath = `workspace/${encodeURIComponent(workspaceId)}/${normalizedPath}`
    }

    return `${CRAFT_DEEPLINK_SCHEME_PREFIX}${normalizedPath}${routeQuery ? `?${routeQuery}` : ''}`
  }

  private async triggerEmptyStateRouteLaunch(
    instance: BrowserInstance,
    route: string,
    token: string | null,
    source: 'hash' | 'ipc',
  ): Promise<boolean> {
    const dedupeToken = token ?? route
    if (dedupeToken && instance.lastLaunchToken === dedupeToken) {
      mainLog.info(`[browser-pane] ignoring duplicate empty-state launch id=${instance.id} source=${source} token=${dedupeToken}`)
      return false
    }

    instance.lastLaunchToken = dedupeToken
    const deepLink = this.buildDeepLinkFromRoute(route)
    mainLog.info(`[browser-pane] handling empty-state launch id=${instance.id} source=${source} route=${route} deepLink=${deepLink}`)

    await this.handleDeepLinkUrl(deepLink)
    return true
  }

  listInstances(): BrowserInstanceInfo[] {
    const infos: BrowserInstanceInfo[] = []
    for (const instance of this.instances.values()) {
      if (!instance.embedded && instance.window?.isDestroyed()) {
        this.cleanupDestroyedInstance(instance, 'listInstances')
        continue
      }
      infos.push(this.toInfo(instance))
    }
    return infos
  }

  async listInstancesAsync(): Promise<BrowserInstanceInfo[]> {
    return this.listInstances()
  }

  async getInstanceAsync(id: string): Promise<BrowserInstanceSnapshot | undefined> {
    return this.getInstance(id)
  }

  async createForSessionAsync(
    sessionId: string,
    options?: { show?: boolean; workspaceId?: string | null },
  ): Promise<string> {
    return this.createForSession(sessionId, options)
  }

  async getOrCreateForSessionAsync(
    sessionId: string,
    options?: { workspaceId?: string | null },
  ): Promise<string> {
    return this.getOrCreateForSession(sessionId, options)
  }

  async focusBoundForSessionAsync(
    sessionId: string,
    options?: { workspaceId?: string | null },
  ): Promise<string> {
    return this.focusBoundForSession(sessionId, options)
  }

  getWindowCount(): number {
    return this.instances.size
  }

  getBrowserWindows(): BrowserWindow[] {
    return Array.from(this.instances.values())
      .map((instance) => instance.window)
      .filter((win): win is BrowserWindow => win !== null && !win.isDestroyed())
  }

  async navigate(id: string, url: string): Promise<{ url: string; title: string }> {
    const instance = this.requireAliveInstance(id)

    let normalizedUrl = url.trim()
    const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(normalizedUrl)
    const isAbout = normalizedUrl.startsWith('about:')
    if (!hasScheme && !isAbout) {
      const looksLikeHost = /^(localhost|\d{1,3}(?:\.\d{1,3}){3}|[\w-]+(?:\.[\w-]+)+)(?::\d+)?(?:\/|$)/i.test(normalizedUrl)
      if (looksLikeHost) {
        normalizedUrl = `https://${normalizedUrl}`
      } else {
        normalizedUrl = `https://duckduckgo.com/?q=${encodeURIComponent(normalizedUrl)}`
      }
    }

    const timeoutMs = 30_000
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null

    try {
      const loaded = instance.pageView.webContents.loadURL(normalizedUrl)
      const timeout = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error(`Navigation to "${normalizedUrl}" timed out after ${timeoutMs / 1000}s`)), timeoutMs)
      })
      await Promise.race([loaded, timeout])
      this.pushToolbarState(instance)

      return { url: instance.currentUrl, title: instance.title }
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle)
      }
    }
  }

  async goBack(id: string): Promise<void> {
    const instance = this.requireAliveInstance(id)
    if (instance.pageView.webContents.canGoBack()) {
      instance.pageView.webContents.goBack()
    }
  }

  async goForward(id: string): Promise<void> {
    const instance = this.requireAliveInstance(id)
    if (instance.pageView.webContents.canGoForward()) {
      instance.pageView.webContents.goForward()
    }
  }

  reload(id: string): void {
    const instance = this.instances.get(id)
    if (!instance || this.isInstanceGone(instance)) return
    instance.pageView.webContents.reload()
  }

  stop(id: string): void {
    const instance = this.instances.get(id)
    if (!instance || this.isInstanceGone(instance)) return
    instance.pageView.webContents.stop()
  }

  openDevTools(id: string): void {
    const instance = this.requireAliveInstance(id)
    if (instance.pageView.webContents.isDestroyed()) return
    instance.pageView.webContents.openDevTools({ mode: 'detach' })
  }

  getNavigationHistory(id: string): Array<{ url: string; title: string }> {
    const instance = this.requireAliveInstance(id)
    const wc = instance.pageView.webContents as Electron.WebContents & {
      navigationHistory?: { getAllEntries?: () => Array<{ url?: string; title?: string }> }
    }
    const entries = wc.navigationHistory?.getAllEntries?.() ?? []
    if (entries.length === 0 && instance.currentUrl) {
      return [{ url: instance.currentUrl, title: instance.title }]
    }
    return entries
      .map((entry) => ({ url: entry.url ?? '', title: entry.title ?? '' }))
      .filter((entry) => entry.url)
  }

  focus(id: string): void {
    const instance = this.instances.get(id)
    // Embedded instances have no OS window — visibility is driven by syncEmbeddedBounds.
    if (!instance || instance.embedded) return

    const win = instance.window
    if (!win || win.isDestroyed()) return

    // If toolbar hasn't painted yet, defer showing until markToolbarReady runs.
    // Token guard prevents stale deferred focus from showing after hide/destroy.
    if (!instance.toolbarReady) {
      // Materialise chrome that was never created (or was released while cold)
      // so its load can release the deferred show.
      if (!instance.toolbarView) this.ensureToolbarView(instance)
      if (instance.pendingShowOnReady) return
      instance.pendingShowOnReady = true
      const token = ++instance.pendingShowToken
      mainLog.info(`[browser-pane] focus deferred until ready id=${instance.id} token=${token}`)
      return
    }

    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()

    instance.isVisible = true
    this.emitStateChange(instance)
  }

  hide(id: string): void {
    const instance = this.instances.get(id)
    if (!instance) return

    if (instance.embedded) {
      this.hideEmbeddedInstance(instance)
      return
    }

    this.closePopupsForParent(instance.id, 'parent_hide')

    // Re-entrancy guard: bail if a hide is already in progress. Prevents the
    // 'close' listener from re-entering hide() during teardown, which can crash
    // Chromium's compositor when the WebContentsView is mid-load.
    if (instance.isHiding) return

    const win = instance.window
    if (!win || win.isDestroyed()) return

    instance.isHiding = true

    // Cancel any deferred show request queued before toolbar was ready.
    if (instance.pendingShowOnReady) {
      instance.pendingShowOnReady = false
      instance.pendingShowToken += 1
    }

    this.forceCloseToolbarMenu(instance, 'window-hide')

    // Cancel an in-flight page load before hiding. Hiding the window while the
    // WebContentsView is still loading can trigger a Chromium compositor assertion
    // and kill the main process.
    if (instance.isLoading) {
      try {
        const pageWc = instance.pageView.webContents
        if (!pageWc.isDestroyed()) pageWc.stop()
      } catch (error) {
        mainLog.warn(`[browser-pane] failed to stop page load before hide id=${id}: ${(error as Error)?.message ?? error}`)
      }
    }

    win.hide()

    instance.isVisible = false

    // Defer the state-change callback so native window teardown completes before
    // listeners (which may touch WebContentsView/Chromium internals) run.
    queueMicrotask(() => {
      instance.isHiding = false
      this.emitStateChange(instance)
    })
  }

  async getAccessibilitySnapshot(id: string): Promise<AccessibilitySnapshot> {
    const instance = this.requireAliveInstance(id)
    return instance.cdp.getAccessibilitySnapshot()
  }

  async clickAtCoordinates(id: string, x: number, y: number): Promise<void> {
    const instance = this.requireAliveInstance(id)

    try {
      await instance.cdp.clickAtCoordinates(x, y)
      instance.lastAction = {
        tool: 'browser_click_at',
        status: 'succeeded',
        timestamp: Date.now(),
      }
    } catch (error) {
      instance.lastAction = {
        tool: 'browser_click_at',
        status: 'failed',
        timestamp: Date.now(),
      }
      throw error
    }
  }

  async drag(id: string, x1: number, y1: number, x2: number, y2: number): Promise<void> {
    const instance = this.requireAliveInstance(id)

    try {
      await instance.cdp.drag(x1, y1, x2, y2)
      instance.lastAction = {
        tool: 'browser_drag',
        status: 'succeeded',
        timestamp: Date.now(),
      }
    } catch (error) {
      instance.lastAction = {
        tool: 'browser_drag',
        status: 'failed',
        timestamp: Date.now(),
      }
      throw error
    }
  }

  async typeText(id: string, text: string): Promise<void> {
    const instance = this.requireAliveInstance(id)

    try {
      await instance.cdp.typeText(text)
      instance.lastAction = {
        tool: 'browser_type',
        status: 'succeeded',
        timestamp: Date.now(),
      }
    } catch (error) {
      instance.lastAction = {
        tool: 'browser_type',
        status: 'failed',
        timestamp: Date.now(),
      }
      throw error
    }
  }

  async setClipboard(id: string, text: string): Promise<void> {
    const instance = this.requireAliveInstance(id)
    await instance.cdp.setClipboard(text)
  }

  async getClipboard(id: string): Promise<string> {
    const instance = this.requireAliveInstance(id)
    return instance.cdp.getClipboard()
  }

  async clickElement(
    id: string,
    ref: string,
    options?: { waitFor?: 'none' | 'navigation' | 'network-idle'; timeoutMs?: number }
  ): Promise<void> {
    const instance = this.requireAliveInstance(id)

    try {
      const geometry = await instance.cdp.clickElement(ref)
      instance.lastAction = {
        tool: 'browser_click',
        ref,
        status: 'succeeded',
        geometry,
        timestamp: Date.now(),
      }

      const waitFor = options?.waitFor ?? 'none'
      if (waitFor === 'navigation') {
        const timeoutMs = Math.max(100, options?.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS)
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            cleanup()
            reject(new Error(
              `Click navigation wait timed out after ${timeoutMs}ms (no navigation event observed). `
              + `Tip: retry with "click ${ref}" (no navigation wait), then use "wait url <pattern>" or "wait network-idle".`
            ))
          }, timeoutMs)

          const onNav = () => {
            cleanup()
            resolve()
          }

          const cleanup = () => {
            clearTimeout(timer)
            instance.pageView.webContents.removeListener('did-navigate', onNav)
            instance.pageView.webContents.removeListener('did-navigate-in-page', onNav)
          }

          instance.pageView.webContents.once('did-navigate', onNav)
          instance.pageView.webContents.once('did-navigate-in-page', onNav)
        })
      } else if (waitFor === 'network-idle') {
        await this.waitFor(id, { kind: 'network-idle', timeoutMs: options?.timeoutMs })
      }
    } catch (error) {
      instance.lastAction = {
        tool: 'browser_click',
        ref,
        status: 'failed',
        timestamp: Date.now(),
      }
      throw error
    }
  }

  async fillElement(id: string, ref: string, value: string): Promise<void> {
    const instance = this.requireAliveInstance(id)

    try {
      const geometry = await instance.cdp.fillElement(ref, value)
      instance.lastAction = {
        tool: 'browser_fill',
        ref,
        status: 'succeeded',
        geometry,
        timestamp: Date.now(),
      }
    } catch (error) {
      instance.lastAction = {
        tool: 'browser_fill',
        ref,
        status: 'failed',
        timestamp: Date.now(),
      }
      throw error
    }
  }

  async selectOption(id: string, ref: string, value: string): Promise<void> {
    const instance = this.requireAliveInstance(id)

    try {
      const geometry = await instance.cdp.selectOption(ref, value)
      instance.lastAction = {
        tool: 'browser_select',
        ref,
        status: 'succeeded',
        geometry,
        timestamp: Date.now(),
      }
    } catch (error) {
      instance.lastAction = {
        tool: 'browser_select',
        ref,
        status: 'failed',
        timestamp: Date.now(),
      }
      throw error
    }
  }

  private suspendOverlayForCapture(instance: BrowserInstance): boolean {
    const entry = this.resolveNativeOverlayEntry(instance)
    const shouldSuspend = !!instance.agentControl?.active
      && !!entry
      && entry.ownerId === instance.id

    if (!shouldSuspend || !entry) return false

    entry.view.setBounds({ x: 0, y: 0, width: 0, height: 0 })
    return true
  }

  private restoreOverlayAfterCapture(instance: BrowserInstance, suspended: boolean): void {
    if (!suspended) return
    this.updateNativeOverlayState(instance)
  }

  async screenshot(id: string, options?: BrowserScreenshotOptions): Promise<BrowserScreenshotResult> {
    const instance = this.requireAliveInstance(id)

    // Hide native agent overlay so it doesn't appear in captures
    const suspendedOverlay = this.suspendOverlayForCapture(instance)

    try {
      // When annotating, force agent mode and gather refs from accessibility tree
      const annotate = !!options?.annotate
      const mode = (annotate || options?.mode === 'agent') ? 'agent' : 'raw'

      if (mode === 'raw') {
        const viewport = await instance.cdp.getViewportMetrics()
        const captured = await this.capturePageWithRecovery(instance, {
          mode,
          errorPrefix: 'screenshot',
          dpr: viewport.dpr,
          format: options?.format,
          jpegQuality: options?.jpegQuality,
        })

        return {
          imageBuffer: captured.imageBuffer,
          imageFormat: captured.imageFormat,
          metadata: options?.includeMetadata
            ? {
              mode: 'raw',
              warnings: captured.warnings.length > 0 ? captured.warnings : undefined,
            }
            : undefined,
        }
      }

      const warnings: string[] = []
      const geometries: ElementGeometry[] = []

      const MAX_ANNOTATED_REFS = 100
      let refs = options?.refs ?? []

      if (annotate) {
        try {
          const snapshot = await instance.cdp.getAccessibilitySnapshot()
          refs = snapshot.nodes.map((node) => node.ref).slice(0, MAX_ANNOTATED_REFS)
          if (snapshot.nodes.length > MAX_ANNOTATED_REFS) {
            warnings.push(`Annotation capped at ${MAX_ANNOTATED_REFS} of ${snapshot.nodes.length} elements`)
          }
        } catch (error) {
          warnings.push(`Accessibility snapshot for annotation failed: ${error instanceof Error ? error.message : String(error)}`)
          refs = []
        }
      }

      const settled = await Promise.allSettled(
        refs.map((ref) => instance.cdp.getElementGeometry(ref)),
      )

      for (let i = 0; i < settled.length; i++) {
        const result = settled[i]!
        if (result.status === 'fulfilled') {
          geometries.push(result.value)
        } else if (!annotate) {
          const reason = result.reason instanceof Error ? result.reason.message : String(result.reason)
          warnings.push(`Could not resolve ref ${refs[i]}: ${reason}`)
        }
      }

      if (options?.includeLastAction && instance.lastAction?.geometry) {
        geometries.push(instance.lastAction.geometry)
      }

      const metadataText = instance.lastAction
        ? `${instance.lastAction.tool} • ${instance.lastAction.status} • ${new Date(instance.lastAction.timestamp).toISOString()}`
        : `browser_screenshot • ${new Date().toISOString()}`

      let annotationPartial = false

      try {
        if (geometries.length > 0 || options?.includeMetadata) {
          await instance.cdp.renderTemporaryOverlay({
            geometries,
            includeMetadata: !!options?.includeMetadata,
            metadataText,
            includeClickPoints: true,
          })
        }
      } catch (error) {
        annotationPartial = true
        warnings.push(`Annotation overlay failed: ${error instanceof Error ? error.message : String(error)}`)
      }

      try {
        const viewport = await instance.cdp.getViewportMetrics()
        const captured = await this.capturePageWithRecovery(instance, {
          mode,
          errorPrefix: 'screenshot',
          dpr: viewport.dpr,
          format: options?.format,
          jpegQuality: options?.jpegQuality,
        })

        if (captured.warnings.length > 0) {
          warnings.push(...captured.warnings)
        }

        return {
          imageBuffer: captured.imageBuffer,
          imageFormat: captured.imageFormat,
          metadata: {
            mode: 'agent',
            viewport,
            targets: geometries.map((g) => ({
              ref: g.ref,
              role: g.role,
              name: g.name,
              box: g.box,
              clickPoint: g.clickPoint,
            })),
            action: instance.lastAction
              ? {
                tool: instance.lastAction.tool,
                ref: instance.lastAction.ref,
                status: instance.lastAction.status,
                timestamp: instance.lastAction.timestamp,
              }
              : undefined,
            annotationPartial,
            warnings: warnings.length > 0 ? warnings : undefined,
          },
        }
      } finally {
        try {
          await instance.cdp.clearTemporaryOverlay()
        } catch {
          // ignore cleanup errors
        }
      }
    } finally {
      this.restoreOverlayAfterCapture(instance, suspendedOverlay)
    }
  }

  async screenshotRegion(id: string, target: BrowserScreenshotRegionTarget): Promise<BrowserScreenshotResult> {
    const instance = this.instances.get(id)
    if (!instance) throw new Error(`Browser instance not found: ${id}`)

    const hasCoords = [target.x, target.y, target.width, target.height].every((v) => typeof v === 'number')
    const hasRef = typeof target.ref === 'string' && target.ref.length > 0
    const hasSelector = typeof target.selector === 'string' && target.selector.length > 0

    const modeCount = [hasCoords, hasRef, hasSelector].filter(Boolean).length
    if (modeCount === 0) {
      throw new Error('Region screenshot requires either coordinates, ref, or selector')
    }
    if (modeCount > 1) {
      throw new Error('Region screenshot target is ambiguous. Provide only one of coordinates, ref, or selector')
    }

    const suspendedOverlay = this.suspendOverlayForCapture(instance)

    try {
      let box: { x: number; y: number; width: number; height: number }

      if (hasRef) {
        const geometry = await instance.cdp.getElementGeometry(String(target.ref))
        box = { ...geometry.box }
      } else if (hasSelector) {
        const geometry = await instance.cdp.getElementGeometryBySelector(String(target.selector))
        box = { ...geometry.box }
      } else {
        box = {
          x: Number(target.x),
          y: Number(target.y),
          width: Number(target.width),
          height: Number(target.height),
        }
      }

      const padding = Math.max(0, Number(target.padding ?? 0))
      box = {
        x: box.x - padding,
        y: box.y - padding,
        width: box.width + padding * 2,
        height: box.height + padding * 2,
      }

      const viewport = await instance.cdp.getViewportMetrics()

      const clippedX = Math.max(0, Math.floor(box.x))
      const clippedY = Math.max(0, Math.floor(box.y))
      const maxWidth = Math.max(0, Math.floor(viewport.width - clippedX))
      const maxHeight = Math.max(0, Math.floor(viewport.height - clippedY))
      const clippedWidth = Math.min(Math.max(1, Math.floor(box.width)), maxWidth)
      const clippedHeight = Math.min(Math.max(1, Math.floor(box.height)), maxHeight)

      if (maxWidth <= 0 || maxHeight <= 0 || clippedWidth <= 0 || clippedHeight <= 0) {
        throw new Error('Resolved screenshot region is outside the current viewport')
      }

      const captured = await this.capturePageWithRecovery(instance, {
        mode: 'region',
        errorPrefix: 'region screenshot',
        rect: {
          x: clippedX,
          y: clippedY,
          width: clippedWidth,
          height: clippedHeight,
        },
        dpr: viewport.dpr,
        format: target.format,
        jpegQuality: target.jpegQuality,
      })

      return {
        imageBuffer: captured.imageBuffer,
        imageFormat: captured.imageFormat,
        metadata: {
          mode: 'raw',
          viewport,
          region: {
            x: clippedX,
            y: clippedY,
            width: clippedWidth,
            height: clippedHeight,
          },
          targetMode: hasRef ? 'ref' : hasSelector ? 'selector' : 'coords',
          warnings: captured.warnings.length > 0 ? captured.warnings : undefined,
        },
      }
    } finally {
      this.restoreOverlayAfterCapture(instance, suspendedOverlay)
    }
  }

  private async capturePageWithRecovery(
    instance: BrowserInstance,
    options: {
      mode: 'raw' | 'agent' | 'region'
      errorPrefix: 'screenshot' | 'region screenshot'
      rect?: { x: number; y: number; width: number; height: number }
      dpr?: number
      format?: 'png' | 'jpeg'
      jpegQuality?: number
    },
  ): Promise<{ imageBuffer: Buffer; imageFormat: 'png' | 'jpeg'; warnings: string[] }> {
    let rescueUsed = false
    let sawDisplaySurfaceUnavailable = false
    const warnings: string[] = []
    const imageOpts = { dpr: options.dpr, format: options.format, jpegQuality: options.jpegQuality }

    for (let attempt = 1; attempt <= SCREENSHOT_HIDDEN_CAPTURE_ATTEMPTS; attempt += 1) {
      let result: { buffer: Buffer; format: 'png' | 'jpeg' } | null = null
      try {
        result = await this.capturePageImage(instance, {
          rect: options.rect,
          useHiddenCaptureOptions: true,
          ...imageOpts,
        })
      } catch (error) {
        if (this.isDisplaySurfaceUnavailableError(error)) {
          sawDisplaySurfaceUnavailable = true
          mainLog.warn(
            `[browser-pane] ${options.errorPrefix} display surface unavailable instance=${instance.id} mode=${options.mode} attempt=${attempt}/${SCREENSHOT_HIDDEN_CAPTURE_ATTEMPTS} visible=${instance.isVisible} url=${instance.currentUrl}`,
          )
        } else {
          throw error
        }
      }

      if (result) {
        if (attempt > 1) {
          warnings.push(`Capture recovered after ${attempt} hidden attempt${attempt === 1 ? '' : 's'}.`)
        }
        return { imageBuffer: result.buffer, imageFormat: result.format, warnings }
      }

      mainLog.warn(
        `[browser-pane] ${options.errorPrefix} empty capture attempt instance=${instance.id} mode=${options.mode} attempt=${attempt}/${SCREENSHOT_HIDDEN_CAPTURE_ATTEMPTS} visible=${instance.isVisible} isLoading=${instance.isLoading} url=${instance.currentUrl}`,
      )

      if (attempt < SCREENSHOT_HIDDEN_CAPTURE_ATTEMPTS) {
        await this.waitForScreenshotReadiness(instance.id)
      }
    }

    const window = instance.window
    const wasVisible = instance.isVisible

    // The window-reveal rescue only applies to windowed instances; an embedded
    // instance is composited onto the main window and is capture-able while attached.
    if (window && !window.isDestroyed()) {
      try {
        if (!wasVisible) {
          if (window.isMinimized()) {
            window.restore()
          }
          window.showInactive()
          instance.isVisible = true
          this.emitStateChange(instance)
          rescueUsed = true
          await this.sleep(SCREENSHOT_RESCUE_PAINT_DELAY_MS)
          await this.waitForScreenshotReadiness(instance.id)
        }

        let rescueResult: { buffer: Buffer; format: 'png' | 'jpeg' } | null = null
        try {
          rescueResult = await this.capturePageImage(instance, {
            rect: options.rect,
            useHiddenCaptureOptions: false,
            ...imageOpts,
          })
        } catch (error) {
          if (this.isDisplaySurfaceUnavailableError(error)) {
            sawDisplaySurfaceUnavailable = true
            mainLog.warn(
              `[browser-pane] ${options.errorPrefix} display surface unavailable during rescue instance=${instance.id} mode=${options.mode} visible=${instance.isVisible} url=${instance.currentUrl}`,
            )
          } else {
            throw error
          }
        }

        if (rescueResult) {
          if (rescueUsed) {
            warnings.push('Capture required temporary inactive reveal for rendering; browser visibility was restored immediately.')
          }
          return { imageBuffer: rescueResult.buffer, imageFormat: rescueResult.format, warnings }
        }
      } finally {
        if (!wasVisible && !window.isDestroyed()) {
          window.hide()
          instance.isVisible = false
          this.emitStateChange(instance)
        }
      }
    }

    mainLog.warn(
      `[browser-pane] ${options.errorPrefix} capture failed after recovery instance=${instance.id} mode=${options.mode} visible=${instance.isVisible} isLoading=${instance.isLoading} url=${instance.currentUrl} rescueUsed=${rescueUsed}`,
    )

    if (sawDisplaySurfaceUnavailable) {
      throw new Error(
        `Failed to capture ${options.errorPrefix}: current display surface is unavailable. `
        + `Try focusing the browser window first ("focus ${instance.id}" or "open --foreground") and retry.`
      )
    }

    throw new Error(`Failed to capture ${options.errorPrefix}: empty image buffer`)
  }

  private isDisplaySurfaceUnavailableError(error: unknown): boolean {
    if (!(error instanceof Error)) return false
    return error.message.toLowerCase().includes('current display surface not available for capture')
  }

  private async capturePageImage(
    instance: BrowserInstance,
    options: {
      rect?: { x: number; y: number; width: number; height: number }
      useHiddenCaptureOptions: boolean
      dpr?: number
      format?: 'png' | 'jpeg'
      jpegQuality?: number
    },
  ): Promise<{ buffer: Buffer; format: 'png' | 'jpeg' } | null> {
    const captureOpts = options.useHiddenCaptureOptions
      ? { stayHidden: true, stayAwake: true }
      : undefined

    let image = options.rect
      ? await instance.pageView.webContents.capturePage(options.rect, captureOpts)
      : await instance.pageView.webContents.capturePage(undefined, captureOpts)

    if (image.isEmpty()) {
      return null
    }

    // Downscale from device pixels to CSS pixels so screenshot coordinates
    // match click-at viewport coordinates (uses Skia Lanczos via 'best')
    const dpr = options.dpr ?? 1
    if (dpr > 1) {
      const size = image.getSize()
      image = image.resize({
        width: Math.round(size.width / dpr),
        height: Math.round(size.height / dpr),
        quality: 'best',
      })
    }

    const fmt = options.format ?? 'png'
    const encoded = fmt === 'jpeg'
      ? image.toJPEG(options.jpegQuality ?? 80)
      : image.toPNG()

    if (!encoded || encoded.length === 0) {
      return null
    }

    return { buffer: encoded, format: fmt }
  }

  private async waitForScreenshotReadiness(instanceId: string): Promise<void> {
    try {
      await this.waitFor(instanceId, {
        kind: 'network-idle',
        timeoutMs: SCREENSHOT_NETWORK_IDLE_TIMEOUT_MS,
        idleMs: SCREENSHOT_NETWORK_IDLE_MS,
      })
    } catch {
      // network-idle can fail on continuously active pages; still proceed after bounded delay
    }

    await this.sleep(SCREENSHOT_RETRY_DELAY_MS)
  }

  getConsoleLogs(id: string, options?: BrowserConsoleOptions): BrowserConsoleEntry[] {
    const instance = this.requireAliveInstance(id)

    const level = options?.level ?? 'all'
    const limit = Math.max(1, Math.min(500, Number(options?.limit ?? 50)))

    const filtered = level === 'all'
      ? instance.consoleLogs
      : instance.consoleLogs.filter((entry) => entry.level === level)

    return filtered.slice(-limit)
  }

  getNetworkLogs(id: string, options?: BrowserNetworkOptions): BrowserNetworkEntry[] {
    const instance = this.requireAliveInstance(id)

    const statusFilter = options?.status ?? 'all'
    const limit = Math.max(1, Math.min(500, Number(options?.limit ?? 50)))
    const method = options?.method?.toUpperCase()
    const resourceType = options?.resourceType?.toLowerCase()

    const filtered = instance.networkLogs.filter((entry) => {
      if (method && entry.method !== method) return false
      if (resourceType && entry.resourceType.toLowerCase() !== resourceType) return false

      if (statusFilter === 'all') return true
      if (statusFilter === 'failed') return !entry.ok
      if (statusFilter === '2xx') return entry.status >= 200 && entry.status < 300
      if (statusFilter === '3xx') return entry.status >= 300 && entry.status < 400
      if (statusFilter === '4xx') return entry.status >= 400 && entry.status < 500
      if (statusFilter === '5xx') return entry.status >= 500 && entry.status < 600
      return true
    })

    return filtered.slice(-limit)
  }

  async waitFor(id: string, args: BrowserWaitArgs): Promise<BrowserWaitResult> {
    const instance = this.requireAliveInstance(id)

    const timeoutMs = Math.max(100, args.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS)
    const pollMs = Math.max(25, args.pollMs ?? DEFAULT_WAIT_POLL_MS)
    const idleMs = Math.max(100, args.idleMs ?? 700)
    const started = Date.now()

    const until = async (predicate: () => Promise<boolean>, detail: string): Promise<BrowserWaitResult> => {
      while (Date.now() - started <= timeoutMs) {
        if (await predicate()) {
          return {
            ok: true,
            kind: args.kind,
            elapsedMs: Date.now() - started,
            detail,
          }
        }
        await this.sleep(pollMs)
      }
      throw new Error(`Wait timed out after ${timeoutMs}ms (${args.kind})`)
    }

    if (args.kind === 'selector') {
      const selector = args.value?.trim()
      if (!selector) throw new Error('browser_wait selector requires value')
      return until(async () => {
        const exists = await instance.pageView.webContents.executeJavaScript(
          `Boolean(document.querySelector(${JSON.stringify(selector)}))`
        )
        return Boolean(exists)
      }, `selector matched: ${selector}`)
    }

    if (args.kind === 'text') {
      const text = args.value?.trim()
      if (!text) throw new Error('browser_wait text requires value')
      return until(async () => {
        const found = await instance.pageView.webContents.executeJavaScript(
          `document.body && document.body.innerText && document.body.innerText.includes(${JSON.stringify(text)})`
        )
        return Boolean(found)
      }, `text found: ${text}`)
    }

    if (args.kind === 'url') {
      const needle = args.value?.trim()
      if (!needle) throw new Error('browser_wait url requires value')
      return until(async () => {
        return instance.currentUrl.includes(needle)
      }, `url matched: ${needle}`)
    }

    if (args.kind === 'network-idle') {
      const wcId = instance.pageView.webContents.id
      return until(async () => {
        const inflight = this.inFlightRequestsByWebContentsId.get(wcId) ?? 0
        const last = this.lastNetworkActivityByWebContentsId.get(wcId) ?? started
        return inflight === 0 && (Date.now() - last) >= idleMs
      }, `network idle for ${idleMs}ms`)
    }

    throw new Error(`Unknown wait kind: ${args.kind}`)
  }

  async sendKey(id: string, args: BrowserKeyArgs): Promise<void> {
    const instance = this.requireAliveInstance(id)

    const key = args.key?.trim()
    if (!key) throw new Error('browser_key requires key')

    const modifiers = (args.modifiers ?? []) as Array<'shift' | 'control' | 'alt' | 'meta'>

    instance.pageView.webContents.sendInputEvent({
      type: 'keyDown',
      keyCode: key,
      modifiers,
    } as any)
    instance.pageView.webContents.sendInputEvent({
      type: 'keyUp',
      keyCode: key,
      modifiers,
    } as any)
  }

  async getDownloads(id: string, options?: BrowserDownloadOptions): Promise<BrowserDownloadEntry[]> {
    const instance = this.requireAliveInstance(id)

    const action = options?.action ?? 'list'
    const limit = Math.max(1, Math.min(200, Number(options?.limit ?? 20)))

    if (action === 'wait') {
      const timeoutMs = Math.max(100, Number(options?.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS))
      const started = Date.now()
      while (Date.now() - started <= timeoutMs) {
        const hasTerminal = instance.downloads.some((d) => d.state === 'completed' || d.state === 'interrupted' || d.state === 'cancelled')
        if (hasTerminal) break
        await this.sleep(100)
      }
    }

    return instance.downloads.slice(-limit)
  }

  // validateUploadFilePath removed — uses shared validateFilePath from @rox/server-core/handlers

  async uploadFile(id: string, ref: string, filePaths: string[]): Promise<ElementGeometry> {
    const instance = this.requireAliveInstance(id)

    const safePaths: string[] = []
    for (const p of filePaths) {
      const workspaceId = this.resolveLaunchWorkspaceId()
      const safePath = await validateFilePath(p, getWorkspaceAllowedDirs(workspaceId), {
        includeHome: true,
      })
      if (!existsSync(safePath)) throw new Error(`File not found: ${p}`)
      safePaths.push(safePath)
    }

    return instance.cdp.setFileInputFiles(ref, safePaths)
  }

  windowResize(id: string, width: number, height: number): { width: number; height: number } {
    const instance = this.requireAliveInstance(id)
    if (!instance.window) {
      throw new Error(`windowResize is not supported for embedded browser instances (instance: ${id})`)
    }
    const window = instance.window

    const requestedViewportWidth = Math.max(320, Math.floor(width))
    const requestedViewportHeight = Math.max(240, Math.floor(height))
    window.setContentSize(requestedViewportWidth, requestedViewportHeight + TOOLBAR_HEIGHT)

    this.layoutAllViews(instance)

    // Return effective viewport dimensions after OS/window min-size constraints are applied.
    const [appliedContentWidth, appliedContentHeight] = window.getContentSize()
    return {
      width: Math.max(0, Math.floor(appliedContentWidth)),
      height: Math.max(0, Math.floor(appliedContentHeight - TOOLBAR_HEIGHT)),
    }
  }

  async evaluate(id: string, expression: string): Promise<unknown> {
    const instance = this.requireAliveInstance(id)
    return instance.pageView.webContents.executeJavaScript(expression)
  }

  async detectSecurityChallenge(id: string): Promise<{ detected: boolean; provider: string; signals: string[] }> {
    const instance = this.instances.get(id)
    if (!instance || this.isInstanceGone(instance)) return { detected: false, provider: 'none', signals: [] }

    const signals: string[] = []
    const title = instance.title || ''
    const url = instance.currentUrl || ''

    // Title-based detection
    if (/^Just a moment/i.test(title)) {
      signals.push('title:just-a-moment')
    }

    // URL-based detection
    if (url.includes('/cdn-cgi/challenge-platform/')) {
      signals.push('url:cdn-cgi-challenge')
    }

    // DOM-based detection via JS evaluation
    try {
      const domSignals = await instance.pageView.webContents.executeJavaScript(`(() => {
        const signals = [];
        const bodyText = (document.body?.innerText || '').slice(0, 2000);
        if (/Verify you are human/i.test(bodyText)) signals.push('text:verify-human');
        if (/Checking (if the site connection is secure|your browser)/i.test(bodyText)) signals.push('text:checking-browser');
        if (/Performing security verification/i.test(bodyText)) signals.push('text:security-verification');
        if (document.querySelector('#challenge-form')) signals.push('dom:challenge-form');
        if (document.querySelector('#turnstile-wrapper')) signals.push('dom:turnstile-wrapper');
        if (document.querySelector('.cf-turnstile')) signals.push('dom:cf-turnstile');
        if (document.querySelector('iframe[src*="challenges.cloudflare.com"]')) signals.push('dom:cf-challenge-iframe');
        return signals;
      })()`) as string[]

      if (Array.isArray(domSignals)) {
        signals.push(...domSignals)
      }
    } catch {
      // JS evaluation can fail if page is in a weird state — don't block on it
    }

    try {
      const snapshot = await instance.cdp.getAccessibilitySnapshot()
      const actionableRoles = new Set([
        'button', 'link', 'textbox', 'searchbox', 'combobox', 'checkbox', 'radio', 'switch',
        'menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab', 'option', 'slider', 'spinbutton', 'listbox',
      ])
      const actionableCount = snapshot.nodes.filter((node) => {
        const role = (node.role || '').toLowerCase()
        return actionableRoles.has(role) && !node.disabled
      }).length

      if (snapshot.nodes.length > 0 && actionableCount <= 2) {
        signals.push(`ax:near-empty(${actionableCount}/${snapshot.nodes.length})`)
      }
    } catch {
      // AX snapshot can fail transiently during navigation; ignore
    }

    const detected = signals.length > 0
    const isCloudflare = signals.some(s =>
      s.includes('cf-') || s.includes('challenge') || s.includes('turnstile') || s === 'title:just-a-moment'
    )
    const provider = detected ? (isCloudflare ? 'cloudflare' : 'unknown') : 'none'

    if (detected) {
      mainLog.info(`[browser-pane] security challenge detected id=${id} provider=${provider} signals=[${signals.join(', ')}]`)
    }

    return { detected, provider, signals }
  }

  async scroll(id: string, direction: 'up' | 'down' | 'left' | 'right', amount = 500): Promise<void> {
    const instance = this.requireAliveInstance(id)

    const deltaX = direction === 'left' ? -amount : direction === 'right' ? amount : 0
    const deltaY = direction === 'up' ? -amount : direction === 'down' ? amount : 0

    await instance.pageView.webContents.executeJavaScript(`window.scrollBy(${deltaX}, ${deltaY})`)
  }

  bindSession(id: string, sessionId: string, options?: { workspaceId?: string | null }): void {
    const instance = this.instances.get(id)
    if (instance) {
      instance.boundSessionId = sessionId
      instance.ownerType = 'session'
      instance.ownerSessionId = sessionId
      // Adopt the new binder's workspace. Manual windows being reused for a
      // session start carrying that session's workspace so the receiving
      // workspace's UI sees them and others don't.
      if (options?.workspaceId !== undefined) {
        instance.workspaceId = options.workspaceId
      }
      this.emitStateChange(instance)
    }
  }

  unbindSession(id: string): void {
    const instance = this.instances.get(id)
    if (instance) {
      instance.boundSessionId = null
      instance.ownerType = 'manual'
      // Preserve ownerSessionId as last-known owner for lifecycle targeting.
      this.emitStateChange(instance)
    }
  }

  /** Unbind all instances bound to the given session (non-destructive — window stays alive and reusable). */
  unbindAllForSession(sessionId: string): void {
    for (const instance of this.instances.values()) {
      if (instance.boundSessionId === sessionId) {
        instance.boundSessionId = null
        instance.ownerType = 'manual'
        // Keep ownerSessionId for post-turn lifecycle commands like `close` and `hide`.
        instance.ownerSessionId = instance.ownerSessionId ?? sessionId
        this.emitStateChange(instance)
        mainLog.info(`[browser-pane] Unbound instance ${instance.id} from session ${sessionId} (owner retained: ${instance.ownerSessionId ?? 'none'})`)
      }
    }
  }

  getBoundForSession(sessionId: string): string | null {
    for (const instance of this.instances.values()) {
      if (instance.ownerType === 'session' && instance.ownerSessionId === sessionId) {
        if (this.isInstanceGone(instance)) {
          this.cleanupDestroyedInstance(instance, `getBoundForSession(${sessionId})`)
          continue
        }
        return instance.id
      }
    }
    return null
  }

  /**
   * Pick an unbound window that the caller's workspace is allowed to adopt.
   *
   * Why workspace filtering matters: when a session ends, its window stays
   * alive and becomes `ownerType='manual'` so the next turn of the **same**
   * session can re-bind it. But the window keeps its original `workspaceId`.
   * Without filtering, a session in workspace B would grab a window left
   * behind by workspace A — moving the window across workspaces, which is
   * exactly the leak this whole workspace-isolation work is fixing.
   *
   * Rule: adoption is allowed if the unbound window has `workspaceId === null`
   * (truly user-opened, no workspace context) OR matches the caller's
   * `workspaceId`. Same-workspace reuse covers the legitimate "turn ended,
   * next turn re-binds" case as well as any future turn of any session in
   * that workspace.
   */
  private findReusableUnboundInstance(workspaceId: string | null): BrowserInstance | null {
    const candidates = Array.from(this.instances.values()).filter(
      (i) =>
        i.boundSessionId === null &&
        i.ownerType === 'manual' &&
        (i.workspaceId === null || i.workspaceId === workspaceId),
    )
    if (candidates.length === 0) return null

    // Prefer visible windows first, then fall back to first available.
    return candidates.find((i) => i.isVisible) ?? candidates[0]
  }

  createForSession(
    sessionId: string,
    options?: { show?: boolean; allowReuseManual?: boolean; workspaceId?: string | null },
  ): string {
    const workspaceId = options?.workspaceId ?? null
    const existing = this.getBoundForSession(sessionId)
    if (existing) {
      // Already bound — adopt the workspace if the caller provided one and the
      // existing instance was bound before we knew about its workspace.
      if (options?.workspaceId !== undefined) {
        const instance = this.instances.get(existing)
        if (instance) instance.workspaceId = options.workspaceId
      }
      if (options?.show) {
        this.focus(existing)
      }
      return existing
    }

    // Reuse an unbound/manual window before creating a new one — local
    // sessions only. Remote agents must always get a fresh window so they
    // can never hijack a window the user opened manually.
    const allowReuseManual = options?.allowReuseManual ?? true
    if (allowReuseManual) {
      const reusable = this.findReusableUnboundInstance(workspaceId)
      if (reusable) {
        this.bindSession(reusable.id, sessionId, { workspaceId })
        if (options?.show) {
          this.focus(reusable.id)
        }
        mainLog.info(`[browser-pane] Reused unbound instance ${reusable.id} for session ${sessionId} (workspace=${workspaceId ?? 'none'})`)
        return reusable.id
      }
    }

    return this.createInstance(undefined, {
      show: options?.show ?? false,
      ownerType: 'session',
      ownerSessionId: sessionId,
      workspaceId,
    })
  }

  focusBoundForSession(sessionId: string, options?: { workspaceId?: string | null }): string {
    const id = this.createForSession(sessionId, { show: true, workspaceId: options?.workspaceId })
    this.focus(id)
    return id
  }

  getOrCreateForSession(sessionId: string, options?: { workspaceId?: string | null }): string {
    return this.createForSession(sessionId, { show: false, workspaceId: options?.workspaceId })
  }

  getBoundInstanceId(sessionId: string): string | null {
    for (const [id, instance] of this.instances) {
      if (instance.boundSessionId === sessionId) {
        if (this.isInstanceGone(instance)) {
          this.cleanupDestroyedInstance(instance, `getBoundInstanceId(${sessionId})`)
          continue
        }
        return id
      }
    }
    return null
  }

  destroyForSession(sessionId: string): void {
    for (const [id, instance] of this.instances) {
      if (instance.boundSessionId === sessionId) {
        this.destroyInstance(id)
      }
    }
  }

  async clearVisualsForSession(sessionId: string): Promise<void> {
    for (const instance of this.instances.values()) {
      if (instance.boundSessionId === sessionId) {
        instance.agentControl = null
        this.applyAgentControlLock(instance, false)
        this.updateNativeOverlayState(instance)
        this.emitStateChange(instance)
      }
    }
  }

  private getAgentControlLabel(agentControl: Pick<AgentControlState, 'displayName' | 'intent'> | null | undefined): string {
    if (agentControl?.intent) {
      return `${agentControl.displayName ?? i18n.t('browser.agentControl.agent') ?? 'Agent'} — ${agentControl.intent}`
    }

    return agentControl?.displayName ?? i18n.t('browser.agentControl.working') ?? 'Agent is working…'
  }

  private reapplyAgentControlVisual(instance: BrowserInstance): void {
    const active = !!instance.agentControl?.active
    this.applyAgentControlLock(instance, active)
    this.updateNativeOverlayState(instance)
  }

  /** Resolve the app's current accent color as a concrete CSS value (not a var reference). */
  private getResolvedAccentColor(): string {
    const isDark = nativeTheme.shouldUseDarkColors
    const userTheme = loadAppTheme()
    const accent = isDark
      ? (userTheme?.dark?.accent ?? userTheme?.accent ?? DEFAULT_THEME.dark!.accent!)
      : (userTheme?.accent ?? DEFAULT_THEME.accent!)
    return accent
  }

  /**
   * Load the overlay document into a shared overlay renderer. Identical markup
   * for every instance, so a single load serves all panes on that host window.
   */
  private async loadNativeOverlayPage(entry: NativeOverlayEntry, instanceId: string): Promise<void> {
    const liveFxPlatform: Parameters<typeof getBrowserLiveFxCornerRadii>[0] =
      process.platform === 'darwin' || process.platform === 'win32' || process.platform === 'linux'
        ? process.platform
        : 'other'
    const cornerRadii = getBrowserLiveFxCornerRadii(liveFxPlatform)

    const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      html, body {
        margin: 0;
        width: 100%;
        height: 100%;
        background: transparent;
        overflow: hidden;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }
      #overlay {
        position: fixed;
        inset: 0;
        border: 2px solid transparent;
        border-top-left-radius: ${cornerRadii.topLeft};
        border-top-right-radius: ${cornerRadii.topRight};
        border-bottom-left-radius: ${cornerRadii.bottomLeft};
        border-bottom-right-radius: ${cornerRadii.bottomRight};
        box-sizing: border-box;
        pointer-events: none;
      }
      #chip {
        position: fixed;
        top: 8px;
        right: 8px;
        padding: 4px 8px;
        border-radius: 7px;
        background: rgba(2, 6, 23, 0.82);
        color: rgba(236, 254, 255, 0.95);
        font-size: 11px;
        line-height: 1.2;
        backdrop-filter: blur(4px);
        max-width: calc(100vw - 16px);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      #shield {
        position: fixed;
        inset: 0;
        pointer-events: none;
        cursor: default;
      }
    </style>
  </head>
  <body>
    <div id="overlay">
      <div id="shield"></div>
      <div id="chip">${escapeOverlayText(i18n.t('browser.agentControl.working') ?? 'Working')}</div>
    </div>
  </body>
</html>`

    try {
      await entry.view.webContents.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(html)}`)
      entry.ready = true
      mainLog.info(`[browser-pane] native overlay ready id=${instanceId} partition=${entry.partition} platform=${liveFxPlatform} corners=${cornerRadii.bottomLeft}/${cornerRadii.bottomRight}`)
      this.refreshOverlayReadiness(entry)
    } catch (error) {
      entry.ready = false
      mainLog.warn(`[browser-pane] native overlay load failed id=${instanceId} partition=${entry.partition}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /** Push a shared overlay's readiness onto every instance it currently backs. */
  private refreshOverlayReadiness(entry: NativeOverlayEntry): void {
    for (const instance of this.instances.values()) {
      if (instance.nativeOverlayView !== entry.view) continue
      this.updateNativeOverlayState(instance)
    }
  }

  private getToolbarEffectiveHeight(instance: BrowserInstance): number {
    if (!instance.toolbarMenuOpen) return TOOLBAR_HEIGHT

    if (instance.embedded) {
      return Math.max(TOOLBAR_HEIGHT, instance.embeddedRect?.height ?? 0)
    }
    if (!instance.window || instance.window.isDestroyed()) return TOOLBAR_HEIGHT
    const [, contentHeight] = instance.window.getContentSize()
    return Math.max(TOOLBAR_HEIGHT, contentHeight)
  }

  private layoutToolbarView(instance: BrowserInstance): void {
    const toolbarView = instance.toolbarView
    if (!toolbarView || !instance.window || instance.window.isDestroyed()) return
    const [width] = instance.window.getContentSize()
    const toolbarHeight = this.getToolbarEffectiveHeight(instance)

    toolbarView.setBounds({ x: 0, y: 0, width, height: toolbarHeight })
  }

  /**
   * Content size available to the instance's views: OS window content size for
   * windowed instances; the renderer-reported rect (or 0×0) for embedded ones.
   */
  private getInstanceContentSize(instance: BrowserInstance): [number, number] {
    if (instance.embedded) {
      return [instance.embeddedRect?.width ?? 0, instance.embeddedRect?.height ?? 0]
    }
    return (instance.window ? instance.window.getContentSize() : [0, 0]) as [number, number]
  }

  /**
   * Window whose contentView composites this instance's views: the instance's
   * own OS window, or the main app window an embedded panel is attached to.
   * Returns null when there is no live host window.
   */
  private resolvePaneHostWindow(instance: BrowserInstance): BrowserWindow | null {
    const host = instance.embedded ? instance.embeddedHostWindow : instance.window
    return host && !host.isDestroyed() ? host : null
  }

  /**
   * Create (once) the toolbar chrome view for an instance.
   *
   * Embedded panels call this on first attach so a panel that is created but
   * never shown costs no toolbar renderer; the same helper re-materialises the
   * toolbar after {@link releaseEmbeddedToolbar} drops it while cold.
   */
  private ensureToolbarView(instance: BrowserInstance): WebContentsView | null {
    const existing = instance.toolbarView
    if (existing) {
      if (!existing.webContents.isDestroyed()) return existing
      instance.toolbarView = null
    }

    let view: WebContentsView
    try {
      view = new WebContentsView({
        webPreferences: {
          preload: join(__dirname, 'browser-toolbar-preload.cjs'),
          partition: instance.partition,
          session: session.fromPartition(instance.partition),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false,
        },
      })
    } catch (error) {
      mainLog.warn(`[browser-pane] toolbar view creation failed id=${instance.id}: ${error instanceof Error ? error.message : String(error)}`)
      return null
    }

    // Transparent so the panel background shows through while the toolbar paints.
    const wcWithBg = view.webContents as typeof view.webContents & { setBackgroundColor?: (color: string) => void }
    wcWithBg.setBackgroundColor?.('#00000000')

    instance.toolbarView = view
    instance.toolbarReady = false
    this.bindToolbarViewListeners(instance, view)

    void this.loadToolbarPage(instance, view)
      .finally(() => {
        // Safety net: if Electron never fires did-finish-load, still unblock focus/show behavior.
        if (instance.toolbarView !== view) return
        if (!instance.toolbarReady) {
          this.markToolbarReady(instance, 'toolbar-load-finalized')
        }
      })

    mainLog.info(`[browser-pane] toolbar view materialised id=${instance.id}`)
    return view
  }

  /**
   * Bind toolbar renderer listeners. Bound per toolbar view (never once per
   * instance) so a released-then-recreated toolbar behaves like the original.
   */
  private bindToolbarViewListeners(instance: BrowserInstance, view: WebContentsView): void {
    const toolbarWc = view.webContents

    toolbarWc.on('did-finish-load', () => {
      if (instance.toolbarView !== view) return
      const loadedUrl = typeof toolbarWc.getURL === 'function' ? toolbarWc.getURL() : ''
      if (!this.isToolbarUiDocumentUrl(loadedUrl)) {
        mainLog.info(`[browser-pane] toolbar did-finish-load ignored id=${instance.id} url=${loadedUrl || 'unknown'}`)
        this.pushToolbarState(instance)
        return
      }

      this.markToolbarReady(instance, 'did-finish-load')
      this.pushToolbarState(instance)
    })

    toolbarWc.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame) return
      mainLog.warn(`[browser-pane] toolbar did-fail-load id=${instance.id} code=${errorCode} url=${validatedURL} error=${errorDescription}`)
    })

    toolbarWc.on('before-input-event', (event) => {
      if (instance.lockState.active) {
        event.preventDefault()
      }
    })
  }

  /**
   * Resolve the shared overlay backing this instance's host window, without
   * creating one. Null until {@link ensureNativeOverlayEntry} has been called.
   */
  private resolveNativeOverlayEntry(instance: BrowserInstance): NativeOverlayEntry | null {
    const host = this.resolvePaneHostWindow(instance)
    if (!host) return null
    return this.nativeOverlaysByHostWindow.get(host)?.get(instance.partition) ?? null
  }

  /**
   * Resolve — creating on first need — the native overlay shared by every pane
   * composited onto this instance's host window with the same partition.
   *
   * One overlay renderer per window instead of one per panel, and it is only
   * materialised once agent control or a toolbar menu actually needs it.
   */
  private ensureNativeOverlayEntry(instance: BrowserInstance): NativeOverlayEntry | null {
    const host = this.resolvePaneHostWindow(instance)
    if (!host) return null

    let byPartition = this.nativeOverlaysByHostWindow.get(host)
    if (!byPartition) {
      byPartition = new Map<string, NativeOverlayEntry>()
      this.nativeOverlaysByHostWindow.set(host, byPartition)
    }

    let entry = byPartition.get(instance.partition)
    if (entry && entry.view.webContents.isDestroyed()) {
      byPartition.delete(instance.partition)
      entry = undefined
    }

    if (!entry) {
      const view = new WebContentsView({
        webPreferences: {
          partition: instance.partition,
          session: session.fromPartition(instance.partition),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      })
      const wcWithBg = view.webContents as typeof view.webContents & { setBackgroundColor?: (color: string) => void }
      wcWithBg.setBackgroundColor?.('#00000000')

      const created: NativeOverlayEntry = {
        view,
        partition: instance.partition,
        ready: false,
        ownerId: null,
      }
      byPartition.set(instance.partition, created)
      this.bindNativeOverlayListeners(created)
      // Attach once, at creation: the overlay is shared, so panel detach must
      // not yank it away from whichever pane is currently driving it.
      try {
        this.addPaneView(host, view)
      } catch (error) {
        mainLog.warn(`[browser-pane] native overlay attach failed id=${instance.id}: ${error instanceof Error ? error.message : String(error)}`)
      }
      void this.loadNativeOverlayPage(created, instance.id)
      mainLog.info(`[browser-pane] native overlay materialised partition=${instance.partition} id=${instance.id}`)
      entry = created
    }

    instance.nativeOverlayView = entry.view
    return entry
  }

  /** Tap-to-dismiss wiring for a shared overlay renderer (bound once per view). */
  private bindNativeOverlayListeners(entry: NativeOverlayEntry): void {
    entry.view.webContents.on('before-input-event', (event, input) => {
      const ownerId = entry.ownerId
      if (!ownerId) return
      const owner = this.instances.get(ownerId)
      if (!owner || !owner.toolbarMenuOverlayActive) return

      const inputType = input.type || ''
      if (inputType === 'mouseDown' || inputType === 'touchStart' || inputType === 'pointerDown') {
        event.preventDefault()
        this.forceCloseToolbarMenu(owner, 'overlay-tap')
      }
    })
  }

  /**
   * Drop this instance's claim on its host window's shared overlay, if it holds
   * one. The overlay view itself survives (another pane may still need it).
   */
  private releaseNativeOverlayClaim(instance: BrowserInstance): void {
    const entry = this.resolveNativeOverlayEntry(instance)
    if (!entry || entry.ownerId !== instance.id) return
    entry.view.setBounds({ x: 0, y: 0, width: 0, height: 0 })
    entry.ownerId = null
  }

  private updateNativeOverlayState(instance: BrowserInstance): void {
    const control = instance.agentControl
    const agentActive = !!control?.active
    const menuActive = !!instance.toolbarMenuOverlayActive
    // An embedded panel that is not composited onto a host window must never
    // drive the shared overlay: unlike the old per-panel overlay it is not
    // detached with the panel, so a hidden pane would leave a stale
    // tap-catcher floating over the app window.
    const attached = !instance.embedded || instance.embeddedAttached
    const shouldShow = (agentActive || menuActive) && attached

    // For embedded instances the "host" is the main app window the views are
    // currently attached to; for windowed instances it's the instance window.
    const hostWindow = this.resolvePaneHostWindow(instance)

    if (!shouldShow) {
      // Release this instance's claim — but never clobber the shared overlay
      // while another pane in the same window is still driving it.
      this.releaseNativeOverlayClaim(instance)
      if (hostWindow && instance.toolbarView) {
        this.setTopPaneView(hostWindow, instance.toolbarView)
      }
      return
    }

    const activeEntry = this.ensureNativeOverlayEntry(instance)
    if (!activeEntry || !hostWindow) return

    // Claim ownership before the readiness gate so the matching release path
    // (this pane simply not needing the overlay any more) can hide it again.
    activeEntry.ownerId = instance.id
    if (!activeEntry.ready) return

    const [width, height] = this.getInstanceContentSize(instance)
    const originX = instance.embedded ? (instance.embeddedRect?.x ?? 0) : 0
    const originY = instance.embedded ? (instance.embeddedRect?.y ?? 0) : 0
    const overlayHeight = Math.max(100, height - TOOLBAR_HEIGHT)
    activeEntry.view.setBounds({ x: originX, y: originY + TOOLBAR_HEIGHT, width, height: overlayHeight })
    // Windowed instances re-layout on host resize; embedded views re-layout via layoutEmbeddedViews.
    if (instance.toolbarView) {
      this.setTopPaneView(hostWindow, instance.toolbarView)
    }

    if (agentActive) {
      const label = this.getAgentControlLabel(control)
      const accent = this.getResolvedAccentColor()

      void activeEntry.view.webContents.executeJavaScript(`(() => {
        const overlay = document.getElementById('overlay');
        const chip = document.getElementById('chip');
        const shield = document.getElementById('shield');
        if (!overlay || !chip || !shield) return;

        overlay.style.borderColor = ${JSON.stringify(accent)};
        overlay.style.boxShadow = 'inset 0 0 0 1px color-mix(in oklab, ' + ${JSON.stringify(accent)} + ' 45%, transparent), inset 0 0 24px color-mix(in oklab, ' + ${JSON.stringify(accent)} + ' 28%, transparent)';
        chip.textContent = ${JSON.stringify(label)};
        chip.style.display = 'inline-flex';
        shield.style.pointerEvents = 'auto';
        shield.style.cursor = 'not-allowed';
        shield.style.background = 'rgba(2, 6, 23, 0.03)';
      })()`).catch(() => {})
      return
    }

    // Menu mode: transparent full-page tap-catcher, no visuals
    void activeEntry.view.webContents.executeJavaScript(`(() => {
      const overlay = document.getElementById('overlay');
      const chip = document.getElementById('chip');
      const shield = document.getElementById('shield');
      if (!overlay || !chip || !shield) return;

      overlay.style.borderColor = 'transparent';
      overlay.style.boxShadow = 'none';
      chip.style.display = 'none';
      shield.style.pointerEvents = 'auto';
      shield.style.cursor = 'default';
      shield.style.background = 'rgba(0, 0, 0, 0.001)';
    })()`).catch(() => {})
  }

  private getWindowResizable(window: BrowserWindow): boolean {
    return typeof window.isResizable === 'function' ? window.isResizable() : true
  }

  private setWindowResizable(window: BrowserWindow, value: boolean): void {
    if (typeof window.setResizable === 'function') {
      window.setResizable(value)
    }
  }

  /** Attach a WebContentsView as a child of the host window contentView. */
  private addPaneView(host: BrowserWindow, view: WebContentsView): void {
    host.contentView.addChildView(view)
  }

  /**
   * Bring a pane view to the front. Electron (39+): re-adding an existing child
   * reorders it as the topmost view.
   */
  private setTopPaneView(host: BrowserWindow, view: WebContentsView): void {
    host.contentView.addChildView(view)
  }

  private removePaneView(host: BrowserWindow, view: WebContentsView): void {
    host.contentView.removeChildView(view)
  }

  // ---------------------------------------------------------------------------
  // Embedded instances — composited onto the main app window (no OS window)
  // ---------------------------------------------------------------------------

  /**
   * Create an embedded browser instance: same page/session/CDP machinery as a
   * windowed instance but with `window: null`. Views stay detached from any host
   * window (i.e. invisible) until the renderer reports a rect via
   * `syncEmbeddedBounds`.
   *
   * Process budget: only the page renderer is created here. The toolbar chrome
   * is materialised on first attach and released again once the panel goes cold
   * (`releaseEmbeddedToolbar`); the native overlay is shared per host window and
   * only appears when agent control / a toolbar menu needs it. A panel that is
   * created but never shown therefore costs one renderer process, not three.
   *
   * Optional `partition` isolates the session (e.g. `persist:ext-${extensionId}`
   * for sandboxed extension UI). Defaults to SESSION_PARTITION.
   */
  createEmbeddedInstance(input?: {
    url?: string
    workspaceId?: string | null
    partition?: string
  }): string {
    const instanceId = `browser-embedded-${++instanceCounter}`
    if (this.instances.has(instanceId)) {
      mainLog.warn(`[browser-pane] Embedded instance already exists, reusing: ${instanceId}`)
      return instanceId
    }

    const requestedPartition =
      typeof input?.partition === 'string' && input.partition.trim().length > 0
        ? input.partition.trim()
        : null
    const partition =
      requestedPartition === BROWSER_COOKIE_IMPORT_PARTITION
        ? this.cookieImportConsent
          ? BROWSER_COOKIE_IMPORT_PARTITION
          : SESSION_PARTITION
        : requestedPartition ?? SESSION_PARTITION
    const ses = session.fromPartition(partition)
    this.setupSessionPermissions(ses)
    this.setupSessionObservers(ses)
    // Extension partitions (persist:ext-*) get a strict CSP: untrusted craft-sandbox
    // UI cannot probe secrets or fetch origins outside itself by default.
    // env CRAFT_EXT_CSP_RELAX=1 opts out for local extension development.
    if (partition.startsWith('persist:ext-') && process.env.CRAFT_EXT_CSP_RELAX !== '1') {
      const csp = [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "font-src 'self' data:",
        "connect-src 'self' https://localhost:* https://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*",
        "frame-src 'self'",
      ].join('; ')
      // Register once per partition session
      const sessKey = `__craftExtCsp_${partition}`
      if (!(ses as unknown as Record<string, unknown>)[sessKey]) {
        ;(ses as unknown as Record<string, unknown>)[sessKey] = true
        ses.webRequest.onHeadersReceived((details, callback) => {
          const headers = { ...(details.responseHeaders ?? {}) }
          headers['content-security-policy'] = [csp]
          callback({ responseHeaders: headers })
        })
      }
    }

    const bgColor = nativeTheme.shouldUseDarkColors ? '#2b292e' : '#fafafb'

    const pageView = new WebContentsView({
      webPreferences: {
        partition,
        session: ses,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    })

    const pageWcWithBg = pageView.webContents as typeof pageView.webContents & { setBackgroundColor?: (color: string) => void }
    pageWcWithBg.setBackgroundColor?.(bgColor)

    const cdp = new BrowserPaneManager.CdpImpl(pageView.webContents)

    const instance: BrowserInstance = {
      id: instanceId,
      partition,
      window: null,
      // Toolbar + native overlay are materialised lazily: the toolbar on first
      // attach (see ensureToolbarView) and the overlay only when agent control
      // or a toolbar menu needs it (shared per host window). A panel that is
      // created but never shown therefore costs a single renderer process.
      toolbarView: null,
      pageView,
      nativeOverlayView: null,
      cdp,
      currentUrl: 'about:blank',
      title: i18n.t('browser.newTab'),
      favicon: null,
      isLoading: false,
      canGoBack: false,
      canGoForward: false,
      boundSessionId: null,
      ownerType: 'manual',
      ownerSessionId: null,
      workspaceId: input?.workspaceId ?? null,
      isVisible: false,
      isHiding: false,
      keepAliveOnWindowClose: false,
      toolbarReady: false,
      toolbarMenuOpen: false,
      toolbarMenuHeight: 0,
      toolbarMenuOverlayActive: false,
      showOnCreate: false,
      pendingShowOnReady: false,
      pendingShowToken: 0,
      lastAction: null,
      agentControl: null,
      lockState: {
        active: false,
        previousResizable: true,
      },
      themeColor: null,
      inPageThemeTimer: null,
      toolbarIdleTimer: null,
      themeObserverToken: null,
      consoleLogs: [],
      networkLogs: [],
      downloads: [],
      lastLaunchToken: null,
      embedded: true,
      embeddedRect: null,
      embeddedAttached: false,
      embeddedHostWindow: null,
      embeddedHostHandlers: null,
    }

    const defaultUa = pageView.webContents.userAgent || ''
    const sanitizedUa = defaultUa.replace(/\sElectron\/[^\s]+/g, '')
    if (sanitizedUa && sanitizedUa !== defaultUa) {
      pageView.webContents.setUserAgent(sanitizedUa)
    }

    this.setupWindowListeners(instance)
    this.instances.set(instanceId, instance)
    this.emitStateChange(instance)
    mainLog.info(`[browser-pane] Created embedded instance: ${instanceId}`)

    void this.loadEmptyStatePage(instance).catch((error) => {
      mainLog.warn(`[browser-pane] empty-state load failed id=${instance.id}: ${error instanceof Error ? error.message : String(error)}`)
      void pageView.webContents.loadURL('about:blank')
    })

    const initialUrl = input?.url?.trim()
    if (initialUrl) {
      void this.navigate(instanceId, initialUrl).catch((error) => {
        mainLog.warn(`[browser-pane] initial navigate failed id=${instanceId}: ${error instanceof Error ? error.message : String(error)}`)
      })
    }

    return instanceId
  }

  /**
   * Position or hide an embedded instance's composited views.
   * Rect is in CSS px relative to its renderer's client area; `null` hides.
   * RPC callers pass the sender's webContents id so views stay on their owner.
   */
  syncEmbeddedBounds(id: string, rect: EmbeddedBoundsRect | null, hostWebContentsId?: number): void {
    const instance = this.instances.get(id)
    if (!instance || !instance.embedded) {
      mainLog.warn(`[browser-pane] syncEmbeddedBounds ignored: no embedded instance id=${id}`)
      return
    }

    const normalized = rect && Number.isFinite(rect.x) && Number.isFinite(rect.y)
      && Number.isFinite(rect.width) && Number.isFinite(rect.height) && rect.width > 0 && rect.height > 0
      ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
      : null

    instance.embeddedRect = normalized

    if (!normalized) {
      this.hideEmbeddedInstance(instance)
      return
    }

    const hostWindow = this.resolveEmbedHostWindow(hostWebContentsId, instance.workspaceId)
    if (!hostWindow) {
      // A stale or foreign sender must never move a native surface onto another
      // workspace window. Keep it detached until its owning renderer reports again.
      mainLog.warn(`[browser-pane] syncEmbeddedBounds: no authorized host window for id=${id}; hiding for now`)
      this.hideEmbeddedInstance(instance)
      return
    }

    this.attachEmbeddedViews(instance, hostWindow)
    if (instance.embeddedAttached && !instance.isVisible) {
      instance.isVisible = true
      this.emitStateChange(instance)
    }
  }

  /** Resolve the renderer-owned managed window, preferring authenticated sender identity. */
  private resolveEmbedHostWindow(hostWebContentsId?: number, workspaceId?: string | null): BrowserWindow | null {
    if (!this.windowManager) return null
    if (hostWebContentsId !== undefined) {
      const host = this.windowManager.getWindowByWebContentsId(hostWebContentsId)
      const hostWorkspaceId = this.windowManager.getWorkspaceForWindow(hostWebContentsId)
      if (!host || host.isDestroyed() || (workspaceId && hostWorkspaceId !== workspaceId)) return null
      return host
    }

    if (workspaceId) {
      const workspaceWindow = this.windowManager.getWindowByWorkspace(workspaceId)
      if (workspaceWindow && !workspaceWindow.isDestroyed()) return workspaceWindow
    }

    const lastActive = this.windowManager.getLastActiveWindow()
    if (lastActive && !lastActive.isDestroyed()) return lastActive
    return null
  }

  private sendPanelFocusDirection(
    instance: BrowserInstance,
    event: { preventDefault(): void },
    input: { type?: string; key?: string; meta?: boolean; control?: boolean; alt?: boolean; shift?: boolean; isComposing?: boolean },
  ): boolean {
    if (
      input.type !== 'keyDown' ||
      input.isComposing === true ||
      input.alt !== true ||
      input.shift === true ||
      (process.platform === 'darwin' ? input.meta !== true : input.control !== true) ||
      !instance.embedded ||
      !instance.embeddedAttached ||
      !instance.embeddedRect ||
      this.instances.get(instance.id) !== instance
    ) {
      return false
    }

    const direction =
      input.key?.toLowerCase() === 'arrowleft'
        ? 'left'
        : input.key?.toLowerCase() === 'arrowright'
          ? 'right'
          : input.key?.toLowerCase() === 'arrowup'
            ? 'up'
            : input.key?.toLowerCase() === 'arrowdown'
              ? 'down'
              : null
    if (!direction) return false

    const host = instance.embeddedHostWindow
    if (!host || host.isDestroyed() || host.webContents.isDestroyed()) return false
    if (this.resolveEmbedHostWindow(host.webContents.id, instance.workspaceId) !== host) return false
    try {
      host.webContents.send('window:panel-focus-direction', direction)
      event.preventDefault()
      return true
    } catch (error) {
      mainLog.warn(
        `[browser-pane] panel focus direction send failed id=${instance.id}: ${error instanceof Error ? error.message : String(error)}`,
      )
      return false
    }
  }

  /**
   * Open the host-window omnibox when ⌘K/Ctrl+K lands on an embedded page webContents.
   * Prefer the instance's current embed host; fall back to the active main window.
   */
  private requestOmniboxOpen(instance: BrowserInstance): void {
    const host = instance.embeddedHostWindow ?? this.resolveEmbedHostWindow()
    if (!host || host.isDestroyed()) return
    try {
      host.webContents.send('omnibox:open')
    } catch (error) {
      mainLog.warn(
        `[browser-pane] omnibox:open send failed id=${instance.id}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  /** Attach the panel's views to a host window and subscribe to its resize/closed events. */
  private attachEmbeddedViews(instance: BrowserInstance, hostWindow: BrowserWindow): void {
    this.cancelEmbeddedToolbarTeardown(instance)

    if (instance.embeddedAttached && instance.embeddedHostWindow === hostWindow) {
      this.layoutEmbeddedViews(instance)
      return
    }

    // Host changed (main window recreated) — detach from the previous host first.
    if (instance.embeddedAttached || instance.embeddedHostWindow) {
      this.detachEmbeddedViews(instance)
    }

    // Record the host before touching any view: if a later add throws, the
    // pending embeddedHostWindow still lets detachEmbeddedViews remove the views
    // already parented, so a partial attach cannot leave the pane composited.
    instance.embeddedHostWindow = hostWindow
    try {
      // Materialise the panel's toolbar on first attach — a panel that is never
      // shown never pays for the extra renderer process.
      const toolbarView = this.ensureToolbarView(instance)
      this.addPaneView(hostWindow, instance.pageView)
      if (toolbarView) {
        this.addPaneView(hostWindow, toolbarView)
        this.setTopPaneView(hostWindow, toolbarView)
      }
    } catch (error) {
      mainLog.warn(`[browser-pane] failed to attach embedded views id=${instance.id}: ${error instanceof Error ? error.message : String(error)}`)
      this.detachEmbeddedViews(instance)
      return
    }

    instance.embeddedAttached = true

    const onResize = () => {
      if (hostWindow.isDestroyed()) return
      this.layoutEmbeddedViews(instance)
    }
    const onClosed = () => {
      // Host window is gone — stop tracking; view objects survive and re-attach
      // when the renderer re-sends its rect. Never touch the dead window here.
      instance.embeddedAttached = false
      instance.embeddedHostWindow = null
      instance.embeddedHostHandlers = null
    }
    hostWindow.on('resize', onResize)
    hostWindow.on('closed', onClosed)
    instance.embeddedHostHandlers = { resize: onResize, closed: onClosed }

    this.layoutEmbeddedViews(instance)
  }

  /**
   * Detach this panel's own views from the current host window (guarded for
   * teardown). The shared native overlay is deliberately left attached — it is
   * owned per host window, not per panel, and may still be driving another pane.
   */
  private detachEmbeddedViews(instance: BrowserInstance): void {
    const hostWindow = instance.embeddedHostWindow

    // Release the shared overlay claim while the host window is still known: the
    // overlay is not detached with the panel, so a panel that stops being
    // composited must drop its claim rather than leave a stale tap-catcher
    // floating over the app window.
    this.releaseNativeOverlayClaim(instance)

    if (instance.embeddedHostHandlers && hostWindow && !hostWindow.isDestroyed()) {
      hostWindow.removeListener('resize', instance.embeddedHostHandlers.resize)
      hostWindow.removeListener('closed', instance.embeddedHostHandlers.closed)
    }
    instance.embeddedHostHandlers = null
    instance.embeddedAttached = false
    instance.embeddedHostWindow = null

    if (hostWindow && !hostWindow.isDestroyed()) {
      const views = [instance.pageView, instance.toolbarView].filter((view): view is WebContentsView => !!view)
      for (const view of views) {
        try {
          this.removePaneView(hostWindow, view)
        } catch (error) {
          // Tolerate 'view already removed' and similar teardown races.
          mainLog.warn(`[browser-pane] detach embedded view failed id=${instance.id}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    }
  }

  private hideEmbeddedInstance(instance: BrowserInstance): void {
    this.closePopupsForParent(instance.id, 'parent_hide')
    instance.embeddedRect = null
    this.detachEmbeddedViews(instance)
    this.scheduleEmbeddedToolbarTeardown(instance)
    if (instance.isVisible) {
      instance.isVisible = false
      this.emitStateChange(instance)
    }
  }

  /**
   * Schedule the idle release of a cold panel's toolbar renderer. Cancelled by
   * the next attach, so rapid panel switching never pays a reload.
   */
  private scheduleEmbeddedToolbarTeardown(instance: BrowserInstance): void {
    if (!instance.embedded || !instance.toolbarView) return
    this.cancelEmbeddedToolbarTeardown(instance)
    const timer = setTimeout(() => {
      instance.toolbarIdleTimer = null
      this.releaseEmbeddedToolbar(instance)
    }, EMBEDDED_TOOLBAR_IDLE_TEARDOWN_MS)
    // Idle housekeeping must never hold the main process (or a test run) open.
    if (typeof timer === 'object' && 'unref' in timer) timer.unref()
    instance.toolbarIdleTimer = timer
  }

  private cancelEmbeddedToolbarTeardown(instance: BrowserInstance): void {
    if (!instance.toolbarIdleTimer) return
    clearTimeout(instance.toolbarIdleTimer)
    instance.toolbarIdleTimer = null
  }

  /**
   * Drop the toolbar renderer of a detached embedded panel.
   *
   * Together with lazy creation this bounds a cold panel to a single renderer
   * process (its page). The toolbar is re-materialised by `ensureToolbarView`
   * on the next attach, which re-runs the normal load/ready handshake.
   */
  private releaseEmbeddedToolbar(instance: BrowserInstance): void {
    if (!instance.embedded || instance.embeddedAttached) return
    const view = instance.toolbarView
    if (!view) return

    instance.toolbarView = null
    instance.toolbarReady = false
    try {
      const wc = view.webContents as typeof view.webContents & { close?: () => void }
      if (typeof wc.close === 'function') wc.close()
    } catch (error) {
      mainLog.warn(`[browser-pane] embedded toolbar release failed id=${instance.id}: ${error instanceof Error ? error.message : String(error)}`)
    }
    mainLog.info(`[browser-pane] released idle embedded toolbar id=${instance.id}`)
  }

  /** Lay out the embedded views within the last reported rect, clamped to the host. */
  private layoutEmbeddedViews(instance: BrowserInstance): void {
    const hostWindow = instance.embeddedHostWindow
    const rect = instance.embeddedRect
    if (!instance.embeddedAttached || !hostWindow || hostWindow.isDestroyed() || !rect) return

    const [contentWidth, contentHeight] = hostWindow.getContentSize()
    const rectX = Math.round(rect.x)
    const rectY = Math.round(rect.y)
    const rectW = Math.max(0, Math.round(rect.width))
    const rectH = Math.max(0, Math.round(rect.height))

    // Intersect with the host client area — panels near edges are clamped.
    const x = Math.min(Math.max(0, rectX), contentWidth)
    const y = Math.min(Math.max(0, rectY), contentHeight)
    const width = Math.max(0, Math.min(rectX + rectW, contentWidth) - x)
    const height = Math.max(0, Math.min(rectY + rectH, contentHeight) - y)

    if (width <= 0 || height <= 0) {
      // Rect fully outside the host window — hide instead of leaving stale views.
      mainLog.info(`[browser-pane] embedded rect outside host window id=${instance.id}; hiding`)
      this.hideEmbeddedInstance(instance)
      return
    }

    const toolbarView = instance.toolbarView
    const toolbarHeight = toolbarView ? this.getToolbarEffectiveHeight(instance) : 0
    if (toolbarView) {
      toolbarView.setBounds({ x, y, width, height: Math.min(toolbarHeight, height) })
    }
    instance.pageView.setBounds({ x, y: y + toolbarHeight, width, height: Math.max(0, height - toolbarHeight) })
    if (toolbarView) {
      this.setTopPaneView(hostWindow, toolbarView)
    }
    this.updateNativeOverlayState(instance)
  }

  private applyAgentControlLock(instance: BrowserInstance, active: boolean): void {
    // Embedded instances have no resizable OS window — nothing to lock.
    if (!instance.window) {
      instance.lockState.active = false
      return
    }

    const wantsLock = active && !!instance.agentControl?.active

    if (wantsLock && !instance.lockState.active) {
      instance.lockState.previousResizable = this.getWindowResizable(instance.window)
      this.setWindowResizable(instance.window, false)
      instance.lockState.active = true
      mainLog.info(`[browser-pane] interaction lock enabled id=${instance.id}`)
      return
    }

    if (!wantsLock && instance.lockState.active) {
      this.setWindowResizable(instance.window, instance.lockState.previousResizable)
      instance.lockState.active = false
      mainLog.info(`[browser-pane] interaction lock released id=${instance.id}`)
    }
  }

  destroyAll(): void {
    for (const id of [...this.instances.keys()]) {
      this.destroyInstance(id)
    }
  }

  private finalizeDestroyedInstance(instance: BrowserInstance, source: 'destroy' | 'closed'): void {
    if (!this.instances.has(instance.id)) {
      return
    }

    this.destroyingIds.delete(instance.id)
    this.cancelEmbeddedToolbarTeardown(instance)
    // Finalization must be best-effort: a failing cleanup step must never
    // escape destroyInstance or leave the instance stuck in the map.
    const runCleanup = (label: string, action: () => void): void => {
      try {
        action()
      } catch (error) {
        mainLog.warn(`[browser-pane] finalize cleanup failed id=${instance.id} step=${label} source=${source} error=${error instanceof Error ? error.message : String(error)}`)
      }
    }
    runCleanup('closePopupsForParent', () => this.closePopupsForParent(instance.id, 'parent_destroy'))
    runCleanup('applyAgentControlLock', () => this.applyAgentControlLock(instance, false))
    runCleanup('updateNativeOverlayState', () => this.updateNativeOverlayState(instance))
    if (instance.embedded) {
      runCleanup('detachEmbeddedViews', () => this.detachEmbeddedViews(instance))
    }
    try {
      instance.cdp.detach()
    } catch (error) {
      mainLog.warn(`[browser-pane] finalize cdp detach failed id=${instance.id}: ${error instanceof Error ? error.message : String(error)}`)
    }
    this.instances.delete(instance.id)
    this.removedCallback?.(instance.id)
    mainLog.info(`[browser-pane] Destroyed instance: ${instance.id} (${source})`)
  }

  private layoutPageView(instance: BrowserInstance): void {
    if (!instance.window || instance.window.isDestroyed()) return
    const [width, height] = instance.window.getContentSize()
    instance.pageView.setBounds({ x: 0, y: TOOLBAR_HEIGHT, width, height: Math.max(100, height - TOOLBAR_HEIGHT) })
    this.updateNativeOverlayState(instance)
  }

  private layoutAllViews(instance: BrowserInstance): void {
    if (instance.embedded) {
      this.layoutEmbeddedViews(instance)
      return
    }
    this.layoutToolbarView(instance)
    this.layoutPageView(instance)
    if (instance.window && !instance.window.isDestroyed() && instance.toolbarView) {
      this.setTopPaneView(instance.window, instance.toolbarView)
    }
  }

  private forceCloseToolbarMenu(instance: BrowserInstance, reason: string): void {
    if (!instance.toolbarMenuOpen && instance.toolbarMenuHeight === 0 && !instance.toolbarMenuOverlayActive) {
      return
    }

    instance.toolbarMenuOpen = false
    instance.toolbarMenuHeight = 0
    instance.toolbarMenuOverlayActive = false
    this.layoutAllViews(instance)

    const toolbarView = instance.toolbarView
    if (toolbarView && !instance.window?.isDestroyed() && !toolbarView.webContents.isDestroyed()) {
      toolbarView.webContents.send(TOOLBAR_CHANNELS.FORCE_CLOSE_MENU, { reason })
    }
  }

  private isBrowserEmptyStateUrl(url: string): boolean {
    if (!url) return false
    return url.includes(`/${BROWSER_EMPTY_STATE_PAGE}`) || url.includes(`\\${BROWSER_EMPTY_STATE_PAGE}`)
  }

  /**
   * SEC-01 trust boundary: a `craftagents://` navigation from the pane is
   * honoured only when the pane's current document is the app's own
   * empty-state page. Remote sites loaded in the pane (and their popups) must
   * not be able to drive the app — a crafted
   * `craftagents://action/new-session?…&send=true&mode=allow-all` URL can
   * otherwise create an allow-all session and auto-send an attacker prompt
   * with no user gesture.
   */
  private isDeeplinkAllowedFromPage(instance: BrowserInstance): boolean {
    const currentUrl = instance.pageView.webContents.getURL?.() ?? instance.currentUrl
    return this.isBrowserEmptyStateUrl(currentUrl)
  }

  private normalizePageState(url: string, title: string): { url: string; title: string } {
    if (this.isBrowserEmptyStateUrl(url)) {
      return { url: 'about:blank', title: i18n.t('browser.newTab') }
    }
    return { url, title }
  }

  private async loadEmptyStatePage(instance: BrowserInstance): Promise<void> {
    if (VITE_DEV_SERVER_URL) {
      await instance.pageView.webContents.loadURL(`${VITE_DEV_SERVER_URL}/${BROWSER_EMPTY_STATE_PAGE}`)
      return
    }

    await instance.pageView.webContents.loadFile(join(__dirname, `renderer/${BROWSER_EMPTY_STATE_PAGE}`))
  }

  private async handleDeepLinkUrl(url: string): Promise<void> {
    if (!url.startsWith(CRAFT_DEEPLINK_SCHEME_PREFIX)) return

    try {
      if (!this.windowManager) {
        mainLog.warn('[browser-pane] window manager unavailable for deep-link handling, falling back to shell.openExternal')
        await shell.openExternal(url)
        return
      }

      const { handleDeepLink } = await import('./deep-link')
      const sink = this.windowManager.getRpcEventSink() ?? undefined
      const resolver = (wcId: number) => this.windowManager?.getClientIdForWindow(wcId)
      const result = await handleDeepLink(url, this.windowManager, sink, resolver, undefined, 'browser-pane')
      if (!result.success) {
        mainLog.warn(`[browser-pane] deep-link handling failed: ${result.error ?? 'unknown error'} url=${url}`)
      }
    } catch (error) {
      mainLog.warn(`[browser-pane] deep-link handling threw, falling back to shell.openExternal: ${error instanceof Error ? error.message : String(error)}`)
      await shell.openExternal(url)
    }
  }

  private async maybeHandleEmptyStateLaunch(instance: BrowserInstance, url: string): Promise<boolean> {
    if (!this.isBrowserEmptyStateUrl(url) || !url.includes('#launch=')) {
      return false
    }

    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return false
    }

    const hash = parsed.hash.startsWith('#') ? parsed.hash.slice(1) : parsed.hash
    const launchPayload = hash.startsWith('launch=') ? hash.slice('launch='.length) : hash
    if (!launchPayload) return false

    const params = new URLSearchParams(launchPayload)
    const route = params.get('route')
    const token = params.get('ts') ?? route ?? null

    if (!route) {
      mainLog.warn(`[browser-pane] empty-state launch missing route id=${instance.id}`)
      return false
    }

    const handled = await this.triggerEmptyStateRouteLaunch(instance, route, token, 'hash')

    try {
      await instance.pageView.webContents.executeJavaScript(
        "if (window.location.hash.includes('launch=')) history.replaceState(null, '', window.location.pathname + window.location.search);",
      )
    } catch {
      // Best effort cleanup only
    }

    return handled
  }

  private async loadToolbarPage(instance: BrowserInstance, view: WebContentsView): Promise<void> {
    const query = `instanceId=${encodeURIComponent(instance.id)}`
    let lastError: unknown = null

    for (let attempt = 0; attempt <= TOOLBAR_LOAD_MAX_RETRIES; attempt++) {
      if (view.webContents.isDestroyed()) return
      try {
        if (VITE_DEV_SERVER_URL) {
          await view.webContents.loadURL(`${VITE_DEV_SERVER_URL}/browser-toolbar.html?${query}`)
        } else {
          await view.webContents.loadFile(
            join(__dirname, 'renderer/browser-toolbar.html'),
            { query: { instanceId: instance.id } },
          )
        }

        if (attempt > 0) {
          mainLog.info(`[browser-pane] toolbar load recovered id=${instance.id} attempt=${attempt + 1}`)
        }
        return
      } catch (error) {
        lastError = error
        const retrying = attempt < TOOLBAR_LOAD_MAX_RETRIES
        mainLog.warn(
          `[browser-pane] toolbar load failed id=${instance.id} attempt=${attempt + 1}/${TOOLBAR_LOAD_MAX_RETRIES + 1}: ${error instanceof Error ? error.message : String(error)}${retrying ? ' (retrying)' : ''}`,
        )

        if (retrying) {
          await this.sleep(TOOLBAR_LOAD_RETRY_DELAY_MS)
        }
      }
    }

    const errorText = lastError instanceof Error ? lastError.message : String(lastError ?? 'unknown error')
    await this.loadToolbarFallback(instance, view, errorText)
  }

  private async loadToolbarFallback(instance: BrowserInstance, view: WebContentsView, reason: string): Promise<void> {
    const safeReason = reason.replace(/[<>&]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[ch] || ch))
    const html = `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Browser Toolbar Error</title>
    <style>
      html, body { margin: 0; padding: 0; height: 100%; font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #fafafb; color: #1f2937; }
      @media (prefers-color-scheme: dark) { html, body { background: #2b292e; color: #e5e7eb; } }
      .wrap { height: 100%; display: flex; align-items: center; justify-content: center; }
      .card { max-width: 640px; margin: 0 20px; padding: 14px 16px; border-radius: 10px; background: rgba(127,127,127,0.12); font-size: 12px; line-height: 1.45; }
      .title { font-weight: 600; margin-bottom: 6px; }
      .muted { opacity: 0.8; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="card">
        <div class="title">Browser toolbar failed to load</div>
        <div class="muted">The page area still works, but toolbar UI is unavailable. Try reopening the browser window.</div>
        <div class="muted" style="margin-top: 8px; word-break: break-word;">Reason: ${safeReason}</div>
      </div>
    </div>
  </body>
</html>`

    try {
      if (view.webContents.isDestroyed()) return
      await view.webContents.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(html)}`)
      mainLog.warn(`[browser-pane] Loaded toolbar fallback id=${instance.id}`)
    } catch (error) {
      mainLog.error(`[browser-pane] Failed to load toolbar fallback id=${instance.id}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  private pushToolbarState(instance: BrowserInstance): void {
    const toolbarView = instance.toolbarView
    if (!toolbarView || instance.window?.isDestroyed() || toolbarView.webContents.isDestroyed()) return
    const state = {
      url: instance.currentUrl,
      title: instance.title,
      isLoading: instance.isLoading,
      canGoBack: instance.canGoBack,
      canGoForward: instance.canGoForward,
      themeColor: instance.themeColor,
      downloadCount: instance.downloads.length,
      profileLabel: 'Rox',
    }
    toolbarView.webContents.send(TOOLBAR_CHANNELS.STATE_UPDATE, state)
  }

  /** Register IPC handlers for toolbar actions. Call once at app startup. */
  registerToolbarIpc(): void {
    // Toolbar IPC is only ever sent by a pane's own toolbar webContents; any
    // other sender (or an unknown instance id) is denied rather than silently
    // ignored, so another renderer cannot drive a pane it does not own.
    const requireToolbarInstance = (event: { sender: unknown }, instanceId: string): BrowserInstance => {
      const inst = this.instances.get(instanceId)
      if (!inst?.toolbarView || inst.toolbarView.webContents !== event.sender) throw new Error('IPC_SENDER_DENIED')
      return inst
    }

    ipcMain.handle(TOOLBAR_CHANNELS.NAVIGATE, async (event, instanceId: string, url: string) => {
      await this.navigate(requireToolbarInstance(event, instanceId).id, url)
    })

    ipcMain.handle(TOOLBAR_CHANNELS.GO_BACK, async (event, instanceId: string) => {
      await this.goBack(requireToolbarInstance(event, instanceId).id)
    })

    ipcMain.handle(TOOLBAR_CHANNELS.GO_FORWARD, async (event, instanceId: string) => {
      await this.goForward(requireToolbarInstance(event, instanceId).id)
    })

    ipcMain.handle(TOOLBAR_CHANNELS.RELOAD, async (event, instanceId: string) => {
      this.reload(requireToolbarInstance(event, instanceId).id)
    })

    ipcMain.handle(TOOLBAR_CHANNELS.STOP, async (event, instanceId: string) => {
      this.stop(requireToolbarInstance(event, instanceId).id)
    })

    ipcMain.handle(TOOLBAR_CHANNELS.MENU_GEOMETRY, async (event, instanceId: string, open: boolean, height?: number) => {
      const inst = requireToolbarInstance(event, instanceId)

      const normalizedOpen = !!open
      const normalizedHeight = Math.max(0, Math.ceil(Number(height ?? 0)))

      if (!normalizedOpen) {
        this.forceCloseToolbarMenu(inst, 'renderer-close')
        return
      }

      const changed = !inst.toolbarMenuOpen
        || inst.toolbarMenuHeight !== normalizedHeight
        || !inst.toolbarMenuOverlayActive

      if (!changed) return

      inst.toolbarMenuOpen = true
      inst.toolbarMenuHeight = normalizedHeight
      inst.toolbarMenuOverlayActive = true
      this.layoutAllViews(inst)
    })

    ipcMain.handle(TOOLBAR_CHANNELS.HIDE, async (event, instanceId: string) => {
      const inst = requireToolbarInstance(event, instanceId)
      mainLog.info(`[browser-pane] toolbar ipc hide requested instanceId=${instanceId} resolved=${inst.id}`)
      this.hide(inst.id)
    })

    ipcMain.handle(TOOLBAR_CHANNELS.DESTROY, async (event, instanceId: string) => {
      const inst = requireToolbarInstance(event, instanceId)
      mainLog.info(`[browser-pane] toolbar ipc destroy requested instanceId=${instanceId} resolved=${inst.id}`)
      this.destroyInstance(inst.id)
    })

    ipcMain.handle(TOOLBAR_CHANNELS.OPEN_DEVTOOLS, async (event, instanceId: string) => {
      this.openDevTools(requireToolbarInstance(event, instanceId).id)
    })

    ipcMain.handle(TOOLBAR_CHANNELS.LIST_HISTORY, async (event, instanceId: string) => {
      return this.getNavigationHistory(requireToolbarInstance(event, instanceId).id)
    })

    ipcMain.handle(TOOLBAR_CHANNELS.LIST_DOWNLOADS, async (event, instanceId: string) => {
      const rows = await this.getDownloads(requireToolbarInstance(event, instanceId).id, { action: 'list', limit: 8 })
      return rows.map((row) => ({ filename: row.filename }))
    })

    mainLog.info('[browser-pane] Toolbar IPC handlers registered')
  }

  // ---------------------------------------------------------------------------
  // Capability IPC — dispatcher for the `client:browser:invoke` WS capability.
  //
  // Sits between the preload bridge (which receives the WS request from the
  // remote server) and the real BrowserPaneManager. It rewrites session IDs to
  // an owner-key namespace, refuses any instance ID not owned by the calling
  // (workspaceId, sessionId), and blocks unsafe methods like `uploadFile` or
  // (optionally) `evaluate`.
  // ---------------------------------------------------------------------------

  /** Register the `__browser:invoke` IPC handler. Call once at app startup. */
  registerCapabilityIpc(): void {
    ipcMain.handle('__browser:invoke', async (event, req: BrowserCapabilityRequest) => {
      // Only a managed window may bridge a remote capability. The workspace check must
      // NOT compare the request against the window's LOCAL binding: remote-mirror
      // workspaces deliberately carry the REMOTE server's workspace id here (the two
      // never match — see release notes 0.10.0), and `dispatchCapability` already
      // namespaces every owner key by that id.
      const owner = this.windowManager?.getWindowByWebContentsId(event.sender.id)
      if (!owner || !req) {
        throw new Error('IPC_SENDER_DENIED')
      }
      return await this.dispatchCapability(req)
    })
    mainLog.info('[browser-pane] Capability IPC handler registered')
  }

  /** Owner-key namespacing: remote sessions can't collide with local sessions. */
  private toOwnerKey(workspaceId: string, sessionId: string): string {
    return `remote:${workspaceId}:${sessionId}`
  }

  private isRemoteOwnerKey(value: string | null | undefined): value is string {
    return typeof value === 'string' && value.startsWith('remote:')
  }

  private parseOwnerKey(value: string): { workspaceId: string; sessionId: string } | null {
    if (!this.isRemoteOwnerKey(value)) return null
    const rest = value.slice('remote:'.length)
    const colon = rest.indexOf(':')
    if (colon === -1) return null
    return { workspaceId: rest.slice(0, colon), sessionId: rest.slice(colon + 1) }
  }

  /** Replace `remote:${ws}:${sid}` owner-keys with raw `sid` on outbound payloads. */
  private stripOwnerKeysInPlace<T extends Partial<BrowserInstanceInfo>>(info: T): T {
    if (this.isRemoteOwnerKey(info.boundSessionId)) {
      info.boundSessionId = this.parseOwnerKey(info.boundSessionId)!.sessionId
    }
    if (this.isRemoteOwnerKey(info.ownerSessionId)) {
      info.ownerSessionId = this.parseOwnerKey(info.ownerSessionId)!.sessionId
    }
    return info
  }

  /**
   * Throws `BROWSER_INSTANCE_NOT_OWNED` unless the instance belongs to `ownerKey`.
   * Called by every dispatcher branch that accepts an instanceId — including read-only ones.
   */
  private requireOwnedInstance(instanceId: string, ownerKey: string): void {
    const instance = this.instances.get(instanceId)
    if (!instance || this.isInstanceGone(instance)) {
      throw new CodedError('BROWSER_INSTANCE_NOT_OWNED', `Browser instance "${instanceId}" not found.`)
    }
    const owned = instance.boundSessionId === ownerKey || instance.ownerSessionId === ownerKey
    if (!owned) {
      throw new CodedError('BROWSER_INSTANCE_NOT_OWNED',
        `Browser instance "${instanceId}" is not owned by this session.`)
    }
  }

  /** Session-scoped listInstances — never returns workspace-wide windows to a remote agent. */
  private listInstancesForOwner(ownerKey: string): BrowserInstanceInfo[] {
    const infos: BrowserInstanceInfo[] = []
    for (const instance of this.instances.values()) {
      if (this.isInstanceGone(instance)) {
        this.cleanupDestroyedInstance(instance, 'listInstancesForOwner')
        continue
      }
      const owned = instance.boundSessionId === ownerKey || instance.ownerSessionId === ownerKey
      if (!owned) continue
      infos.push(this.stripOwnerKeysInPlace(this.toInfo(instance)))
    }
    return infos
  }

  /**
   * Extract a plain {@link BrowserInstanceSnapshot} from a live `BrowserInstance`.
   *
   * `this.getInstance(id)` returns the full instance, which has non-cloneable
   * Electron native references (`window: BrowserWindow`, `pageView: WebContentsView`,
   * `toolbarView`, ...). When we ship the result back over the `__browser:invoke`
   * IPC channel, Electron's structured-clone serializer throws
   * "An object could not be cloned" — see the user-reported bug on the remote
   * bridge path. Always pass the live instance through this helper before
   * returning over IPC.
   */
  private toSnapshot(instance: BrowserInstance): BrowserInstanceSnapshot {
    return {
      ownerType: instance.ownerType,
      ownerSessionId: instance.ownerSessionId,
      isVisible: instance.isVisible,
      title: instance.title,
      currentUrl: instance.currentUrl,
    }
  }

  private toScreenshotWire(result: BrowserScreenshotResult): ScreenshotResultWire {
    const buf = result.imageBuffer
    return {
      imageFormat: result.imageFormat,
      imageBytes: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength),
      metadata: result.metadata,
    }
  }

  /** Main dispatcher. Strongly-typed `switch` over `IBrowserPaneManager` methods. */
  private async dispatchCapability(req: BrowserCapabilityRequest): Promise<unknown> {
    if (!req || req.v !== 1) {
      throw new CodedError('HANDLER_ERROR',
        `Unsupported browser capability request shape (v=${(req as { v?: unknown })?.v}).`)
    }
    const ownerKey = this.toOwnerKey(req.workspaceId, req.sessionId)
    const args = req.args ?? []

    switch (req.method) {
      // -- Session-scoped (no instanceId arg, takes a sessionId) ----------------
      case 'createForSession': {
        const [, options] = args as [string, { show?: boolean } | undefined]
        return this.createForSession(ownerKey, {
          show: options?.show ?? false,
          allowReuseManual: false,
          workspaceId: req.workspaceId,
        })
      }
      // Remote agents must NEVER reuse an existing manual / unbound window —
      // even one that was previously bound to a local session. The
      // workspaceId-aware reuse filter is best-effort (it can still match
      // legacy windows stamped with workspaceId=null), so we belt-and-brace
      // by disabling manual reuse on every remote lifecycle path. Each remote
      // session-id namespace gets a fresh window unless it already owns one.
      case 'getOrCreateForSession':
        return this.createForSession(ownerKey, {
          show: false,
          allowReuseManual: false,
          workspaceId: req.workspaceId,
        })
      case 'focusBoundForSession': {
        const id = this.createForSession(ownerKey, {
          show: true,
          allowReuseManual: false,
          workspaceId: req.workspaceId,
        })
        this.focus(id)
        return id
      }
      case 'destroyForSession':
        this.destroyForSession(ownerKey)
        return undefined
      case 'clearVisualsForSession':
        await this.clearVisualsForSession(ownerKey)
        return undefined
      case 'unbindAllForSession':
        this.unbindAllForSession(ownerKey)
        return undefined
      case 'setAgentControl': {
        const [, meta] = args as [string, { displayName?: string; intent?: string }]
        this.setAgentControl(ownerKey, meta, { workspaceId: req.workspaceId })
        return undefined
      }
      case 'clearAgentControl':
        this.clearAgentControl(ownerKey)
        return undefined

      // -- Mixed (instanceId + optional sessionId) ----------------------------
      case 'clearAgentControlForInstance': {
        const [instanceId, sessionId] = args as [string, string | undefined]
        this.requireOwnedInstance(instanceId, ownerKey)
        return this.clearAgentControlForInstance(
          instanceId,
          sessionId !== undefined ? ownerKey : undefined,
        )
      }

      // -- Instance-id only ----------------------------------------------------
      case 'getInstance': {
        const [instanceId] = args as [string]
        this.requireOwnedInstance(instanceId, ownerKey)
        const live = this.getInstance(instanceId)
        if (!live) return undefined
        // `getInstance` returns the live BrowserInstance (which embeds non-
        // cloneable Electron native objects). Project to a plain snapshot
        // before crossing the IPC boundary.
        return this.stripOwnerKeysInPlace(this.toSnapshot(live))
      }
      case 'listInstances':
        return this.listInstancesForOwner(ownerKey)
      case 'bindSession': {
        const [instanceId] = args as [string, string]
        this.requireOwnedInstance(instanceId, ownerKey)
        this.bindSession(instanceId, ownerKey, { workspaceId: req.workspaceId })
        return undefined
      }
      case 'focus': {
        const [instanceId] = args as [string]
        this.requireOwnedInstance(instanceId, ownerKey)
        this.focus(instanceId)
        return undefined
      }
      case 'hide': {
        const [instanceId] = args as [string]
        this.requireOwnedInstance(instanceId, ownerKey)
        this.hide(instanceId)
        return undefined
      }
      case 'destroyInstance': {
        const [instanceId] = args as [string]
        this.requireOwnedInstance(instanceId, ownerKey)
        this.destroyInstance(instanceId)
        return undefined
      }

      // -- Navigation ----------------------------------------------------------
      case 'navigate': {
        const [instanceId, url] = args as [string, string]
        this.requireOwnedInstance(instanceId, ownerKey)
        return this.navigate(instanceId, url)
      }
      case 'goBack': {
        const [instanceId] = args as [string]
        this.requireOwnedInstance(instanceId, ownerKey)
        return this.goBack(instanceId)
      }
      case 'goForward': {
        const [instanceId] = args as [string]
        this.requireOwnedInstance(instanceId, ownerKey)
        return this.goForward(instanceId)
      }

      // -- Interaction ---------------------------------------------------------
      case 'getAccessibilitySnapshot': {
        const [instanceId] = args as [string]
        this.requireOwnedInstance(instanceId, ownerKey)
        return this.getAccessibilitySnapshot(instanceId)
      }
      case 'clickElement': {
        const [instanceId, ref, options] = args as [
          string, string,
          { waitFor?: 'none' | 'navigation' | 'network-idle'; timeoutMs?: number } | undefined,
        ]
        this.requireOwnedInstance(instanceId, ownerKey)
        return this.clickElement(instanceId, ref, options)
      }
      case 'clickAtCoordinates': {
        const [instanceId, x, y] = args as [string, number, number]
        this.requireOwnedInstance(instanceId, ownerKey)
        return this.clickAtCoordinates(instanceId, x, y)
      }
      case 'drag': {
        const [instanceId, x1, y1, x2, y2] = args as [string, number, number, number, number]
        this.requireOwnedInstance(instanceId, ownerKey)
        return this.drag(instanceId, x1, y1, x2, y2)
      }
      case 'fillElement': {
        const [instanceId, ref, value] = args as [string, string, string]
        this.requireOwnedInstance(instanceId, ownerKey)
        return this.fillElement(instanceId, ref, value)
      }
      case 'typeText': {
        const [instanceId, text] = args as [string, string]
        this.requireOwnedInstance(instanceId, ownerKey)
        return this.typeText(instanceId, text)
      }
      case 'selectOption': {
        const [instanceId, ref, value] = args as [string, string, string]
        this.requireOwnedInstance(instanceId, ownerKey)
        return this.selectOption(instanceId, ref, value)
      }
      case 'sendKey': {
        const [instanceId, keyArgs] = args as [string, BrowserKeyArgs]
        this.requireOwnedInstance(instanceId, ownerKey)
        return this.sendKey(instanceId, keyArgs)
      }
      case 'scroll': {
        const [instanceId, direction, amount] = args as [
          string, 'up' | 'down' | 'left' | 'right', number | undefined,
        ]
        this.requireOwnedInstance(instanceId, ownerKey)
        return this.scroll(instanceId, direction, amount)
      }
      case 'waitFor': {
        const [instanceId, waitArgs] = args as [string, BrowserWaitArgs]
        this.requireOwnedInstance(instanceId, ownerKey)
        return this.waitFor(instanceId, waitArgs)
      }
      case 'evaluate': {
        const [instanceId, expression] = args as [string, string]
        this.requireOwnedInstance(instanceId, ownerKey)
        if (!getAllowRemoteEvaluate()) {
          throw new CodedError('BROWSER_REMOTE_EVALUATE_BLOCKED',
            'JavaScript evaluation from remote agents is disabled in this client.')
        }
        return this.evaluate(instanceId, expression)
      }

      // -- Clipboard -----------------------------------------------------------
      case 'setClipboard': {
        const [instanceId, text] = args as [string, string]
        this.requireOwnedInstance(instanceId, ownerKey)
        return this.setClipboard(instanceId, text)
      }
      case 'getClipboard': {
        const [instanceId] = args as [string]
        this.requireOwnedInstance(instanceId, ownerKey)
        return this.getClipboard(instanceId)
      }

      // -- Capture / introspection --------------------------------------------
      case 'screenshot': {
        const [instanceId, options] = args as [string, BrowserScreenshotOptions | undefined]
        this.requireOwnedInstance(instanceId, ownerKey)
        const result = await this.screenshot(instanceId, options)
        return this.toScreenshotWire(result)
      }
      case 'screenshotRegion': {
        const [instanceId, target] = args as [string, BrowserScreenshotRegionTarget]
        this.requireOwnedInstance(instanceId, ownerKey)
        const result = await this.screenshotRegion(instanceId, target)
        return this.toScreenshotWire(result)
      }
      case 'getConsoleLogs': {
        const [instanceId, options] = args as [string, BrowserConsoleOptions | undefined]
        this.requireOwnedInstance(instanceId, ownerKey)
        return this.getConsoleLogs(instanceId, options)
      }
      case 'getNetworkLogs': {
        const [instanceId, options] = args as [string, BrowserNetworkOptions | undefined]
        this.requireOwnedInstance(instanceId, ownerKey)
        return this.getNetworkLogs(instanceId, options)
      }
      case 'windowResize': {
        const [instanceId, width, height] = args as [string, number, number]
        this.requireOwnedInstance(instanceId, ownerKey)
        return this.windowResize(instanceId, width, height)
      }
      case 'getDownloads': {
        const [instanceId, options] = args as [string, BrowserDownloadOptions | undefined]
        this.requireOwnedInstance(instanceId, ownerKey)
        return this.getDownloads(instanceId, options)
      }
      case 'uploadFile':
        throw new CodedError('BROWSER_REMOTE_UPLOAD_NOT_SUPPORTED',
          'File upload from a remote agent is not supported yet. Ask the user to attach the file to the session.')
      case 'detectSecurityChallenge': {
        const [instanceId] = args as [string]
        this.requireOwnedInstance(instanceId, ownerKey)
        return this.detectSecurityChallenge(instanceId)
      }

      default: {
        const method = (req as { method?: unknown }).method
        throw new CodedError('HANDLER_ERROR', `Unknown browser capability method: ${String(method)}`)
      }
    }
  }

  private markToolbarReady(instance: BrowserInstance, reason: string): void {
    if (instance.toolbarReady) return
    if (this.isInstanceGone(instance)) return

    instance.toolbarReady = true
    mainLog.info(`[browser-pane] toolbar ready id=${instance.id} reason=${reason}`)

    const shouldShowNow = instance.showOnCreate || instance.pendingShowOnReady
    if (!shouldShowNow) return
    // Embedded instances show/hide purely via syncEmbeddedBounds.
    if (instance.embedded || !instance.window) return

    const tokenAtReady = instance.pendingShowToken
    instance.pendingShowOnReady = false

    if (instance.window.isDestroyed()) return
    if (instance.pendingShowToken !== tokenAtReady) return

    instance.window.show()
    instance.window.focus()
    instance.isVisible = true
    this.emitStateChange(instance)

  }

  // ---------------------------------------------------------------------------
  // Agent Control — persistent overlay while agent is using the browser
  // ---------------------------------------------------------------------------

  /**
   * Activate or update the agent control overlay on the browser instance
   * bound to the given session. Called from sessions.ts on browser_* tool_start events.
   */
  setAgentControl(
    sessionId: string,
    meta: { displayName?: string; intent?: string },
    options?: { workspaceId?: string | null },
  ): void {
    for (const instance of this.instances.values()) {
      if (instance.boundSessionId === sessionId) {
        instance.agentControl = {
          active: true,
          sessionId,
          displayName: meta.displayName,
          intent: meta.intent,
        }

        // Backfill workspaceId for instances that were created before the
        // workspace was known (legacy callers / pre-workspaceId code paths).
        if (options?.workspaceId !== undefined && instance.workspaceId === null) {
          instance.workspaceId = options.workspaceId
        }

        const label = this.getAgentControlLabel(instance.agentControl)

        this.reapplyAgentControlVisual(instance)
        this.emitStateChange(instance)

        mainLog.info(`[browser-pane] agent control activated session=${sessionId} label=${label}`)
        return
      }
    }
  }

  /**
   * Clear the agent control overlay for the given session.
   * Called on explicit browser_tool release and session/window teardown.
   */
  clearAgentControl(sessionId: string): void {
    for (const instance of this.instances.values()) {
      if (instance.boundSessionId === sessionId && instance.agentControl?.active) {
        instance.agentControl = null
        this.applyAgentControlLock(instance, false)
        this.updateNativeOverlayState(instance)
        this.emitStateChange(instance)
        mainLog.info(`[browser-pane] agent control released session=${sessionId}`)
      }
    }
  }

  clearAgentControlForInstance(instanceId: string, sessionId?: string): { released: boolean; reason?: string } {
    const instance = this.instances.get(instanceId)
    if (!instance) {
      return { released: false, reason: `Browser window "${instanceId}" not found.` }
    }

    if (sessionId) {
      if (instance.boundSessionId && instance.boundSessionId !== sessionId) {
        return { released: false, reason: `Browser window "${instanceId}" is locked to session ${instance.boundSessionId}.` }
      }

      if (!instance.boundSessionId && instance.ownerSessionId && instance.ownerSessionId !== sessionId) {
        return { released: false, reason: `Browser window "${instanceId}" is currently owned by session ${instance.ownerSessionId}.` }
      }
    }

    if (!instance.agentControl?.active) {
      return { released: false, reason: 'No active agent overlay on the target window.' }
    }

    instance.agentControl = null
    this.applyAgentControlLock(instance, false)
    this.updateNativeOverlayState(instance)
    this.emitStateChange(instance)
    mainLog.info(`[browser-pane] agent control released instance=${instanceId}${sessionId ? ` session=${sessionId}` : ''}`)

    return { released: true }
  }

  /**
   * Extract a theme color from the page using Safari 26-style heuristics.
   * Priority: media-aware theme-color meta → elementsFromPoint (fixed/sticky headers) → body/html bg.
   * All colors pass through (including white/black) — contrast is handled by the renderer.
   * Guards against stale extraction (URL change during async executeJavaScript).
   */
  private async extractThemeColor(instance: BrowserInstance): Promise<void> {
    if (instance.themeColor) return // already set by did-change-theme-color or observer
    const urlAtStart = instance.currentUrl
    try {
      const color = await instance.pageView.webContents.executeJavaScript(`(${THEME_COLOR_EXTRACTOR_FN})()`)
      // Guard: if user navigated away during extraction, discard stale result
      if (instance.currentUrl !== urlAtStart) return
      if (typeof color === 'string' && color.length > 0) {
        this.applyThemeColor(instance, color)
      }
    } catch {
      // page destroyed or JS error — ignore
    }
  }

  private applyThemeColor(instance: BrowserInstance, color: string | null): void {
    if (instance.themeColor === color) return
    instance.themeColor = color
    const toolbarView = instance.toolbarView
    if (toolbarView && !toolbarView.webContents.isDestroyed()) {
      toolbarView.webContents.send(TOOLBAR_CHANNELS.THEME_COLOR, color)
    }
    this.emitStateChange(instance)
  }

  private installThemeObserver(instance: BrowserInstance, allowRetry = true): void {
    const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const urlAtInstall = instance.currentUrl
    instance.themeObserverToken = token

    void instance.pageView.webContents.executeJavaScript(`
      (() => {
        const token = ${JSON.stringify(token)};
        const prefix = ${JSON.stringify(THEME_COLOR_SIGNAL_PREFIX)} + token + ':';
        const nullSentinel = ${JSON.stringify(THEME_COLOR_NULL_SENTINEL)};
        const extractThemeColor = ${THEME_COLOR_EXTRACTOR_FN};

        const w = window;
        const previousCleanup = w.__CRAFT_THEME_OBSERVER_CLEANUP__;
        if (typeof previousCleanup === 'function') {
          try { previousCleanup(); } catch {}
        }

        let lastColor = '__unset__';
        let rafId = 0;
        let timerId = 0;
        let lastRunAt = 0;
        const minIntervalMs = ${THEME_OBSERVER_MIN_INTERVAL_MS};

        const clearScheduled = () => {
          if (timerId) {
            clearTimeout(timerId);
            timerId = 0;
          }
          if (rafId) {
            cancelAnimationFrame(rafId);
            rafId = 0;
          }
        };

        const emit = (color) => {
          const normalized = typeof color === 'string' && color.length > 0 ? color : null;
          if (normalized === lastColor) return;
          lastColor = normalized;
          console.info(prefix + (normalized ?? nullSentinel));
        };

        const run = () => {
          rafId = 0;
          lastRunAt = Date.now();
          try {
            emit(extractThemeColor());
          } catch {}
        };

        const schedule = () => {
          if (rafId || timerId) return;
          const waitMs = Math.max(0, minIntervalMs - (Date.now() - lastRunAt));
          if (waitMs > 0) {
            timerId = setTimeout(() => {
              timerId = 0;
              rafId = requestAnimationFrame(run);
            }, waitMs);
            return;
          }
          rafId = requestAnimationFrame(run);
        };

        const onScroll = () => schedule();
        const onResize = () => schedule();
        const onMutation = () => schedule();

        const headObserver = new MutationObserver(onMutation);
        if (document.head) {
          headObserver.observe(document.head, {
            subtree: true,
            childList: true,
            attributes: true,
            attributeFilter: ['name', 'content', 'media'],
          });
        }

        const rootObserver = new MutationObserver(onMutation);
        if (document.documentElement) {
          rootObserver.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['class', 'style'],
          });
        }
        if (document.body) {
          rootObserver.observe(document.body, {
            attributes: true,
            attributeFilter: ['class', 'style'],
          });
        }

        w.addEventListener('scroll', onScroll, { passive: true });
        w.addEventListener('resize', onResize, { passive: true });

        const mql = w.matchMedia('(prefers-color-scheme: dark)');
        const onSchemeChange = () => schedule();
        if (typeof mql.addEventListener === 'function') mql.addEventListener('change', onSchemeChange);
        else if (typeof mql.addListener === 'function') mql.addListener(onSchemeChange);

        w.__CRAFT_THEME_OBSERVER_CLEANUP__ = () => {
          headObserver.disconnect();
          rootObserver.disconnect();
          w.removeEventListener('scroll', onScroll);
          w.removeEventListener('resize', onResize);
          if (typeof mql.removeEventListener === 'function') mql.removeEventListener('change', onSchemeChange);
          else if (typeof mql.removeListener === 'function') mql.removeListener(onSchemeChange);
          clearScheduled();
        };

        // Fast first color for initial toolbar paint and after SPA route changes
        schedule();
      })()
    `).catch(() => {
      if (!allowRetry) return
      setTimeout(() => {
        if (!this.instances.has(instance.id)) return
        if (instance.currentUrl !== urlAtInstall) return
        if (instance.themeObserverToken !== token) return
        this.installThemeObserver(instance, false)
      }, 120)
    })
  }

  private scheduleEarlyThemeExtraction(instance: BrowserInstance, urlAtSchedule: string): void {
    setTimeout(() => {
      if (!this.instances.has(instance.id)) return
      if (instance.currentUrl !== urlAtSchedule) return
      void this.extractThemeColor(instance)
    }, EARLY_THEME_EXTRACTION_DELAY_MS)
  }

  private getInstanceByWebContentsId(webContentsId: number): BrowserInstance | undefined {
    for (const instance of this.instances.values()) {
      if (instance.pageView.webContents.id === webContentsId) return instance
    }
    return undefined
  }

  private registerPopupWindow(parentInstance: BrowserInstance, popupWindow: BrowserWindow, sourceUrl?: string): void {
    const popupWcId = popupWindow.webContents.id
    const existingParent = this.popupParentByWebContentsId.get(popupWcId)
    if (existingParent && existingParent !== parentInstance.id) {
      this.unregisterPopupWindow(popupWindow, 'reparented')
    }

    let popups = this.popupWindowsByParentInstanceId.get(parentInstance.id)
    if (!popups) {
      popups = new Set<BrowserWindow>()
      this.popupWindowsByParentInstanceId.set(parentInstance.id, popups)
    }

    popups.add(popupWindow)
    this.popupParentByWebContentsId.set(popupWcId, parentInstance.id)

    const initialUrl = sourceUrl || popupWindow.webContents.getURL?.() || 'about:blank'
    mainLog.info(`[browser-pane] popup created parent=${parentInstance.id} popupWebContentsId=${popupWcId} url=${initialUrl}`)

    popupWindow.webContents.on('did-navigate', (_event, urlFromEvent) => {
      const popupUrl = typeof popupWindow.webContents.getURL === 'function'
        ? popupWindow.webContents.getURL()
        : (urlFromEvent || initialUrl)
      mainLog.info(`[browser-pane] popup did-navigate parent=${parentInstance.id} popupWebContentsId=${popupWcId} url=${popupUrl}`)
    })

    popupWindow.webContents.on('did-redirect-navigation', (_event, popupUrl, isInPlace, isMainFrame) => {
      mainLog.info(
        `[browser-pane] popup redirect parent=${parentInstance.id} popupWebContentsId=${popupWcId} url=${popupUrl} inPlace=${isInPlace} mainFrame=${isMainFrame}`,
      )
    })

    popupWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame) return
      mainLog.warn(
        `[browser-pane] popup did-fail-load parent=${parentInstance.id} popupWebContentsId=${popupWcId} code=${errorCode} url=${validatedURL} error=${errorDescription}`,
      )
    })

    popupWindow.on('closed', () => {
      this.unregisterPopupWindow(popupWindow, 'closed')
    })
  }

  private unregisterPopupWindow(popupWindow: BrowserWindow, reason: 'closed' | 'parent_destroy' | 'parent_hide' | 'reparented'): void {
    const popupWcId = popupWindow.webContents.id
    const parentId = this.popupParentByWebContentsId.get(popupWcId)
    if (!parentId) return

    this.popupParentByWebContentsId.delete(popupWcId)

    const popups = this.popupWindowsByParentInstanceId.get(parentId)
    if (popups) {
      popups.delete(popupWindow)
      if (popups.size === 0) {
        this.popupWindowsByParentInstanceId.delete(parentId)
      }
    }

    mainLog.info(`[browser-pane] popup closed parent=${parentId} popupWebContentsId=${popupWcId} reason=${reason}`)
  }

  private closePopupsForParent(parentId: string, reason: 'parent_destroy' | 'parent_hide'): void {
    const popups = this.popupWindowsByParentInstanceId.get(parentId)
    if (!popups || popups.size === 0) return

    for (const popupWindow of Array.from(popups)) {
      const popupWcId = popupWindow.webContents.id
      this.unregisterPopupWindow(popupWindow, reason)
      try {
        if (!popupWindow.isDestroyed()) {
          popupWindow.destroy()
        }
      } catch (error) {
        mainLog.warn(
          `[browser-pane] popup destroy failed parent=${parentId} popupWebContentsId=${popupWcId} reason=${reason} error=${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
  }

  /**
   * b2.6 residual (popup-not-tab): a page-hosted `window.open` / `target=_blank`
   * must not become an unmanaged popup window. Convert an allowed http(s)
   * target into a new managed pane that mirrors the opener's profile
   * (partition), owner and workspace, then bring it into the host.
   *
   * The opener's identity aliasing (empty-state page → about:blank, and the
   * deep-link trust boundary derived from it) is deliberately untouched: this
   * only ever adds a sibling pane.
   *
   * The new pane is announced to the renderer through the existing
   * STATE_CHANGED push (emitted by create*), so the tab strip shows it without
   * a reload. Windowed panes are focused here; embedded panes surface as a tab
   * in the host window's strip.
   */
  private openWindowOpenTargetAsPane(parentInstance: BrowserInstance, url: string): string {
    let id: string
    if (parentInstance.embedded) {
      id = this.createEmbeddedInstance({
        url,
        partition: parentInstance.partition,
        workspaceId: parentInstance.workspaceId,
      })
    } else {
      id = this.createInstance(undefined, {
        show: true,
        ownerType: parentInstance.ownerType,
        ownerSessionId: parentInstance.ownerSessionId ?? undefined,
        workspaceId: parentInstance.workspaceId,
        partition: parentInstance.partition,
      })
      void this.navigate(id, url).catch((error) => {
        mainLog.warn(
          `[browser-pane] window-open tab navigate failed parent=${parentInstance.id} id=${id} url=${url}: ${error instanceof Error ? error.message : String(error)}`,
        )
      })
      this.focus(id)
    }

    mainLog.info(`[browser-pane] window-open converted to tab parent=${parentInstance.id} id=${id} embedded=${parentInstance.embedded} url=${url}`)
    return id
  }

  private pushNetworkLog(instance: BrowserInstance, entry: BrowserNetworkEntry): void {
    instance.networkLogs.push(entry)
    if (instance.networkLogs.length > MAX_NETWORK_LOG_ENTRIES) {
      instance.networkLogs.splice(0, instance.networkLogs.length - MAX_NETWORK_LOG_ENTRIES)
    }
  }

  private pushDownloadLog(instance: BrowserInstance, entry: BrowserDownloadEntry): void {
    instance.downloads.push(entry)
    if (instance.downloads.length > MAX_DOWNLOAD_LOG_ENTRIES) {
      instance.downloads.splice(0, instance.downloads.length - MAX_DOWNLOAD_LOG_ENTRIES)
    }
  }

  private resolveDownloadsDir(instance: BrowserInstance): string {
    const sessionId = instance.boundSessionId ?? instance.ownerSessionId
    if (sessionId && this.sessionPathResolver) {
      const sessionPath = this.sessionPathResolver(sessionId)
      if (sessionPath) {
        const dir = join(sessionPath, 'downloads')
        mkdirSync(dir, { recursive: true })
        return dir
      }
    }
    // Fallback: OS downloads folder for manual/unbound windows
    return app.getPath('downloads')
  }

  private uniqueFilename(dir: string, filename: string): string {
    if (!existsSync(join(dir, filename))) return filename
    const { name, ext } = parsePath(filename)
    let counter = 1
    while (existsSync(join(dir, `${name}_${counter}${ext}`))) {
      counter++
    }
    return `${name}_${counter}${ext}`
  }

  private setupSessionObservers(ses: ElectronSession): void {
    if (this.partitionObserversInitialized.has(ses)) return
    this.partitionObserversInitialized.add(ses)

    ses.webRequest.onBeforeRequest((details, callback) => {
      const wcId = details.webContentsId
      if (typeof wcId === 'number' && wcId > 0) {
        const current = this.inFlightRequestsByWebContentsId.get(wcId) ?? 0
        this.inFlightRequestsByWebContentsId.set(wcId, current + 1)
        this.lastNetworkActivityByWebContentsId.set(wcId, Date.now())
      }
      callback({})
    })

    ses.webRequest.onCompleted((details) => {
      const wcId = details.webContentsId
      if (typeof wcId !== 'number' || wcId <= 0) return

      const current = this.inFlightRequestsByWebContentsId.get(wcId) ?? 0
      this.inFlightRequestsByWebContentsId.set(wcId, Math.max(0, current - 1))
      this.lastNetworkActivityByWebContentsId.set(wcId, Date.now())

      const instance = this.getInstanceByWebContentsId(wcId)
      if (!instance) return

      this.pushNetworkLog(instance, {
        timestamp: Date.now(),
        method: details.method ?? 'GET',
        url: details.url ?? '',
        status: details.statusCode ?? 0,
        resourceType: String(details.resourceType ?? 'unknown'),
        ok: (details.statusCode ?? 0) >= 200 && (details.statusCode ?? 0) < 400,
      })
    })

    ses.webRequest.onErrorOccurred((details) => {
      const wcId = details.webContentsId
      if (typeof wcId !== 'number' || wcId <= 0) return

      const current = this.inFlightRequestsByWebContentsId.get(wcId) ?? 0
      this.inFlightRequestsByWebContentsId.set(wcId, Math.max(0, current - 1))
      this.lastNetworkActivityByWebContentsId.set(wcId, Date.now())

      const instance = this.getInstanceByWebContentsId(wcId)
      if (!instance) return

      this.pushNetworkLog(instance, {
        timestamp: Date.now(),
        method: details.method ?? 'GET',
        url: details.url ?? '',
        status: 0,
        resourceType: String(details.resourceType ?? 'unknown'),
        ok: false,
      })
    })

    ses.on('will-download', (_event, item, webContents) => {
      const wcId = webContents?.id
      if (typeof wcId !== 'number') return
      const instance = this.getInstanceByWebContentsId(wcId)
      if (!instance) return

      // Auto-save: set a deterministic path so Electron doesn't show a native dialog
      const downloadsDir = this.resolveDownloadsDir(instance)
      const filename = this.uniqueFilename(downloadsDir, item.getFilename())
      const savePath = join(downloadsDir, filename)
      item.setSavePath(savePath)

      const downloadId = `dl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const started: BrowserDownloadEntry = {
        id: downloadId,
        timestamp: Date.now(),
        url: item.getURL(),
        filename,
        state: 'started',
        bytesReceived: item.getReceivedBytes(),
        totalBytes: item.getTotalBytes(),
        mimeType: item.getMimeType() || 'application/octet-stream',
        savePath,
      }
      this.pushDownloadLog(instance, started)

      const onUpdated = (_e: Electron.Event, state: string) => {
        const latest = instance.downloads.find((d) => d.id === downloadId)
        if (!latest) return
        latest.bytesReceived = item.getReceivedBytes()
        latest.totalBytes = item.getTotalBytes()
        if (state === 'interrupted') latest.state = 'interrupted'
      }

      item.on('updated', onUpdated)

      item.once('done', (_e, state) => {
        item.removeListener('updated', onUpdated)
        const latest = instance.downloads.find((d) => d.id === downloadId)
        if (!latest) return
        latest.bytesReceived = item.getReceivedBytes()
        latest.totalBytes = item.getTotalBytes()
        latest.savePath = item.getSavePath()
        latest.state = state === 'completed' ? 'completed' : state === 'cancelled' ? 'cancelled' : 'interrupted'
      })
    })
  }

  private logPermissionDecision(kind: 'check' | 'request', permission: string, origin: string): void {
    const isNonBlockingNoise = permission === 'background-sync'
    const suffix = isNonBlockingNoise ? ' (non-blocking)' : ''
    const message = `[browser-pane] permission denied (${kind}): ${permission} origin=${origin}${suffix}`
    if (isNonBlockingNoise) {
      mainLog.info(message)
      return
    }
    mainLog.warn(message)
  }

  private setupSessionPermissions(ses: ElectronSession): void {
    if (this.partitionPermissionsInitialized.has(ses)) return
    this.partitionPermissionsInitialized.add(ses)

    const allow = new Set([
      'fullscreen',
      'pointerLock',
      'window-management',
      'notifications',
      'geolocation',
      'media',
      'clipboard-read',
      'clipboard-sanitized-write',
      'idle-detection',
    ])

    if (typeof ses.setPermissionCheckHandler === 'function') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ses.setPermissionCheckHandler((_webContents, permission: string, requestingOrigin: string, _details: any) => {
        const allowed = allow.has(permission)
        if (!allowed) {
          this.logPermissionDecision('check', permission, requestingOrigin)
        }
        return allowed
      })
    }

    if (typeof ses.setPermissionRequestHandler === 'function') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ses.setPermissionRequestHandler((_webContents, permission: string, callback: (allow: boolean) => void, details: any) => {
        const allowed = allow.has(permission)
        if (!allowed) {
          this.logPermissionDecision('request', permission, details?.requestingOrigin ?? 'unknown')
        }
        callback(allowed)
      })
    }
  }

  private isToolbarUiDocumentUrl(url: string): boolean {
    if (!url) return false
    if (url.startsWith('data:text/html')) return true

    try {
      const parsed = new URL(url)
      return parsed.pathname.toLowerCase().endsWith('/browser-toolbar.html')
    } catch {
      return /browser-toolbar\.html(?:$|[?#])/i.test(url)
    }
  }

  private setupWindowListeners(instance: BrowserInstance): void {
    const pageWc = instance.pageView.webContents
    // Toolbar + native-overlay listeners are bound when those views are
    // materialised (`bindToolbarViewListeners` / `bindNativeOverlayListeners`),
    // because both are created lazily.

    const window = instance.window
    window?.on('close', (event) => {
      const explicitDestroy = this.destroyingIds.has(instance.id)
      const interceptToHide = !explicitDestroy && instance.keepAliveOnWindowClose
      mainLog.info(`[browser-pane] window close requested id=${instance.id} explicitDestroy=${explicitDestroy} keepAlive=${instance.keepAliveOnWindowClose} interceptToHide=${interceptToHide}`)

      if (interceptToHide) {
        event.preventDefault()
        // Skip if a hide is already in flight — hide() guards against re-entry
        // itself, but bailing here also avoids redundant log noise during the
        // teardown race that triggered issue #695.
        if (!instance.isHiding) {
          this.hide(instance.id)
        }
      }
    })

    window?.on('resize', () => {
      this.layoutAllViews(instance)
    })

    pageWc.on('did-start-loading', () => {
      instance.isLoading = true
      this.emitStateChange(instance)
      void this.pushToolbarState(instance)
    })

    pageWc.on('did-stop-loading', () => {
      instance.isLoading = false
      instance.canGoBack = pageWc.canGoBack()
      instance.canGoForward = pageWc.canGoForward()
      // Drain in-flight count — all pending requests are settled once loading stops
      this.inFlightRequestsByWebContentsId.set(pageWc.id, 0)
      this.lastNetworkActivityByWebContentsId.set(pageWc.id, Date.now())
      this.emitStateChange(instance)
      void this.pushToolbarState(instance)
      void this.extractThemeColor(instance)
      this.reapplyAgentControlVisual(instance)
    })

    pageWc.on('dom-ready', () => {
      this.installThemeObserver(instance)
      void this.extractThemeColor(instance)
    })

    pageWc.on('before-input-event', (event, input) => {
      if (instance.lockState.active) {
        event.preventDefault()
        return
      }
      if (this.sendPanelFocusDirection(instance, event, input)) return
      if (isOmniboxChord(input)) {
        event.preventDefault()
        this.requestOmniboxOpen(instance)
      }
    })

    pageWc.on('did-navigate', (_event, urlFromEvent) => {
      const url = typeof pageWc.getURL === 'function' ? pageWc.getURL() : (urlFromEvent || instance.currentUrl)
      const previousUrl = instance.currentUrl
      if (instance.inPageThemeTimer) {
        clearTimeout(instance.inPageThemeTimer)
        instance.inPageThemeTimer = null
      }
      instance.themeObserverToken = null
      instance.themeColor = null // reset for new page (batched with state push below)
      const normalized = this.normalizePageState(url, pageWc.getTitle())
      instance.currentUrl = normalized.url
      instance.title = normalized.title
      mainLog.info(`[browser-pane] did-navigate id=${instance.id} from=${previousUrl} to=${instance.currentUrl}`)
      instance.canGoBack = pageWc.canGoBack()
      instance.canGoForward = pageWc.canGoForward()
      // Drain in-flight count — prior page's requests are cancelled on navigation
      this.inFlightRequestsByWebContentsId.set(pageWc.id, 0)
      this.lastNetworkActivityByWebContentsId.set(pageWc.id, Date.now())
      this.emitStateChange(instance)
      void this.pushToolbarState(instance)
      this.scheduleEarlyThemeExtraction(instance, url)
      this.reapplyAgentControlVisual(instance)
    })

    pageWc.on('did-redirect-navigation', (_event, url, isInPlace, isMainFrame) => {
      if (!isMainFrame) return
      mainLog.info(`[browser-pane] did-redirect-navigation id=${instance.id} url=${url} inPlace=${isInPlace}`)
    })

    pageWc.on('did-navigate-in-page', (_event, urlFromEvent) => {
      const url = typeof pageWc.getURL === 'function' ? pageWc.getURL() : (urlFromEvent || instance.currentUrl)
      const normalized = this.normalizePageState(url, instance.title)
      instance.currentUrl = normalized.url
      instance.title = normalized.title
      instance.canGoBack = pageWc.canGoBack()
      instance.canGoForward = pageWc.canGoForward()

      void this.maybeHandleEmptyStateLaunch(instance, url).then((handled) => {
        if (handled) {
          this.emitStateChange(instance)
          void this.pushToolbarState(instance)
          return
        }

        // SPA route change — re-extract theme color (debounced)
        if (instance.inPageThemeTimer) clearTimeout(instance.inPageThemeTimer)
        instance.themeObserverToken = null
        instance.themeColor = null
        this.emitStateChange(instance)
        void this.pushToolbarState(instance)
        this.installThemeObserver(instance)
        instance.inPageThemeTimer = setTimeout(() => { void this.extractThemeColor(instance) }, 300)
        this.reapplyAgentControlVisual(instance)
      }).catch((error) => {
        mainLog.warn(`[browser-pane] empty-state launch handling failed id=${instance.id}: ${error instanceof Error ? error.message : String(error)}`)
      })
    })

    pageWc.on('page-title-updated', (_event, title) => {
      const normalized = this.normalizePageState(pageWc.getURL(), title)
      instance.title = normalized.title
      this.emitStateChange(instance)
      void this.pushToolbarState(instance)
    })

    pageWc.on('page-favicon-updated', (_event, favicons) => {
      instance.favicon = favicons[0] || null
      this.emitStateChange(instance)
    })

    pageWc.on('did-change-theme-color', (_event, color) => {
      this.applyThemeColor(instance, color ?? null)
    })

    pageWc.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
      mainLog.warn(`[browser-pane] did-fail-load id=${instance.id} code=${errorCode} url=${validatedURL} error=${errorDescription}`)
    })

    pageWc.on('console-message', (_event, level, message) => {
      if (message.startsWith(THEME_COLOR_SIGNAL_PREFIX)) {
        const payload = message.slice(THEME_COLOR_SIGNAL_PREFIX.length)
        const delimiterIdx = payload.indexOf(':')
        if (delimiterIdx > 0) {
          const token = payload.slice(0, delimiterIdx)
          const value = payload.slice(delimiterIdx + 1).trim()
          if (token === instance.themeObserverToken) {
            if (value === THEME_COLOR_NULL_SENTINEL) {
              this.applyThemeColor(instance, null)
            } else if (value.length > 0) {
              this.applyThemeColor(instance, value)
            }
          }
        }
        return
      }

      const mappedLevel: BrowserConsoleEntry['level'] = level >= 3 ? 'error' : level === 2 ? 'warn' : level === 1 ? 'info' : 'log'
      instance.consoleLogs.push({
        timestamp: Date.now(),
        level: mappedLevel,
        message,
      })
      if (instance.consoleLogs.length > MAX_CONSOLE_LOG_ENTRIES) {
        instance.consoleLogs.splice(0, instance.consoleLogs.length - MAX_CONSOLE_LOG_ENTRIES)
      }

      if (level >= 2) {
        mainLog.warn(`[browser-pane] console id=${instance.id} level=${level}: ${message}`)
      }
    })

    pageWc.on('will-navigate', (event, url) => {
      if (!url.startsWith(CRAFT_DEEPLINK_SCHEME_PREFIX)) return
      // Always prevent the scheme from being handed to the OS; decide afterwards.
      event.preventDefault()
      if (!this.isDeeplinkAllowedFromPage(instance)) {
        mainLog.warn(`[browser-pane] blocked deep-link navigation from untrusted page id=${instance.id} url=${url}`)
        return
      }
      void this.handleDeepLinkUrl(url)
    })

    pageWc.on('did-create-window', (popupWindow, details) => {
      const popupUrl = details?.url || popupWindow.webContents.getURL?.() || 'about:blank'
      this.registerPopupWindow(instance, popupWindow, popupUrl)
    })

    pageWc.setWindowOpenHandler((details) => {
      mainLog.info(
        `[browser-pane] window-open requested id=${instance.id} url=${details.url} disposition=${details.disposition ?? 'unknown'} frameName=${details.frameName || 'none'}`,
      )

      if (details.url.startsWith(CRAFT_DEEPLINK_SCHEME_PREFIX)) {
        if (this.isDeeplinkAllowedFromPage(instance)) {
          void this.handleDeepLinkUrl(details.url)
        } else {
          mainLog.warn(`[browser-pane] blocked deep-link popup from untrusted page id=${instance.id} url=${details.url}`)
        }
        return { action: 'deny' }
      }

      let parsed: URL
      try {
        parsed = new URL(details.url)
      } catch {
        mainLog.warn(`[browser-pane] window-open denied id=${instance.id} reason=invalid_url url=${details.url}`)
        return { action: 'deny' }
      }

      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        mainLog.warn(`[browser-pane] window-open denied id=${instance.id} reason=unsupported_protocol protocol=${parsed.protocol} url=${details.url}`)
        return { action: 'deny' }
      }

      // b2.6 residual: turn the popup into a managed tab in the opener's host
      // rather than an unmanaged popup BrowserWindow. The request itself is
      // still denied as a popup — the new pane is created by the manager.
      this.openWindowOpenTargetAsPane(instance, details.url)
      return { action: 'deny' }
    })

    pageWc.on('focus', () => {
      this.interactedCallback?.(instance.id)
    })

    window?.on('focus', () => {
      this.interactedCallback?.(instance.id)
    })

    window?.on('show', () => {
      instance.isVisible = true
      this.emitStateChange(instance)
      this.reapplyAgentControlVisual(instance)
      this.pushToolbarState(instance)
      this.updateNativeOverlayState(instance)
      if (!instance.themeColor) {
        void this.extractThemeColor(instance)
      }
    })

    window?.on('hide', () => {
      instance.isVisible = false
      this.emitStateChange(instance)
      this.updateNativeOverlayState(instance)
    })

    window?.on('closed', () => {
      this.finalizeDestroyedInstance(instance, 'closed')
    })
  }

  private toInfo(instance: BrowserInstance): BrowserInstanceInfo {
    return {
      id: instance.id,
      url: instance.currentUrl,
      title: instance.title,
      favicon: instance.favicon,
      isLoading: instance.isLoading,
      canGoBack: instance.canGoBack,
      canGoForward: instance.canGoForward,
      boundSessionId: instance.boundSessionId,
      ownerType: instance.ownerType,
      ownerSessionId: instance.ownerSessionId,
      isVisible: instance.isVisible,
      agentControlActive: !!instance.agentControl?.active,
      themeColor: instance.themeColor,
      workspaceId: instance.workspaceId,
      embedded: instance.embedded,
      partition: instance.partition,
    }
  }

  private emitStateChange(instance: BrowserInstance): void {
    if (!this.instances.has(instance.id)) {
      return
    }
    this.stateChangeCallback?.(this.toInfo(instance))
  }
}
