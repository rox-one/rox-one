import { randomUUID } from 'crypto'
import { app, BrowserWindow, type BrowserWindowConstructorOptions } from 'electron'
import { isAllowedOpenDesignNavigation, validateOpenDesignInitialUrl } from '../shared/open-design'

export { isAllowedOpenDesignNavigation, validateOpenDesignInitialUrl } from '../shared/open-design'

type BrowserWindowLike = Pick<BrowserWindow, 'focus' | 'isDestroyed' | 'loadURL' | 'once' | 'show'> & {
  destroy(): void
  webContents: Pick<
    BrowserWindow['webContents'],
    'closeDevTools' | 'isDestroyed' | 'on' | 'setWindowOpenHandler'
  > & {
    session: {
      on(event: 'will-download', listener: (event: { preventDefault(): void }) => void): unknown
      setPermissionCheckHandler?(handler: () => boolean): unknown
      setPermissionRequestHandler?(
        handler: (
          webContents: unknown,
          permission: string,
          callback: (permissionGranted: boolean) => void,
          details?: unknown,
        ) => void,
      ): unknown
    }
  }
}

type BrowserWindowFactory = (options: BrowserWindowConstructorOptions) => BrowserWindowLike

export interface OpenDesignWindowControllerDeps {
  createBrowserWindow?: BrowserWindowFactory
  isPackaged?: boolean
}

export class OpenDesignWindowController {
  private readonly createBrowserWindow: BrowserWindowFactory
  private readonly isPackaged: boolean
  private window: BrowserWindowLike | null = null

  constructor(deps: OpenDesignWindowControllerDeps = {}) {
    this.createBrowserWindow = deps.createBrowserWindow ?? ((options) => new BrowserWindow(options))
    this.isPackaged = deps.isPackaged ?? app.isPackaged
  }

  hasWindow(): boolean {
    return this.window != null && !this.window.isDestroyed()
  }

  close(): void {
    const current = this.window
    this.window = null
    if (current && !current.isDestroyed()) {
      current.destroy()
    }
  }

  async open(rawUrl: string): Promise<void> {
    const initialUrl = validateOpenDesignInitialUrl(rawUrl)
    const existing = this.window
    if (existing && !existing.isDestroyed()) {
      existing.focus()
      return
    }

    const window = this.createBrowserWindow({
      width: 1440,
      height: 960,
      minWidth: 1024,
      minHeight: 720,
      show: false,
      title: 'Open Design',
      autoHideMenuBar: true,
      webPreferences: {
        contextIsolation: true,
        devTools: !this.isPackaged,
        nodeIntegration: false,
        partition: `open-design:${randomUUID()}`,
        sandbox: true,
        webviewTag: false,
      },
    })

    this.window = window
    this.hardenWindow(window, initialUrl)
    window.once('ready-to-show', () => {
      if (!window.isDestroyed()) window.show()
    })
    window.once('closed', () => {
      if (this.window === window) this.window = null
    })
    try {
      await window.loadURL(initialUrl)
    } catch (error) {
      if (this.window === window) this.window = null
      if (!window.isDestroyed()) {
        window.destroy()
      }
      throw error
    }
  }

  private hardenWindow(window: BrowserWindowLike, initialUrl: string): void {
    const deny = (event: { preventDefault(): void }) => {
      event.preventDefault()
    }

    window.webContents.session.setPermissionRequestHandler?.((_webContents, _permission, callback) => {
      callback(false)
    })
    window.webContents.session.setPermissionCheckHandler?.(() => false)
    window.webContents.session.on('will-download', deny)
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-attach-webview', deny)

    const blockOutsideOrigin = (event: { preventDefault(): void }, targetUrl: string) => {
      if (isAllowedOpenDesignNavigation(targetUrl, initialUrl)) return
      event.preventDefault()
    }

    window.webContents.on('will-navigate', blockOutsideOrigin)
    window.webContents.on('will-redirect', blockOutsideOrigin)
    if (this.isPackaged) {
      window.webContents.on('devtools-opened', () => {
        if (!window.webContents.isDestroyed()) {
          window.webContents.closeDevTools()
        }
      })
    }
  }
}
