/**
 * Zen Shell window material application (ZS-01).
 *
 * OFF (`shell.zen.v1` false) never calls this path — WindowManager keeps the
 * existing revealWindow / acrylic-or-mica constructor policy.
 * ON: show once, apply vibrancy/mica only after a healthy paint.
 */

import { BrowserWindow, nativeTheme, systemPreferences } from 'electron'
import { release } from 'os'
import { isZenShellEnabled, getZenShellMaterialPreference } from '@craft-agent/shared/config'
import {
  snapshotZenShell,
  type ResolvedShellMaterial,
  type ShellPlatform,
  type ZenShellSnapshot,
} from '../shared/shell-appearance'
import { initialZenWindowState, reduceZenWindow, type ZenWindowState } from '../shared/shell-window-lifecycle'
import { windowLog } from './logger'

const attached = new WeakMap<BrowserWindow, { state: ZenWindowState }>()

function currentPlatform(): ShellPlatform {
  if (process.platform === 'darwin' || process.platform === 'win32' || process.platform === 'linux') {
    return process.platform
  }
  return 'linux'
}

function windowsBuild(): number | undefined {
  if (process.platform !== 'win32') return undefined
  return parseInt(release().split('.')[2] || '0', 10)
}

function queryReduceTransparency(): boolean {
  if (process.platform === 'darwin') {
    try {
      return systemPreferences.getUserDefault('AppleReduceTransparency', 'boolean') === true
    } catch {
      // fall through
    }
  }
  return Boolean((nativeTheme as { prefersReducedTransparency?: boolean }).prefersReducedTransparency)
}

function queryHighContrast(): boolean {
  return nativeTheme.shouldUseHighContrastColors === true
}

export function peekZenShellSnapshot(opts?: {
  paintHealthy?: boolean
  windowDestroyed?: boolean
  gpuFailed?: boolean
}): ZenShellSnapshot {
  return snapshotZenShell({
    zenEnabled: isZenShellEnabled(),
    preference: getZenShellMaterialPreference(),
    platform: currentPlatform(),
    windowsBuild: windowsBuild(),
    reduceTransparency: queryReduceTransparency(),
    highContrast: queryHighContrast(),
    paintHealthy: opts?.paintHealthy ?? true,
    windowDestroyed: opts?.windowDestroyed ?? false,
    gpuFailed: opts?.gpuFailed ?? false,
  })
}

function clearNativeMaterial(window: BrowserWindow): void {
  if (window.isDestroyed()) return
  try {
    if (process.platform === 'darwin') {
      window.setVibrancy(null)
    } else if (process.platform === 'win32' && typeof window.setBackgroundMaterial === 'function') {
      window.setBackgroundMaterial('none')
    }
  } catch (error) {
    windowLog.warn('Failed to clear Zen Shell material:', error)
  }
}

function applyNativeMaterial(window: BrowserWindow, material: ResolvedShellMaterial): void {
  if (window.isDestroyed()) return
  try {
    if (material === 'vibrancy' && process.platform === 'darwin') {
      window.setVibrancy('under-window')
      ;(window as unknown as { setVisualEffectState?: (state: string) => void })
        .setVisualEffectState?.('active')
      return
    }
    if (material === 'mica' && process.platform === 'win32' && typeof window.setBackgroundMaterial === 'function') {
      window.setBackgroundMaterial('mica')
      return
    }
    clearNativeMaterial(window)
  } catch (error) {
    windowLog.warn('Failed to apply Zen Shell material:', error)
    clearNativeMaterial(window)
  }
}

function dispatch(window: BrowserWindow, record: { state: ZenWindowState }, event: Parameters<typeof reduceZenWindow>[1]): void {
  record.state = reduceZenWindow(record.state, event)
  if (record.state.clearMaterial) {
    clearNativeMaterial(window)
  }
  if (!window.isDestroyed() && record.state.shown && !window.isVisible()) {
    window.show()
  }
  if (record.state.applyMaterial && !window.isDestroyed()) {
    const snap = peekZenShellSnapshot({
      paintHealthy: record.state.paintGeneration === record.state.generation,
      windowDestroyed: window.isDestroyed(),
    })
    applyNativeMaterial(window, snap.material)
  }
}

/**
 * Attach Zen first-paint + material policy. Call only when `shell.zen.v1` is ON
 * at window creation (or after a live enable). The legacy `revealWindow`
 * `isVisible()` early-return stays on the OFF path.
 */
export function attachZenWindowPolicy(window: BrowserWindow): void {
  if (attached.has(window)) return
  const record = { state: initialZenWindowState() }
  // Live enable on an already-visible window: treat current frame as healthy paint.
  if (!window.isDestroyed() && window.isVisible()) {
    record.state = {
      ...record.state,
      shown: true,
      paintGeneration: record.state.generation,
    }
  }
  attached.set(window, record)

  window.once('ready-to-show', () => {
    if (window.isDestroyed()) return
    dispatch(window, record, { type: 'ready-to-show' })
  })
  window.webContents.once('did-finish-load', () => {
    if (window.isDestroyed()) return
    dispatch(window, record, { type: 'did-finish-load' })
  })
  setTimeout(() => {
    if (window.isDestroyed()) return
    dispatch(window, record, { type: 'timeout' })
  }, 4000)

  const onGpuCrash = () => {
    if (window.isDestroyed()) return
    dispatch(window, record, { type: 'gpu-crash' })
  }
  const contents = window.webContents as unknown as {
    on(event: string, listener: () => void): void
  }
  contents.on('gpu-crashed', onGpuCrash)
  contents.on('child-process-gone', onGpuCrash)
  window.on('closed', () => {
    attached.delete(window)
  })
}

export function reapplyZenShellOnAllWindows(): void {
  const enabled = isZenShellEnabled()
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue
    if (enabled) {
      attachZenWindowPolicy(window)
      const record = attached.get(window)
      if (record) dispatch(window, record, { type: 'policy-change' })
    } else {
      clearNativeMaterial(window)
      applyLegacyMaterial(window)
    }
  }
}

/**
 * OFF path: restore the existing platform material (macOS vibrancy, Windows
 * mica/acrylic from the constructor helper). Does not force solid.
 */
export function applyLegacyMaterial(window: BrowserWindow): void {
  if (window.isDestroyed()) return
  if (process.platform === 'darwin') {
    try {
      window.setVibrancy('under-window')
      ;(window as unknown as { setVisualEffectState?: (state: string) => void })
        .setVisualEffectState?.('active')
    } catch (error) {
      windowLog.warn('Failed to restore legacy macOS vibrancy:', error)
    }
  }
}
