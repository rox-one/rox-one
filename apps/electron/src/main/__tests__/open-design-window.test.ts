import { describe, expect, it, mock } from 'bun:test'
import type { BrowserWindowConstructorOptions } from 'electron'

mock.module('electron', () => ({
  app: { isPackaged: false },
  BrowserWindow: class {},
}))

const {
  OpenDesignWindowController,
  isAllowedOpenDesignNavigation,
  validateOpenDesignInitialUrl,
} = await import('../open-design-window')

describe('Open Design loopback URL policy', () => {
  it('accepts only canonical loopback http URLs with explicit ports', () => {
    expect(validateOpenDesignInitialUrl('http://127.0.0.1:3000/')).toBe('http://127.0.0.1:3000/')
    expect(validateOpenDesignInitialUrl('http://[::1]:3000/')).toBe('http://[::1]:3000/')

    for (const url of [
      'https://127.0.0.1:3000/',
      'http://localhost:3000/',
      'http://127.1:3000/',
      'http://2130706433:3000/',
      'http://0x7f000001:3000/',
      'http://user:pass@127.0.0.1:3000/',
      'http://127.0.0.1/',
      'http://127.0.0.1:3000/dashboard',
      'http://127.0.0.1:3000/?token=x',
      'http://127.0.0.1:3000/#/x',
    ]) {
      expect(() => validateOpenDesignInitialUrl(url), url).toThrow()
    }
  })

  it('allows subsequent navigation only inside the exact initial origin', () => {
    const initial = 'http://127.0.0.1:3000/'
    expect(isAllowedOpenDesignNavigation('http://127.0.0.1:3000/projects/1', initial)).toBe(true)
    expect(isAllowedOpenDesignNavigation('http://127.0.0.1:3001/projects/1', initial)).toBe(false)
    expect(isAllowedOpenDesignNavigation('http://localhost:3000/projects/1', initial)).toBe(false)
    expect(isAllowedOpenDesignNavigation('https://127.0.0.1:3000/projects/1', initial)).toBe(false)
    expect(isAllowedOpenDesignNavigation('file:///tmp/index.html', initial)).toBe(false)
  })
})

type PreventableEvent = { prevented: boolean; preventDefault(): void }

function event(): PreventableEvent {
  return {
    prevented: false,
    preventDefault() {
      this.prevented = true
    },
  }
}

class FakeWebContents {
  readonly events = new Map<string, Function[]>()
  readonly session = {
    events: new Map<string, Function[]>(),
    permissionCheckHandler: null as null | (() => boolean),
    permissionRequestHandler: null as null | ((wc: unknown, permission: string, callback: (allowed: boolean) => void) => void),
    on: (name: string, handler: Function) => {
      const list = this.session.events.get(name) ?? []
      list.push(handler)
      this.session.events.set(name, list)
    },
    setPermissionCheckHandler: (handler: () => boolean) => {
      this.session.permissionCheckHandler = handler
    },
    setPermissionRequestHandler: (handler: (wc: unknown, permission: string, callback: (allowed: boolean) => void) => void) => {
      this.session.permissionRequestHandler = handler
    },
  }
  closeDevToolsCalls = 0
  windowOpenHandler: null | (() => unknown) = null

  closeDevTools() {
    this.closeDevToolsCalls += 1
  }

  isDestroyed() {
    return false
  }

  on(name: string, handler: Function) {
    const list = this.events.get(name) ?? []
    list.push(handler)
    this.events.set(name, list)
  }

  setWindowOpenHandler(handler: () => unknown) {
    this.windowOpenHandler = handler
  }

  emit(name: string, ...args: unknown[]) {
    for (const handler of this.events.get(name) ?? []) {
      handler(...args)
    }
  }
}

class FakeWindow {
  readonly webContents = new FakeWebContents()
  readonly events = new Map<string, Function[]>()
  destroyed = false
  focused = false
  loadError: Error | null = null
  loadedUrl: string | null = null
  shown = false

  destroy() {
    this.destroyed = true
  }

  focus() {
    this.focused = true
  }

  isDestroyed() {
    return this.destroyed
  }

