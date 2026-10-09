import { beforeEach, describe, expect, it } from 'bun:test'
import {
  __resetClipboardShortcutForTests,
  syncClipboardShortcut,
  type ClipboardShortcutDeps,
  type ClipboardShortcutGlobalShortcut,
} from '../shortcut'

interface FakeShortcut extends ClipboardShortcutGlobalShortcut {
  registered: Map<string, () => void>
  registerCalls: string[]
  unregisterCalls: string[]
}

function fakeShortcut(onRegister?: (accelerator: string) => boolean | void): FakeShortcut {
  const registered = new Map<string, () => void>()
  const registerCalls: string[] = []
  const unregisterCalls: string[] = []
  return {
    registered,
    registerCalls,
    unregisterCalls,
    register(accelerator, callback) {
      registerCalls.push(accelerator)
      const outcome = onRegister?.(accelerator)
      if (outcome === false) return false
      registered.set(accelerator, callback)
      return true
    },
    unregister(accelerator) {
      unregisterCalls.push(accelerator)
      registered.delete(accelerator)
    },
    isRegistered: accelerator => registered.has(accelerator),
  }
}

function depsFor(globalShortcut: FakeShortcut, calls: string[] = []): ClipboardShortcutDeps {
  return { globalShortcut, openHistory: () => { calls.push('open') } }
}

describe('syncClipboardShortcut', () => {
  beforeEach(() => { __resetClipboardShortcutForTests() })

  it('registers exactly once when enabled and reports the accelerator', () => {
    const shortcut = fakeShortcut()
    const result = syncClipboardShortcut(
      { enabled: true, accelerator: 'CommandOrControl+Shift+V' },
      depsFor(shortcut),
    )
    expect(result).toEqual({ active: 'CommandOrControl+Shift+V' })
    expect(shortcut.registerCalls).toEqual(['CommandOrControl+Shift+V'])
    expect(shortcut.registered.has('CommandOrControl+Shift+V')).toBe(true)
  })

  it('unregisters the accelerator when disabled', () => {
    const shortcut = fakeShortcut()
    const deps = depsFor(shortcut)
    syncClipboardShortcut({ enabled: true, accelerator: 'CommandOrControl+Shift+V' }, deps)
    const result = syncClipboardShortcut({ enabled: false, accelerator: 'CommandOrControl+Shift+V' }, deps)
    expect(result).toEqual({ active: null })
    expect(shortcut.unregisterCalls).toEqual(['CommandOrControl+Shift+V'])
    expect(shortcut.registered.size).toBe(0)
  })

  it('re-registers once when the accelerator changes', () => {
    const shortcut = fakeShortcut()
    const deps = depsFor(shortcut)
    syncClipboardShortcut({ enabled: true, accelerator: 'CommandOrControl+Shift+V' }, deps)
    const result = syncClipboardShortcut({ enabled: true, accelerator: 'CommandOrControl+Shift+H' }, deps)
    expect(result).toEqual({ active: 'CommandOrControl+Shift+H' })
    expect(shortcut.unregisterCalls).toEqual(['CommandOrControl+Shift+V'])
    expect(shortcut.registerCalls).toEqual(['CommandOrControl+Shift+V', 'CommandOrControl+Shift+H'])
    expect(shortcut.registered.has('CommandOrControl+Shift+H')).toBe(true)
    expect(shortcut.registered.has('CommandOrControl+Shift+V')).toBe(false)
  })

  it('leaves no registration and reports active: null when register throws', () => {
    const shortcut = fakeShortcut(accelerator => {
      throw new Error(`invalid accelerator: ${accelerator}`)
    })
    const result = syncClipboardShortcut({ enabled: true, accelerator: 'Not+A+Shortcut' }, depsFor(shortcut))
    expect(result).toEqual({ active: null })
    expect(shortcut.registered.size).toBe(0)
    // A later valid sync must still succeed (no latched broken state).
    const valid = fakeShortcut()
    expect(syncClipboardShortcut({ enabled: true, accelerator: 'CommandOrControl+Shift+V' }, depsFor(valid)).active)
      .toBe('CommandOrControl+Shift+V')
  })

  it('invokes openHistory from the registered callback', () => {
    const shortcut = fakeShortcut()
    const calls: string[] = []
    syncClipboardShortcut({ enabled: true, accelerator: 'CommandOrControl+Shift+V' }, depsFor(shortcut, calls))
    shortcut.registered.get('CommandOrControl+Shift+V')!()
    expect(calls).toEqual(['open'])
  })

  it('does not double-register on a repeated sync with the same options', () => {
    const shortcut = fakeShortcut()
    const deps = depsFor(shortcut)
    syncClipboardShortcut({ enabled: true, accelerator: 'CommandOrControl+Shift+V' }, deps)
    syncClipboardShortcut({ enabled: true, accelerator: 'CommandOrControl+Shift+V' }, deps)
    expect(shortcut.registerCalls).toEqual(['CommandOrControl+Shift+V'])
    expect(shortcut.unregisterCalls).toEqual([])
  })

  it('reports active: null and registers nothing when enabled with a blank accelerator', () => {
    const shortcut = fakeShortcut()
    const result = syncClipboardShortcut({ enabled: true, accelerator: '   ' }, depsFor(shortcut))
    expect(result).toEqual({ active: null })
    expect(shortcut.registerCalls).toEqual([])
  })

  it('treats a register() false result as inactive without holding it', () => {
    const shortcut = fakeShortcut(() => false)
    const result = syncClipboardShortcut({ enabled: true, accelerator: 'CommandOrControl+Shift+V' }, depsFor(shortcut))
    expect(result).toEqual({ active: null })
    expect(shortcut.registered.size).toBe(0)
  })
})