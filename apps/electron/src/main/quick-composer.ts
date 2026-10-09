/**
 * Floating quick composer — a small glass window plus its global accelerator.
 *
 * The window loads the app renderer with `?surface=quick-composer` and the
 * standard preload, so the renderer has the full `window.electronAPI` surface.
 * To make that RPC surface work the window is registered as an auxiliary
 * (non-persisted) window binding on the `WindowManager`: the preload's proof /
 * token / workspace sendSync channels then resolve exactly like a normal window.
 *
 * All state is module-level; main handlers reach it through
 * `getQuickComposerController()`. `initQuickComposer` is called once at startup.
 */

import type { BrowserWindow } from 'electron'
import { join } from 'node:path'

const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL
const HIDDEN_BACKGROUND = '#1c1c1e'
const QUICK_COMPOSER_WIDTH = 560
const QUICK_COMPOSER_HEIGHT = 240

export interface QuickComposerShortcutDeps {
  register(accelerator: string, callback: () => void): boolean
  unregister(accelerator: string): void
}

export interface QuickComposerSetShortcutResult {
  ok: boolean
  accelerator?: string | null
  error?: string
}

export interface QuickComposerDeps {
  createWindow(options: Electron.BrowserWindowConstructorOptions): BrowserWindow
  /** Bind the window to a workspace for preload proof/token resolution. */
  registerAuxiliaryWindow(window: BrowserWindow, workspaceId: string): void
  shortcuts: QuickComposerShortcutDeps
  readShortcut(): string | null
  writeShortcut(accelerator: string | null): void
  /** Workspace the global shortcut opens the composer for (focused/first window). */
  resolveWorkspaceId(): string | null
  isMac: boolean
  prefersSolid(): boolean
}

export class QuickComposerController {
  private window: BrowserWindow | null = null
  private registeredAccelerator: string | null = null

  constructor(private readonly deps: QuickComposerDeps) {}

  isOpen(): boolean {
    return this.window !== null && !this.window.isDestroyed()
  }

  /** Create or re-focus the composer for `workspaceId` (or the resolved window). */
  open(workspaceId: string | null): { ok: boolean; error?: string } {
    const existing = this.window
    if (existing && !existing.isDestroyed()) {
      if (existing.isMinimized()) existing.restore()
      existing.show()
      existing.focus()
      return { ok: true }
    }
    const targetWorkspace = workspaceId ?? this.deps.resolveWorkspaceId()
    if (!targetWorkspace) return { ok: false, error: 'NO_WORKSPACE' }

    const { isMac, prefersSolid } = this.deps
    const glass = isMac && !prefersSolid()
    const window = this.deps.createWindow({
      width: QUICK_COMPOSER_WIDTH,
      height: QUICK_COMPOSER_HEIGHT,
      show: false,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      title: '',
      backgroundColor: glass ? undefined : HIDDEN_BACKGROUND,
      ...(isMac && {
        titleBarStyle: 'hiddenInset' as const,
        roundedCorners: true,
        ...(glass && { vibrancy: 'hud' as const, visualEffectState: 'active' as const, transparent: true }),
      }),
      webPreferences: {
        preload: join(__dirname, 'bootstrap-preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    })
    this.window = window

    // Register the binding BEFORE load: the preload's synchronous bootstrap
    // channels (`__get-workspace-id`, `__get-local-client-proof`) run on eval.
    this.deps.registerAuxiliaryWindow(window, targetWorkspace)

    window.once('ready-to-show', () => {
      if (window.isDestroyed()) return
      if (isMac) {
        try {
          window.setWindowButtonVisibility(false)
          if (glass) {
            window.setVibrancy('hud')
            // `setVisualEffectState` is not in the pinned Electron typings but exists at runtime.
            const vibrancyWindow = window as unknown as { setVisualEffectState?: (state: string) => void }
            vibrancyWindow.setVisualEffectState?.('active')
          }
        } catch {
          // Material is cosmetic; the window still shows solid.
        }
      }
      window.show()
      window.focus()
    })
    window.once('closed', () => {
      if (this.window === window) this.window = null
    })

    if (VITE_DEV_SERVER_URL) {
      const params = new URLSearchParams({ surface: 'quick-composer', workspaceId: targetWorkspace })
      void window.loadURL(`${VITE_DEV_SERVER_URL}?${params.toString()}`)
    } else {
      void window.loadFile(join(__dirname, 'renderer/index.html'), {
        query: { surface: 'quick-composer', workspaceId: targetWorkspace },
      })
    }
    return { ok: true }
  }

  close(): { ok: boolean } {
    const window = this.window
    this.window = null
    if (window && !window.isDestroyed()) window.destroy()
    return { ok: true }
  }

  getShortcut(): string | null {
    return this.deps.readShortcut()
  }

  setShortcut(accelerator: string | null): QuickComposerSetShortcutResult {
    const next = typeof accelerator === 'string' ? accelerator.trim() : accelerator
    if (next !== null && !next) return { ok: false, error: 'INVALID_ACCELERATOR' }

    const previous = this.registeredAccelerator
    const previousPersisted = this.deps.readShortcut()
    if (previous) this.deps.shortcuts.unregister(previous)
    this.registeredAccelerator = null

    if (next === null) {
      this.deps.writeShortcut(null)
      return { ok: true, accelerator: null }
    }
    if (!this.tryRegister(next)) {
      // Conflict (or invalid accelerator): keep the old binding and report.
      if (previous && previous !== next) {
        if (this.tryRegister(previous)) this.registeredAccelerator = previous
      }
      this.deps.writeShortcut(previousPersisted)
      return { ok: false, accelerator: this.registeredAccelerator, error: 'SHORTCUT_UNAVAILABLE' }
    }
    this.registeredAccelerator = next
    this.deps.writeShortcut(next)
    return { ok: true, accelerator: next }
  }

  /** (Re)apply the persisted accelerator. Idempotent across repeated calls. */
  syncShortcut(): void {
    const desired = this.deps.readShortcut()
    if (desired === this.registeredAccelerator) return
    if (this.registeredAccelerator) {
      this.deps.shortcuts.unregister(this.registeredAccelerator)
      this.registeredAccelerator = null
    }
    if (desired && this.tryRegister(desired)) this.registeredAccelerator = desired
  }

  dispose(): void {
    this.close()
    if (this.registeredAccelerator) {
      this.deps.shortcuts.unregister(this.registeredAccelerator)
      this.registeredAccelerator = null
    }
  }

  private tryRegister(accelerator: string): boolean {
    try {
      return this.deps.shortcuts.register(accelerator, () => {
        this.open(this.deps.resolveWorkspaceId())
      })
    } catch {
      return false
    }
  }
}

let controller: QuickComposerController | null = null

export function initQuickComposer(deps: QuickComposerDeps): QuickComposerController {
  controller?.dispose()
  controller = new QuickComposerController(deps)
  controller.syncShortcut()
  return controller
}

export function getQuickComposerController(): QuickComposerController | null {
  return controller
}

export function disposeQuickComposer(): void {
  controller?.dispose()
  controller = null
}