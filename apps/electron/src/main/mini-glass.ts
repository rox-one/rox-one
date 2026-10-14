/**
 * Mini glass companion (#1500s, ChatGPT-desktop-companion style).
 *
 * When a main window is minimized on macOS, a tiny frameless, transparent,
 * always-on-top window floats on the desktop with two circular glass icon
 * buttons: "New request" (expands into a pill input) and "Voice" (records and
 * transcribes into that input). Submitting restores the owning main window and
 * runs the regular `new-session` deeplink action with `send=true`, so the
 * session is created with the user's default provider through the same path
 * as the app's own composer. The companion hides whenever the owner window is
 * restored, shown or focused.
 */

import { BrowserWindow, ipcMain, screen } from 'electron'
import { join } from 'node:path'

const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

import { MINI_GLASS_COLLAPSED, MINI_GLASS_EXPANDED, resolveMiniGlassOrigin, type MiniGlassPosition } from './mini-glass-geometry'
import { MINI_GLASS_RESET } from '../shared/mini-glass'

export { MINI_GLASS_COLLAPSED, MINI_GLASS_EXPANDED, resolveMiniGlassOrigin, type MiniGlassPosition }
export const MINI_GLASS_MAX_INPUT = 8000

export interface MiniGlassDeps {
  registerAuxiliaryWindow(window: BrowserWindow, workspaceId: string): void
  readPosition(): MiniGlassPosition | null
  writePosition(position: MiniGlassPosition): void
  isEnabled(): boolean
  /** True when the sender is a managed main window (where Settings lives). */
  isMainWindowSender(webContentsId: number): boolean
  writeEnabled(enabled: boolean): void
  /** Push an event to the companion renderer via the window-manager relay (typed sink first). */
  pushToWindow(window: BrowserWindow, channel: string, ...args: unknown[]): void
  /** Restore the owner and run `new-session` (send when `text` is non-empty). */
  submitToOwner(owner: BrowserWindow, text: string | null): void
}

export class MiniGlassController {
  private window: BrowserWindow | null = null
  private owner: BrowserWindow | null = null
  private expanded = false

  constructor(private readonly deps: MiniGlassDeps) {
    activeController = this
    registerMiniGlassHandlers()
  }

  isVisibleFor(owner: BrowserWindow): boolean {
    return this.owner === owner && !!this.window && !this.window.isDestroyed() && this.window.isVisible()
  }

  /** Show the companion for a just-minimized main window. */
  show(owner: BrowserWindow, workspaceId: string): void {
    if (!this.deps.isEnabled() || owner.isDestroyed()) return
    // A companion bound to another workspace must not submit there.
    if (this.window && !this.window.isDestroyed() && this.owner !== owner) this.destroyWindow()
    this.owner = owner
    if (!this.window || this.window.isDestroyed()) this.window = this.create(workspaceId)
    else this.applyBounds(false)
    this.window.showInactive()
  }

  /** Hide when the owner comes back (restore/show/focus) or closes. */
  hide(owner?: BrowserWindow): void {
    if (owner && this.owner !== owner) return
    const window = this.window
    if (!window || window.isDestroyed()) return
    if (this.expanded) this.setExpanded(false)
    // Sanctioned main→renderer path (typed event sink first, raw send only before
    // the WS handshake) — `scripts/check-raw-sends.sh` forbids new direct sends.
    this.deps.pushToWindow(window, MINI_GLASS_RESET)
    window.hide()
  }

  ownerClosed(owner: BrowserWindow): void {
    if (this.owner !== owner) return
    this.owner = null
    this.destroyWindow()
  }

  dispose(): void {
    this.owner = null
    this.destroyWindow()
  }

  private destroyWindow(): void {
    const window = this.window
    this.window = null
    this.expanded = false
    if (window && !window.isDestroyed()) window.destroy()
  }

