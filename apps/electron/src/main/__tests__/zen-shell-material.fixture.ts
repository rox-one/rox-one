import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mock } from 'bun:test'

const nativeTheme = { shouldUseHighContrastColors: false, shouldUseDarkColors: false, prefersReducedTransparency: false }
const electronApp = new EventEmitter()
let zenEnabled = true
let macReduceTransparency = false
let build = '10.0.22621'
const windows = new Set<FakeWindow>()

class FakeWindow extends EventEmitter {
  webContents = new EventEmitter()
  visible = false
  destroyed = false
  vibrancy: string | null = null
  backgroundMaterial = 'none'
  backgroundColor = '#f4f4f5'
  failNative = false
  showCount = 0
  static getAllWindows() { return [...windows] }
  constructor() { super(); windows.add(this) }
  isDestroyed() { return this.destroyed }
  isVisible() { return this.visible }
  show() { this.visible = true; this.showCount++ }
  setVibrancy(value: string | null) {
    if (this.failNative && value !== null) throw new Error('Native API refused')
    this.vibrancy = value
  }
  setBackgroundMaterial(value: string) {
    if (this.failNative && value !== 'none') throw new Error('Native API refused')
    this.backgroundMaterial = value
  }
  setBackgroundColor(value: string) { this.backgroundColor = value }
  close() { this.destroyed = true; this.emit('closed'); windows.delete(this) }
}

mock.module('electron', () => ({
  app: electronApp, BrowserWindow: FakeWindow, nativeTheme,
  systemPreferences: { getUserDefault: () => macReduceTransparency },
}))
mock.module('os', () => ({ release: () => build }))
mock.module('@rox/shared/config', () => ({ isZenShellEnabled: () => zenEnabled, getZenShellMaterialPreference: () => 'system' }))
mock.module('../logger', () => ({ windowLog: { warn() {} } }))

const policy = await import('../shell-material')
type Window = Parameters<typeof policy.attachZenWindowPolicy>[0]
const asWindow = (window: FakeWindow) => window as unknown as Window
const platform = (value: string) => Object.defineProperty(process, 'platform', { configurable: true, value })

platform('darwin')
const first = new FakeWindow()
const updates: string[] = []
policy.setZenShellSnapshotListener(asWindow(first), value => updates.push(`${value.material}:${value.fallbackReason ?? ''}`))
policy.attachZenWindowPolicy(asWindow(first))
assert.equal(policy.peekZenShellSnapshotForWindow(asWindow(first)).fallbackReason, 'no-healthy-paint')
first.webContents.emit('did-finish-load')
assert.equal(first.showCount, 1)
assert.equal(first.vibrancy, null)
first.emit('ready-to-show')
assert.equal(first.showCount, 1)
assert.equal(first.vibrancy, 'under-window')
assert.equal(first.backgroundColor, '#00000000')
assert.equal(policy.peekZenShellSnapshotForWindow(asWindow(first)).material, 'vibrancy')
assert.deepEqual(updates, ['solid:no-healthy-paint', 'vibrancy:'])

const second = new FakeWindow()
policy.attachZenWindowPolicy(asWindow(second))
second.emit('ready-to-show')
assert.equal(electronApp.listenerCount('child-process-gone'), 1)
electronApp.emit('child-process-gone', {}, { type: 'Utility' })
assert.equal(first.vibrancy, 'under-window')
electronApp.emit('child-process-gone', {}, { type: 'GPU' })
for (const window of [first, second]) {
  assert.equal(window.vibrancy, null)
  assert.equal(window.backgroundColor, '#f4f4f5')
  assert.equal(policy.peekZenShellSnapshotForWindow(asWindow(window)).fallbackReason, 'gpu-failure')
  policy.reapplyZenShellOnWindow(asWindow(window))
  assert.equal(window.vibrancy, null)
}
assert.equal(updates.at(-1), 'solid:gpu-failure')
first.close(); second.close()
assert.equal(electronApp.listenerCount('child-process-gone'), 0)

const denied = new FakeWindow()
denied.failNative = true
policy.attachZenWindowPolicy(asWindow(denied)); denied.emit('ready-to-show')
assert.equal(policy.peekZenShellSnapshotForWindow(asWindow(denied)).fallbackReason, 'material-unavailable')
assert.equal(denied.vibrancy, null)
denied.failNative = false
policy.reapplyZenShellOnWindow(asWindow(denied))
assert.equal(denied.vibrancy, 'under-window')
nativeTheme.prefersReducedTransparency = true
policy.reapplyZenShellOnWindow(asWindow(denied))
assert.equal(policy.peekZenShellSnapshotForWindow(asWindow(denied)).fallbackReason, 'reduce-transparency')
assert.equal(denied.vibrancy, null)
zenEnabled = false
policy.reapplyZenShellOnWindow(asWindow(denied))
assert.equal(denied.vibrancy, null)
nativeTheme.prefersReducedTransparency = false
macReduceTransparency = true
assert.equal(policy.nativeAccessibilityPrefersSolid(), true)
macReduceTransparency = false
nativeTheme.shouldUseHighContrastColors = true
assert.equal(policy.nativeAccessibilityPrefersSolid(), true)
nativeTheme.shouldUseHighContrastColors = false
denied.close()

const live = new FakeWindow()
live.visible = true
const liveUpdates: string[] = []
policy.setZenShellSnapshotListener(asWindow(live), value => liveUpdates.push(value.material))
zenEnabled = true
policy.reapplyZenShellOnWindow(asWindow(live))
assert.equal(live.vibrancy, 'under-window')
electronApp.emit('child-process-gone', {}, { type: 'GPU' })
assert.equal(liveUpdates.at(-1), 'solid')
live.close()

platform('win32')
build = '10.0.22620'
const oldWindows = new FakeWindow()
policy.attachZenWindowPolicy(asWindow(oldWindows)); oldWindows.emit('ready-to-show')
assert.equal(oldWindows.backgroundMaterial, 'none')
oldWindows.close()
build = '10.0.22621'
const mica = new FakeWindow()
policy.attachZenWindowPolicy(asWindow(mica)); mica.emit('ready-to-show')
assert.equal(mica.backgroundMaterial, 'mica')
nativeTheme.shouldUseHighContrastColors = true
policy.reapplyZenShellOnWindow(asWindow(mica))
assert.equal(mica.backgroundMaterial, 'none')
assert.equal(policy.peekZenShellSnapshotForWindow(asWindow(mica)).fallbackReason, 'high-contrast')
nativeTheme.shouldUseHighContrastColors = false
zenEnabled = false
policy.reapplyZenShellOnWindow(asWindow(mica))
assert.equal(mica.backgroundMaterial, 'mica')
mica.close()
assert.equal(electronApp.listenerCount('child-process-gone'), 0)

process.stdout.write(JSON.stringify({ passed: true, scenarios: 8, nativeHardware: false }) + '\n')
