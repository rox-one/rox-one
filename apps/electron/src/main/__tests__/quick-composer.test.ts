import { beforeEach, describe, expect, it, mock } from 'bun:test'

import type { BrowserWindow } from 'electron'
import { electronMockExports } from './electron-mock-exports'
import type { QuickComposerController as QuickComposerControllerT } from '../quick-composer'
import type { QuickComposerDeps } from '../quick-composer'

// The module under test imports `electron` at load time; mock before importing.
mock.module('electron', () => ({ ...electronMockExports }))

const { QuickComposerController } = await import('../quick-composer')

interface FakeWindow {
  webContents: { id: number }
  loaded: string[]
  shown: number
  focused: number
  destroyed: number
  vibrancy: string[]
  isDestroyed(): boolean
  isMinimized(): boolean
  restore(): void
  show(): void
  focus(): void
  destroy(): void
  once(event: string, listener: () => void): void
  loadURL(url: string): Promise<void>
  loadFile(path: string, options?: unknown): Promise<void>
  setVibrancy(value: string): void
  setVisualEffectState(): void
  setWindowButtonVisibility(): void
}

interface FakeWindowHandle {
  window: FakeWindow
  emit(event: string): void
}

interface QuickComposerHarness {
  deps: QuickComposerDeps
  created: FakeWindowHandle[]
  auxiliary: Array<{ webContentsId: number; workspaceId: string }>
  registered: Map<string, () => void>
  unregistered: string[]
  persisted(): string | null
}

function createFakeWindow(id: number): FakeWindowHandle {
  const listeners = new Map<string, Array<() => void>>()
  const window: FakeWindow = {
    webContents: { id },
    loaded: [],
    shown: 0,
    focused: 0,
    destroyed: 0,
    vibrancy: [],
    isDestroyed: () => false,
    isMinimized: () => false,
    restore: () => {},
    show: () => { window.shown += 1 },
    focus: () => { window.focused += 1 },
    destroy: () => { window.destroyed += 1 },
    once: (event, listener) => {
      const list = listeners.get(event) ?? []
      list.push(listener)
      listeners.set(event, list)
    },
    loadURL: async (url) => { window.loaded.push(url) },
    loadFile: async (path) => { window.loaded.push(path) },
    setVibrancy: (value) => { window.vibrancy.push(value) },
    setVisualEffectState: () => {},
    setWindowButtonVisibility: () => {},
  }
  return {
    window,
    emit: (event) => { for (const listener of listeners.get(event) ?? []) listener() },
  }
}

function createHarness(overrides: Partial<QuickComposerDeps> = {}): QuickComposerHarness {
  const registered = new Map<string, () => void>()
  const unregistered: string[] = []
  const auxiliary: Array<{ webContentsId: number; workspaceId: string }> = []
  const created: FakeWindowHandle[] = []
  let persistedShortcut: string | null = 'Alt+Space'

  const deps = {
    createWindow: () => {
      const handle = createFakeWindow(100 + created.length)
      created.push(handle)
      // The fake implements only the BrowserWindow members the controller touches.
      return handle.window as unknown as BrowserWindow
    },
    registerAuxiliaryWindow: (win: FakeWindow, workspaceId: string) => {
      auxiliary.push({ webContentsId: win.webContents.id, workspaceId })
    },
    shortcuts: {
      register: (accelerator: string, callback: () => void) => {
        if (registered.has(accelerator)) return false
        registered.set(accelerator, callback)
        return true
      },
      unregister: (accelerator: string) => {
        unregistered.push(accelerator)
        registered.delete(accelerator)
      },
    },
    readShortcut: () => persistedShortcut,
    writeShortcut: (accelerator: string | null) => { persistedShortcut = accelerator },
    resolveWorkspaceId: () => 'workspace-1',
    isMac: true,
    prefersSolid: () => false,
    ...overrides,
  } as unknown as QuickComposerDeps

  return { deps, created, auxiliary, registered, unregistered, persisted: () => persistedShortcut }
}

describe('QuickComposerController', () => {
  let harness: QuickComposerHarness
  let controller: QuickComposerControllerT

  beforeEach(() => {
    harness = createHarness()
    controller = new QuickComposerController(harness.deps)
  })

  it('creates the composer bound to a workspace and reveals it after paint', () => {
    const result = controller.open('workspace-2')
    expect(result).toEqual({ ok: true })
    expect(harness.auxiliary).toEqual([{ webContentsId: 100, workspaceId: 'workspace-2' }])
    expect(harness.created[0].window.loaded).toHaveLength(1)
    harness.created[0].emit('ready-to-show')
    expect(harness.created[0].window.shown).toBe(1)
    expect(harness.created[0].window.focused).toBe(1)
    expect(harness.created[0].window.vibrancy).toEqual(['hud'])
  })

  it('falls back to the resolved workspace and refuses when none is available', () => {
    expect(controller.open(null)).toEqual({ ok: true })
    expect(harness.auxiliary[0].workspaceId).toBe('workspace-1')

    const noWorkspace = createHarness({ resolveWorkspaceId: () => null })
    expect(new QuickComposerController(noWorkspace.deps).open(null)).toEqual({ ok: false, error: 'NO_WORKSPACE' })
  })

  it('re-focuses an open composer instead of creating a second window', () => {
    controller.open('workspace-1')
    const second = controller.open('workspace-1')
    expect(second).toEqual({ ok: true })
    expect(harness.created).toHaveLength(1)
    expect(harness.created[0].window.focused).toBe(1)
  })

  it('destroys the window on close and clears the reference on closed', () => {
    controller.open('workspace-1')
    expect(controller.close()).toEqual({ ok: true })
    expect(harness.created[0].window.destroyed).toBe(1)
    harness.created[0].emit('closed')
    expect(controller.isOpen()).toBe(false)
  })

  it('applies the persisted accelerator idempotently', () => {
    controller.syncShortcut()
    expect([...harness.registered.keys()]).toEqual(['Alt+Space'])
    controller.syncShortcut()
    expect(harness.unregistered).toEqual([])
    expect([...harness.registered.keys()]).toEqual(['Alt+Space'])
  })

  it('persists a new accelerator and keeps the old one on conflict', () => {
    controller.syncShortcut()
    // Pre-register the desired accelerator elsewhere → setShortcut must fail.
    harness.deps.shortcuts.register('Cmd+K', () => {})

    const result = controller.setShortcut('Cmd+K')
    expect(result).toEqual({ ok: false, accelerator: 'Alt+Space', error: 'SHORTCUT_UNAVAILABLE' })
    expect([...harness.registered.keys()]).toEqual(['Cmd+K', 'Alt+Space'])
    expect(harness.persisted()).toBe('Alt+Space')
  })

  it('registers and persists a free accelerator', () => {
    const result = controller.setShortcut('Cmd+Shift+Space')
    expect(result).toEqual({ ok: true, accelerator: 'Cmd+Shift+Space' })
    expect([...harness.registered.keys()]).toEqual(['Cmd+Shift+Space'])
    expect(harness.persisted()).toBe('Cmd+Shift+Space')
  })

  it('disabling persists null and unregisters', () => {
    controller.syncShortcut()
    expect(controller.setShortcut(null)).toEqual({ ok: true, accelerator: null })
    expect(harness.registered.size).toBe(0)
    expect(harness.persisted()).toBeNull()
  })
})