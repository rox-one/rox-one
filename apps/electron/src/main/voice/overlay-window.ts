import { app, BrowserWindow, globalShortcut, screen } from 'electron'
import { join } from 'node:path'
import { canBindAccelerator, detectHotkeyCapabilities, overlayShouldStealFocus } from '@rox/shared/voice'
import { loadVoicePrefs } from '@rox/shared/voice'
import type { HotkeyCommand } from '@rox/shared/voice/hotkey-types'
import { attachVoiceCommandInput, voiceAcceleratorIsReserved } from './command-input'

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

export function registerVoiceHotkeys(
  onCommand: (command: HotkeyCommand, webContentsId?: number) => boolean,
  isFocusedTarget: (webContentsId: number) => boolean,
  readPrefs = loadVoicePrefs,
): () => void {
  const caps = detectHotkeyCapabilities(process.platform)
  let registered: string[] = []
  let signature = ''
  const inputs = new Map<number, ReturnType<typeof attachVoiceCommandInput>>()
  const rebind = () => {
    const prefs = readPrefs()
    const nextSignature = `${prefs.toggleAccelerator}\n${prefs.cancelAccelerator}\n${prefs.hotkeyMode}\n${prefs.pttModifier ?? 'AltRight'}`
    if (signature === nextSignature) return
    for (const input of inputs.values()) input.cancelHeld()
    for (const accelerator of registered) globalShortcut.unregister(accelerator)
    registered = []
    signature = nextSignature
    const bindings: [HotkeyCommand, string][] = [['toggle', prefs.toggleAccelerator], ['cancel', prefs.cancelAccelerator]]
    for (const [command, accelerator] of bindings) {
      // Escape is a foreground cancel key. Never reserve it globally in other apps.
      if (command === 'cancel' && !accelerator.includes('+')) continue
      if (voiceAcceleratorIsReserved(accelerator)) continue
      if (canBindAccelerator(accelerator, caps) !== null) continue
      try {
        if (globalShortcut.register(accelerator, () => onCommand(command))) registered.push(accelerator)
      } catch { /* Invalid/unavailable bindings cannot prevent application startup. */ }
    }
  }
  const attach = (_event: Electron.Event, wc: Electron.WebContents) => {
    if (wc.isDestroyed() || inputs.has(wc.id)) return
    const input = attachVoiceCommandInput(wc, {
      prefs: readPrefs,
      isFocused: () => isFocusedTarget(wc.id),
      send: command => onCommand(command, wc.id),
    })
    inputs.set(wc.id, input)
    wc.once('destroyed', () => { input.dispose(); inputs.delete(wc.id) })
  }
  const blur = (_event: Electron.Event, win: BrowserWindow) => inputs.get(win.webContents.id)?.cancelHeld()
  app.on('web-contents-created', attach)
  app.on('browser-window-blur', blur)
  app.on('browser-window-focus', rebind)
  for (const win of BrowserWindow.getAllWindows()) attach({} as Electron.Event, win.webContents)
  rebind()
  return () => {
    app.removeListener('web-contents-created', attach)
    app.removeListener('browser-window-blur', blur)
    app.removeListener('browser-window-focus', rebind)
    for (const input of inputs.values()) input.dispose()
    inputs.clear()
    for (const accelerator of registered) globalShortcut.unregister(accelerator)
    registered = []
  }
}
