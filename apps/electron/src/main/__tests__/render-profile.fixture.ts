import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mock } from 'bun:test'

// PERF-07 (#1566): main resolves the low-power profile from the GPU status
// and the persisted preference, and ships it in the shell snapshot.
let gpuCompositing: string | undefined = 'enabled'
let ready = true
let preference: string = 'auto'
let throwStatus = false

const electronApp = Object.assign(new EventEmitter(), {
  isReady: () => ready,
  getGPUFeatureStatus: () => {
    if (throwStatus) throw new Error('GPU info unavailable')
    return gpuCompositing === undefined ? {} : { gpu_compositing: gpuCompositing }
  },
})

class FakeWindow extends EventEmitter {
  webContents = new EventEmitter()
  static getAllWindows() { return [] }
  isDestroyed() { return false }
  isVisible() { return false }
}

mock.module('electron', () => ({
  app: electronApp,
  BrowserWindow: FakeWindow,
  nativeTheme: { shouldUseHighContrastColors: false, shouldUseDarkColors: false, prefersReducedTransparency: false },
  systemPreferences: { getUserDefault: () => false },
}))
mock.module('os', () => ({ release: () => '10.0.22621' }))
mock.module('@rox/shared/config', () => ({
  isZenShellEnabled: () => true,
  getZenShellMaterialPreference: () => 'system',
  getRenderProfilePreference: () => preference,
}))
mock.module('../logger', () => ({ windowLog: { warn() {} } }))

const { peekRenderProfile, queryGpuSoftwareCompositing } = await import('../render-profile')
const material = await import('../shell-material')
const platform = (value: string) => Object.defineProperty(process, 'platform', { configurable: true, value })
let scenarios = 0

// 1. Windows defaults on; macOS defaults off with a healthy GPU.
assert.deepEqual(peekRenderProfile('win32'), { profile: 'performance', preference: 'auto', reason: 'windows' })
assert.deepEqual(peekRenderProfile('darwin'), { profile: 'standard', preference: 'auto', reason: 'default' })
scenarios++

// 2. Software / blocklisted compositing turns it on everywhere.
gpuCompositing = 'disabled_software'
assert.equal(queryGpuSoftwareCompositing(), true)
assert.deepEqual(peekRenderProfile('darwin'), { profile: 'performance', preference: 'auto', reason: 'software-compositing' })
gpuCompositing = 'unavailable_off'
assert.equal(peekRenderProfile('linux').profile, 'performance')
scenarios++

// 3. Explicit preference wins over platform and GPU.
preference = 'standard'
assert.deepEqual(peekRenderProfile('win32'), { profile: 'standard', preference: 'standard', reason: 'user-standard' })
preference = 'performance'
gpuCompositing = 'enabled'
assert.deepEqual(peekRenderProfile('darwin'), { profile: 'performance', preference: 'performance', reason: 'user-performance' })
scenarios++

// 4. Unknown GPU status (not ready, missing field, throwing API) is not weak;
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

// 5. The shell snapshot (the existing shell-material path) carries the profile.
preference = 'auto'
gpuCompositing = 'enabled'
platform('win32')
let snapshot = material.peekZenShellSnapshot()
assert.equal(snapshot.renderProfile, 'performance')
assert.equal(snapshot.renderProfileReason, 'windows')
assert.equal(snapshot.material, 'mica')
platform('darwin')
snapshot = material.peekZenShellSnapshot()
assert.equal(snapshot.renderProfile, 'standard')
assert.equal(snapshot.material, 'vibrancy')
gpuCompositing = 'disabled_software'
assert.equal(material.peekZenShellSnapshotForWindow(null).renderProfile, 'performance')
scenarios++

process.stdout.write(JSON.stringify({ passed: true, scenarios }))
