import { app, BrowserWindow, globalShortcut, screen } from 'electron'
import { join } from 'node:path'
import { canBindAccelerator, detectHotkeyCapabilities, overlayShouldStealFocus } from '@craft-agent/shared/voice'
import { loadVoicePrefs } from '@craft-agent/shared/voice'

let overlay: BrowserWindow | null = null

export function overlayUrl(): string {
  const dist = join(__dirname, '../renderer/voice-overlay.html')
  if (app.isPackaged) return `file://${dist}`
  return 'http://localhost:5173/voice-overlay.html'
}

export function showVoiceOverlay(position: 'top' | 'bottom' = 'bottom'): void {
  if (overlay && !overlay.isDestroyed()) {
    overlay.showInactive()
    return
  }
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const width = 420
  const height = 72
  const x = Math.round(display.workArea.x + (display.workArea.width - width) / 2)
  const y = position === 'top'
    ? display.workArea.y + 16
    : display.workArea.y + display.workArea.height - height - 24
  overlay = new BrowserWindow({
    width,
    height,
    x,
    y,
    frame: false,
    transparent: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false,
    show: false,
    webPreferences: {
      preload: join(__dirname, 'bootstrap-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  overlay.setAlwaysOnTop(true, 'screen-saver')
  void overlay.loadURL(overlayUrl())
  overlay.once('ready-to-show', () => {
    if (overlayShouldStealFocus('recording')) overlay?.show()
    else overlay?.showInactive()
  })
}

export function hideVoiceOverlay(): void {
  if (overlay && !overlay.isDestroyed()) overlay.hide()
}

export function registerVoiceHotkeys(onCommand: (command: 'toggle' | 'cancel') => void): () => void {
  const prefs = loadVoicePrefs()
  const caps = detectHotkeyCapabilities(process.platform)
  const accel = prefs.toggleAccelerator || 'CommandOrControl+Shift+D'
  if (canBindAccelerator(accel, caps) !== null) return () => {}
  const ok = globalShortcut.register(accel, () => onCommand('toggle'))
  if (!ok) return () => {}
  return () => {
    globalShortcut.unregister(accel)
  }
}
