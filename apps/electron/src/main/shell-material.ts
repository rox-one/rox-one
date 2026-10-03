/**
 * Zen Shell window material application (ZS-01).
 *
 * OFF (`shell.zen.v1` false) never calls this path — WindowManager keeps the
 * existing revealWindow / acrylic-or-mica constructor policy.
 * ON: show once, apply vibrancy/mica only after a healthy paint.
 */

import { app, BrowserWindow, nativeTheme, systemPreferences } from 'electron'
import { release } from 'os'
import { isZenShellEnabled, getZenShellMaterialPreference } from '@rox/shared/config'
import {
  WINDOWS_MICA_BUILD,
  snapshotZenShell,
  type ResolvedShellMaterial,
  type ShellPlatform,
  type ZenShellSnapshot,
} from '../shared/shell-appearance'
import { initialZenWindowState, reduceZenWindow, type ZenWindowState } from '../shared/shell-window-lifecycle'
import { windowLog } from './logger'

interface ZenWindowRecord {
  state: ZenWindowState
  materialFailed: boolean
  onSnapshot?: (snapshot: ZenShellSnapshot) => void
}

// Strong references live only until the window's `closed` event. One app-level
// GPU listener handles every window without accumulating EventEmitter listeners.
const attached = new Map<BrowserWindow, ZenWindowRecord>()
const snapshotListeners = new WeakMap<BrowserWindow, (snapshot: ZenShellSnapshot) => void>()

export function setZenShellSnapshotListener(window: BrowserWindow, listener: (snapshot: ZenShellSnapshot) => void): void {
  snapshotListeners.set(window, listener)
  const record = attached.get(window)
  if (record) record.onSnapshot = listener
}

function onChildProcessGone(_event: unknown, details: { type: string }): void {
  if (details.type !== 'GPU') return
  for (const [window, record] of attached) {
    if (!window.isDestroyed()) dispatch(window, record, { type: 'gpu-crash' })
  }
}

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
      if (systemPreferences.getUserDefault('AppleReduceTransparency', 'boolean') === true) return true
    } catch {
      // fall through
    }
  }
  return Boolean((nativeTheme as { prefersReducedTransparency?: boolean }).prefersReducedTransparency)
}

function queryHighContrast(): boolean {
  return nativeTheme.shouldUseHighContrastColors === true
}

