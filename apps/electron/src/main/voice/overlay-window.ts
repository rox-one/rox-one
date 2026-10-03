import { app, BrowserWindow, globalShortcut } from 'electron'
import { canBindAccelerator, detectHotkeyCapabilities } from '@rox/shared/voice'
import { loadVoicePrefs } from '@rox/shared/voice'
import type { HotkeyCommand } from '@rox/shared/voice/hotkey-types'
import { attachVoiceCommandInput, voiceAcceleratorIsReserved } from './command-input'

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
