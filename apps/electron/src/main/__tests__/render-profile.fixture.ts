import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mock } from 'bun:test'

// PERF-07 (#1566): main resolves the low-power profile from the GPU status,
// the hardware and the persisted preference, ships it in the shell snapshot,
// and a low-power window gets no native vibrancy/Mica.
let gpuCompositing: string | undefined = 'enabled'
let ready = true
let preference: string = 'auto'
let throwStatus = false
let totalmem: number | undefined = 16 * 1024 ** 3
let cpuCount: number | undefined = 8

const electronApp = Object.assign(new EventEmitter(), {
  isReady: () => ready,
  getGPUFeatureStatus: () => {
    if (throwStatus) throw new Error('GPU info unavailable')
    return gpuCompositing === undefined ? {} : { gpu_compositing: gpuCompositing }
  },
})

const windows = new Set<FakeWindow>()
class FakeWindow extends EventEmitter {
  webContents = new EventEmitter()
  visible = false
  vibrancy: string | null = null
  backgroundMaterial = 'none'
  backgroundColor = '#f4f4f5'
  static getAllWindows() { return [...windows] }
  constructor() { super(); windows.add(this) }
  isDestroyed() { return false }
  isVisible() { return this.visible }
  show() { this.visible = true }
  setVibrancy(value: string | null) { this.vibrancy = value }
  setBackgroundMaterial(value: string) { this.backgroundMaterial = value }
  setBackgroundColor(value: string) { this.backgroundColor = value }
}

mock.module('electron', () => ({
  app: electronApp,
  BrowserWindow: FakeWindow,
  nativeTheme: { shouldUseHighContrastColors: false, shouldUseDarkColors: false, prefersReducedTransparency: false },
  systemPreferences: { getUserDefault: () => false },
}))
mock.module('os', () => ({
  release: () => '10.0.22621',
  totalmem: () => {
    if (totalmem === undefined) throw new Error('unavailable')
    return totalmem
  },
  cpus: () => (cpuCount === undefined ? undefined : Array.from({ length: cpuCount }, () => ({}))),
}))
mock.module('@rox/shared/config', () => ({
  isZenShellEnabled: () => true,
  getZenShellMaterialPreference: () => 'system',
  getRenderProfilePreference: () => preference,
}))
mock.module('../logger', () => ({ windowLog: { warn() {} } }))

const { peekRenderProfile, queryGpuSoftwareCompositing, queryHardwareInfo, resetHardwareInfoCacheForTests } = await import('../render-profile')
const material = await import('../shell-material')
type Window = Parameters<typeof material.attachZenWindowPolicy>[0]
const asWindow = (window: FakeWindow) => window as unknown as Window
const platform = (value: string) => Object.defineProperty(process, 'platform', { configurable: true, value })
let scenarios = 0

// 1. Windows defaults on; macOS defaults off with a healthy GPU and hardware.
assert.deepEqual(peekRenderProfile('win32'), { profile: 'performance', preference: 'auto', reason: 'windows' })
assert.deepEqual(peekRenderProfile('darwin'), { profile: 'standard', preference: 'auto', reason: 'default' })
scenarios++

// 2. Software / blocklisted compositing turns it on everywhere.
gpuCompositing = 'disabled_software'
assert.equal(queryGpuSoftwareCompositing(), true)
assert.deepEqual(peekRenderProfile('darwin'), { profile: 'performance', preference: 'auto', reason: 'software-compositing' })
gpuCompositing = 'unavailable_off'
assert.equal(peekRenderProfile('linux').profile, 'performance')
gpuCompositing = 'enabled'
scenarios++

// 3. Weak hardware (< 7.5 GiB RAM or <= 4 logical cores) turns it on on auto;
//    unknown values are not weak. The probe is memoized per process.
const hardware = (mem: number | undefined, cpus: number | undefined) => {
  totalmem = mem
  cpuCount = cpus
  resetHardwareInfoCacheForTests()
}
hardware(7.5 * 1024 ** 3 - 1, 8)
assert.deepEqual(peekRenderProfile('darwin'), { profile: 'performance', preference: 'auto', reason: 'weak-hardware' })
// A nominal 8 GB machine reporting usable memory (~7.7 GiB) is not weak.
hardware(7.7 * 1024 ** 3, 8)
assert.equal(peekRenderProfile('darwin').profile, 'standard')
hardware(16 * 1024 ** 3, 4)
assert.equal(peekRenderProfile('darwin').reason, 'weak-hardware')
hardware(16 * 1024 ** 3, 5)
assert.equal(peekRenderProfile('darwin').profile, 'standard')
hardware(undefined, undefined)
assert.deepEqual(queryHardwareInfo(), {})
assert.equal(peekRenderProfile('darwin').profile, 'standard')
hardware(16 * 1024 ** 3, 8)
assert.deepEqual(queryHardwareInfo(), { totalMemoryBytes: 16 * 1024 ** 3, logicalCpuCount: 8 })
// Memoized: later os changes are not re-probed until reset.
totalmem = 2 * 1024 ** 3
assert.deepEqual(queryHardwareInfo(), { totalMemoryBytes: 16 * 1024 ** 3, logicalCpuCount: 8 })
assert.equal(peekRenderProfile('darwin').profile, 'standard')
hardware(16 * 1024 ** 3, 8)
scenarios++