  private create(workspaceId: string): BrowserWindow {
    const isMac = process.platform === 'darwin'
    const window = new BrowserWindow({
      ...MINI_GLASS_COLLAPSED,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: 'transparent',
      hasShadow: false,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      focusable: true,
      title: '',
      ...(isMac && { roundedCorners: false }),
      webPreferences: {
        preload: join(__dirname, 'bootstrap-preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        backgroundThrottling: false,
      },
    })
    window.setAlwaysOnTop(true, 'floating')
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    if (isMac) {
      try { window.setWindowButtonVisibility(false) } catch { /* frameless: no buttons anyway */ }
    }
    this.expanded = false
    this.window = window
    this.applyBounds(false)
    // Bind before load: the preload's sync proof/workspace channels run on eval.
    this.deps.registerAuxiliaryWindow(window, workspaceId)
    window.on('moved', () => {
      // Only user drags of the collapsed buttons define the remembered spot;
      // the expanded pill may be shifted to stay on screen.
      if (window.isDestroyed() || this.expanded) return
      const [x, y] = window.getPosition()
      this.deps.writePosition({ x, y })
    })
    window.once('closed', () => {
      if (this.window === window) { this.window = null; this.expanded = false }
    })
    if (VITE_DEV_SERVER_URL) {
      const params = new URLSearchParams({ surface: 'mini-glass', workspaceId })
      void window.loadURL(`${VITE_DEV_SERVER_URL}?${params.toString()}`)
    } else {
      void window.loadFile(join(__dirname, 'renderer/index.html'), { query: { surface: 'mini-glass', workspaceId } })
    }
    return window
  }

  private applyBounds(expanded: boolean): void {
    const window = this.window
    if (!window || window.isDestroyed()) return
    const size = expanded ? MINI_GLASS_EXPANDED : MINI_GLASS_COLLAPSED
    const current = window.isVisible() ? { x: window.getBounds().x, y: window.getBounds().y } : this.deps.readPosition()
    const displays = screen.getAllDisplays().map(display => display.workArea)
    let origin = resolveMiniGlassOrigin(current, MINI_GLASS_COLLAPSED, displays, screen.getPrimaryDisplay().workArea)
    if (expanded) {
      // Grow toward the side with room so the input never leaves the screen.
      const area = screen.getDisplayMatching({ ...origin, ...MINI_GLASS_COLLAPSED }).workArea
      const overflow = origin.x + size.width - (area.x + area.width)
      if (overflow > 0) origin = { ...origin, x: Math.max(area.x, origin.x - overflow) }
    }
    window.setBounds({ ...origin, ...size }, false)
  }

  private setExpanded(expanded: boolean): void {
    const window = this.window
    if (!window || window.isDestroyed() || this.expanded === expanded) return
    if (!expanded) {
      // Collapse back to where the buttons were before growing.
      this.expanded = false
      const remembered = this.deps.readPosition()
      const size = MINI_GLASS_COLLAPSED
      const origin = resolveMiniGlassOrigin(remembered, size, screen.getAllDisplays().map(d => d.workArea), screen.getPrimaryDisplay().workArea)
      window.setBounds({ ...origin, ...size }, false)
      return
    }
    const [x, y] = window.getPosition()
    this.deps.writePosition({ x, y })
    this.expanded = true
    this.applyBounds(true)
    window.focus()
  }

  /** @internal IPC entry points (module-level handlers delegate here). */
  isCompanionSender(event: Electron.IpcMainInvokeEvent): boolean {
    const window = this.window
    return !!window && !window.isDestroyed() && event.sender.id === window.webContents.id
  }

  handleSetExpanded(expanded: boolean): void { this.setExpanded(expanded) }

  isEnabled(): boolean { return this.deps.isEnabled() }

  isMainWindowSender(event: Electron.IpcMainInvokeEvent): boolean {
    return this.deps.isMainWindowSender(event.sender.id)
  }

  setEnabled(enabled: boolean): void {
    this.deps.writeEnabled(enabled)
    if (!enabled) this.dispose()
  }

  handleSubmit(text: string | null): boolean {
    const owner = this.owner
    if (!owner || owner.isDestroyed()) return false
    const trimmed = typeof text === 'string' ? text.trim().slice(0, MINI_GLASS_MAX_INPUT) : ''
    this.hide()
    this.deps.submitToOwner(owner, trimmed || null)
    return true
  }
}

let activeController: MiniGlassController | null = null
let handlersRegistered = false

function registerMiniGlassHandlers(): void {
  if (handlersRegistered || typeof ipcMain?.handle !== 'function') return
  handlersRegistered = true
  ipcMain.handle('mini-glass:set-expanded', (event, expanded: unknown) => {
    const controller = activeController
    if (!controller?.isCompanionSender(event) || typeof expanded !== 'boolean') return false
    controller.handleSetExpanded(expanded)
    return true
  })
  ipcMain.handle('mini-glass:get-enabled', (event) => {
    const controller = activeController
    if (!controller?.isMainWindowSender(event)) return false
    return controller.isEnabled()
  })
  ipcMain.handle('mini-glass:set-enabled', (event, enabled: unknown) => {
    const controller = activeController
    if (!controller?.isMainWindowSender(event)) return false
    if (typeof enabled !== 'boolean') return controller.isEnabled()
    controller.setEnabled(enabled)
    return enabled
  })
  ipcMain.handle('mini-glass:submit', (event, text: unknown) => {
    const controller = activeController
    if (!controller?.isCompanionSender(event)) return false
    if (text !== null && typeof text !== 'string') return false
    return controller.handleSubmit(text)
  })
}