/** Accessibility applies to the legacy material path as well as Zen. */
export function nativeAccessibilityPrefersSolid(): boolean {
  return queryHighContrast() || queryReduceTransparency()
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

/** Return this window's painted capability, rather than predicting a future paint. */
export function peekZenShellSnapshotForWindow(window: BrowserWindow | null | undefined): ZenShellSnapshot {
  const record = window ? attached.get(window) : undefined
  const snapshot = peekZenShellSnapshot({
    paintHealthy: record !== undefined && record.state.paintGeneration === record.state.generation,
    windowDestroyed: window?.isDestroyed() ?? false,
    gpuFailed: record !== undefined && record.state.generation > 0 && record.state.paintGeneration !== record.state.generation,
  })
  if (record?.materialFailed && snapshot.material !== 'solid') {
    return { ...snapshot, material: 'solid', fallbackReason: 'material-unavailable' }
  }
  return snapshot
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
  // The opaque fill is still required when a native compositor API refuses
  // to clear its material (for example, while its GPU process is recovering).
  try {
    window.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#0c0c0d' : '#f4f4f5')
  } catch (error) {
    windowLog.warn('Failed to restore opaque Zen Shell background:', error)
  }
}

function applyNativeMaterial(window: BrowserWindow, material: ResolvedShellMaterial): boolean {
  if (window.isDestroyed()) return false
  try {
    if (material === 'vibrancy' && process.platform === 'darwin') {
      window.setVibrancy('under-window')
      window.setBackgroundColor('#00000000')
      ;(window as unknown as { setVisualEffectState?: (state: string) => void })
        .setVisualEffectState?.('active')
      return true
    }
    if (material === 'mica' && process.platform === 'win32' && typeof window.setBackgroundMaterial === 'function') {
      window.setBackgroundMaterial('mica')
      window.setBackgroundColor('#00000000')
      return true
    }
    clearNativeMaterial(window)
    return material === 'solid'
  } catch (error) {
    windowLog.warn('Failed to apply Zen Shell material:', error)
    clearNativeMaterial(window)
    return false
  }
}

function dispatch(window: BrowserWindow, record: ZenWindowRecord, event: Parameters<typeof reduceZenWindow>[1]): void {
  record.state = reduceZenWindow(record.state, event)
  if (record.state.clearMaterial) {
    clearNativeMaterial(window)
  }
  if (!window.isDestroyed() && record.state.shown && !window.isVisible()) {
    window.show()
  }
  if (record.state.applyMaterial && !window.isDestroyed()) {
    // Retry an unavailable native API on an explicit policy change, but report
    // its actual result to the renderer so its canvas does not stay transparent.
    record.materialFailed = false
    const snap = peekZenShellSnapshotForWindow(window)
    record.materialFailed = !applyNativeMaterial(window, snap.material)
  }
  if (!window.isDestroyed()) record.onSnapshot?.(peekZenShellSnapshotForWindow(window))
}

/**
 * Attach Zen first-paint + material policy. Call only when `shell.zen.v1` is ON
 * at window creation (or after a live enable). The legacy `revealWindow`
 * `isVisible()` early-return stays on the OFF path.
 */
export function attachZenWindowPolicy(window: BrowserWindow, onSnapshot?: (snapshot: ZenShellSnapshot) => void): void {
  const existing = attached.get(window)
  if (existing) {
    if (onSnapshot) existing.onSnapshot = onSnapshot
    return
  }
  const record: ZenWindowRecord = { state: initialZenWindowState(), materialFailed: false, onSnapshot: onSnapshot ?? snapshotListeners.get(window) }
  // Live enable on an already-visible window: treat current frame as healthy paint.
  if (!window.isDestroyed() && window.isVisible()) {
    record.state = {
      ...record.state,
      shown: true,
      paintGeneration: record.state.generation,
    }
  }
  if (attached.size === 0) app.on('child-process-gone', onChildProcessGone)
  attached.set(window, record)

  window.once('ready-to-show', () => {
    if (window.isDestroyed()) return
    clearTimeout(paintTimeout)
    dispatch(window, record, { type: 'ready-to-show' })
  })
  window.webContents.once('did-finish-load', () => {
    if (window.isDestroyed()) return
    dispatch(window, record, { type: 'did-finish-load' })
  })
  const paintTimeout = setTimeout(() => {
    if (window.isDestroyed()) return
    dispatch(window, record, { type: 'timeout' })
  }, 4000)

  window.on('closed', () => {
    clearTimeout(paintTimeout)
    attached.delete(window)
    if (attached.size === 0) app.removeListener('child-process-gone', onChildProcessGone)
  })
}

export function reapplyZenShellOnAllWindows(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    reapplyZenShellOnWindow(window)
  }
}

export function reapplyZenShellOnWindow(window: BrowserWindow): void {
  if (window.isDestroyed()) return
  if (isZenShellEnabled()) {
    attachZenWindowPolicy(window)
    const record = attached.get(window)
    if (record) dispatch(window, record, { type: 'policy-change' })
  } else {
    clearNativeMaterial(window)
    applyLegacyMaterial(window)
  }
}

/**
 * OFF path: restore the existing platform material (macOS vibrancy, Windows
 * mica/acrylic from the constructor helper). Does not force solid.
 */
export function applyLegacyMaterial(window: BrowserWindow): void {
  if (window.isDestroyed()) return
  if (nativeAccessibilityPrefersSolid()) {
    clearNativeMaterial(window)
    return
  }
  if (process.platform === 'win32' && (windowsBuild() ?? 0) >= WINDOWS_MICA_BUILD) {
    applyNativeMaterial(window, 'mica')
    return
  }
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