// 4. Explicit preference wins over platform, GPU and hardware.
preference = 'standard'
gpuCompositing = 'disabled_software'
hardware(16 * 1024 ** 3, 2)
assert.deepEqual(peekRenderProfile('win32'), { profile: 'standard', preference: 'standard', reason: 'user-standard' })
preference = 'performance'
gpuCompositing = 'enabled'
hardware(16 * 1024 ** 3, 8)
assert.deepEqual(peekRenderProfile('darwin'), { profile: 'performance', preference: 'performance', reason: 'user-performance' })
scenarios++

// 5. Unknown GPU status (not ready, missing field, throwing API) is not weak;
//    a garbage persisted value falls back to auto.
preference = 'turbo'
ready = false
gpuCompositing = 'disabled_software'
assert.equal(queryGpuSoftwareCompositing(), false)
assert.deepEqual(peekRenderProfile('darwin'), { profile: 'standard', preference: 'auto', reason: 'default' })
ready = true
gpuCompositing = undefined
assert.equal(queryGpuSoftwareCompositing(), false)
throwStatus = true
assert.equal(queryGpuSoftwareCompositing(), false)
throwStatus = false
scenarios++

// 6. The shell snapshot carries the profile and the profile feeds material
//    resolution: low-power resolves to solid; standard keeps native glass.
preference = 'auto'
gpuCompositing = 'enabled'
platform('win32')
let snapshot = material.peekZenShellSnapshot()
assert.equal(snapshot.renderProfile, 'performance')
assert.equal(snapshot.renderProfileReason, 'windows')
assert.equal(snapshot.material, 'solid')
assert.equal(snapshot.fallbackReason, 'low-power')
preference = 'standard'
snapshot = material.peekZenShellSnapshot()
assert.equal(snapshot.renderProfile, 'standard')
assert.equal(snapshot.material, 'mica')
preference = 'auto'
platform('darwin')
snapshot = material.peekZenShellSnapshot()
assert.equal(snapshot.renderProfile, 'standard')
assert.equal(snapshot.material, 'vibrancy')
assert.equal(snapshot.fallbackReason, undefined)
gpuCompositing = 'disabled_software'
assert.equal(material.peekZenShellSnapshot().material, 'solid')
assert.equal(material.peekZenShellSnapshotForWindow(null).renderProfile, 'performance')
gpuCompositing = 'enabled'
scenarios++

// 7. Zen window: Windows auto (low-power) never gets Mica and keeps the opaque
//    fill; switching the toggle off applies Mica, switching it on clears it.
platform('win32')
const win = new FakeWindow()
material.attachZenWindowPolicy(asWindow(win))
win.emit('ready-to-show')
assert.equal(win.visible, true)
assert.equal(win.backgroundMaterial, 'none')
assert.equal(win.backgroundColor, '#f4f4f5')
assert.equal(material.peekZenShellSnapshotForWindow(asWindow(win)).material, 'solid')
preference = 'standard'
material.reapplyZenShellOnWindow(asWindow(win))
assert.equal(win.backgroundMaterial, 'mica')
assert.equal(win.backgroundColor, '#00000000')
preference = 'performance'
material.reapplyZenShellOnWindow(asWindow(win))
assert.equal(win.backgroundMaterial, 'none')
assert.equal(win.backgroundColor, '#f4f4f5')
scenarios++

// 8. Legacy (Zen off) path: low-power also means no vibrancy/Mica.
platform('darwin')
preference = 'performance'
assert.equal(material.nativeAccessibilityPrefersSolid(), true)
const legacy = new FakeWindow()
legacy.vibrancy = 'under-window'
material.applyLegacyMaterial(asWindow(legacy))
assert.equal(legacy.vibrancy, null)
assert.equal(legacy.backgroundColor, '#f4f4f5')
preference = 'auto'
assert.equal(material.nativeAccessibilityPrefersSolid(), false)
material.applyLegacyMaterial(asWindow(legacy))
assert.equal(legacy.vibrancy, 'under-window')
scenarios++

process.stdout.write(JSON.stringify({ passed: true, scenarios }))