  async loadURL(url: string) {
    this.loadedUrl = url
    if (this.loadError) throw this.loadError
  }

  once(name: string, handler: Function) {
    const list = this.events.get(name) ?? []
    list.push(handler)
    this.events.set(name, list)
  }

  show() {
    this.shown = true
  }
}

describe('Open Design isolated BrowserWindow policy', () => {
  it('creates a dedicated in-memory sandboxed window and installs deny policies', async () => {
    const options: BrowserWindowConstructorOptions[] = []
    const fake = new FakeWindow()
    const controller = new OpenDesignWindowController({
      createBrowserWindow: (input) => {
        options.push(input)
        return fake as never
      },
      isPackaged: true,
    })

    await controller.open('http://127.0.0.1:4000/')

    const capturedOptions = options[0]!
    expect(fake.loadedUrl).toBe('http://127.0.0.1:4000/')
    expect(capturedOptions.webPreferences?.preload).toBeUndefined()
    expect(capturedOptions.webPreferences?.contextIsolation).toBe(true)
    expect(capturedOptions.webPreferences?.nodeIntegration).toBe(false)
    expect(capturedOptions.webPreferences?.sandbox).toBe(true)
    expect(capturedOptions.webPreferences?.webviewTag).toBe(false)
    expect(capturedOptions.webPreferences?.devTools).toBe(false)
    expect(String(capturedOptions.webPreferences?.partition)).toStartWith('open-design:')
    expect(String(capturedOptions.webPreferences?.partition)).not.toStartWith('persist:')

    let permissionAllowed: boolean | null = null
    fake.webContents.session.permissionRequestHandler?.({}, 'media', (allowed) => { permissionAllowed = allowed })
    expect(permissionAllowed as boolean | null).toBe(false)
    expect(fake.webContents.session.permissionCheckHandler?.()).toBe(false)

    const download = event()
    fake.webContents.session.events.get('will-download')?.[0]?.(download)
    expect(download.prevented).toBe(true)
    expect(fake.webContents.windowOpenHandler?.()).toEqual({ action: 'deny' })

    const sameOrigin = event()
    fake.webContents.emit('will-navigate', sameOrigin, 'http://127.0.0.1:4000/projects')
    expect(sameOrigin.prevented).toBe(false)
    const otherOrigin = event()
    fake.webContents.emit('will-navigate', otherOrigin, 'http://127.0.0.1:4001/projects')
    expect(otherOrigin.prevented).toBe(true)
    const redirect = event()
    fake.webContents.emit('will-redirect', redirect, 'https://127.0.0.1:4000/')
    expect(redirect.prevented).toBe(true)
    const webview = event()
    fake.webContents.emit('will-attach-webview', webview)
    expect(webview.prevented).toBe(true)

    fake.webContents.emit('devtools-opened')
    expect(fake.webContents.closeDevToolsCalls).toBe(1)
  })

  it('focuses an existing window instead of creating another one', async () => {
    const fake = new FakeWindow()
    let created = 0
    const controller = new OpenDesignWindowController({
      createBrowserWindow: () => {
        created += 1
        return fake as never
      },
      isPackaged: false,
    })

    await controller.open('http://127.0.0.1:4000/')
    await controller.open('http://127.0.0.1:4000/')

    expect(created).toBe(1)
    expect(fake.focused).toBe(true)
  })

  it('destroys and clears a failed loadURL window before retrying', async () => {
    const first = new FakeWindow()
    first.loadError = new Error('load failed')
    const second = new FakeWindow()
    const windows = [first, second]
    const controller = new OpenDesignWindowController({
      createBrowserWindow: () => windows.shift()! as never,
      isPackaged: false,
    })

    await expect(controller.open('http://127.0.0.1:4000/')).rejects.toThrow('load failed')
    expect(first.loadedUrl).toBe('http://127.0.0.1:4000/')
    expect(first.destroyed).toBe(true)
    expect(controller.hasWindow()).toBe(false)

    await controller.open('http://127.0.0.1:4000/')
    expect(second.loadedUrl).toBe('http://127.0.0.1:4000/')
    expect(second.destroyed).toBe(false)
    expect(controller.hasWindow()).toBe(true)
  })
})
