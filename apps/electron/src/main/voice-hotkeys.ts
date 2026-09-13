import { BrowserWindow, type Input } from 'electron'
import {
  acceleratorsConflict,
  loadVoicePrefs,
  type VoiceCommand,
  type VoiceKeyInput,
  type VoicePrefs,
  voiceCommandFromInput,
} from '@craft-agent/shared/voice'
import { RPC_CHANNELS } from '../shared/types'
import type { WindowManager } from './window-manager'
import { isVoiceOverlayWindow } from './voice-overlay'

function getGlobalShortcut(): Electron.GlobalShortcut {
  return (require('electron') as typeof import('electron')).globalShortcut
}

type EventSink = (
  channel: string,
  target: import('@craft-agent/shared/protocol').PushTarget,
  ...args: unknown[]
) => void

let windowManager: WindowManager | null = null
let eventSink: EventSink | null = null
let clientResolver: ((wcId: number) => string | undefined) | null = null
let pttHeld = false
const attached = new WeakSet<Electron.WebContents>()

export function setVoiceHotkeyTransport(
  manager: WindowManager,
  sink: EventSink,
  resolver: (wcId: number) => string | undefined,
): void {
  windowManager = manager
  eventSink = sink
  clientResolver = resolver
}

export function sendVoiceCommand(command: VoiceCommand): void {
  if (!eventSink || !clientResolver || !windowManager) return
  const windows = BrowserWindow.getAllWindows().filter((win) => {
    return !win.isDestroyed() && !isVoiceOverlayWindow(win)
  })
  const focused = BrowserWindow.getFocusedWindow()
  const target = (focused && !isVoiceOverlayWindow(focused) ? focused : null) ?? windows[0]
  if (!target || target.isDestroyed()) return
  const clientId = clientResolver(target.webContents.id)
  if (clientId) {
    eventSink(RPC_CHANNELS.voice.COMMAND, { to: 'client', clientId }, command)
    return
  }
  if (!target.webContents.isDestroyed()) {
    target.webContents.send(RPC_CHANNELS.voice.COMMAND, command)
  }
}

function asKeyInput(input: Input): VoiceKeyInput {
  return {
    type: input.type,
    key: input.key,
    code: (input as Input & { code?: string }).code,
    location: input.location,
    meta: input.meta,
    control: input.control,
    shift: input.shift,
    alt: input.alt,
  }
}

function onBeforeInput(event: { preventDefault(): void }, input: Input): void {
  const prefs = loadVoicePrefs()
  const command = voiceCommandFromInput(asKeyInput(input), prefs.pttModifier)
  if (!command) return
  if (command.action === 'toggle' || command.action === 'cancel') {
    // globalShortcut owns these when the app is hidden; skip duplicate while focused
    return
  }
  if (command.action === 'ptt-down') {
    if (pttHeld) return
    pttHeld = true
    try { event.preventDefault() } catch { /* ignore */ }
    sendVoiceCommand(command)
    return
  }
  if (command.action === 'ptt-up') {
    if (!pttHeld) return
    pttHeld = false
    try { event.preventDefault() } catch { /* ignore */ }
    sendVoiceCommand(command)
  }
}

export function attachVoicePttToWebContents(wc: Electron.WebContents): void {
  if (attached.has(wc) || wc.isDestroyed()) return
  attached.add(wc)
  wc.on('before-input-event', onBeforeInput)
}

let registered: string[] = []

function unregisterVoiceAccelerators(): void {
  const globalShortcut = getGlobalShortcut()
  for (const accelerator of registered) {
    try {
      globalShortcut.unregister(accelerator)
    } catch {
      /* ignore */
    }
  }
  registered = []
}

export function rebindVoiceHotkeys(prefs: VoicePrefs = loadVoicePrefs()): { ok: boolean; conflict?: string } {
  unregisterVoiceAccelerators()
  pttHeld = false
  const toggleConflict = acceleratorsConflict(prefs.hotkeyToggle)
  const cancelConflict = acceleratorsConflict(prefs.hotkeyCancel)
  if (toggleConflict) return { ok: false, conflict: toggleConflict }
  if (cancelConflict) return { ok: false, conflict: cancelConflict }
  const globalShortcut = getGlobalShortcut()
  const toggleOk = globalShortcut.register(prefs.hotkeyToggle, () => {
    sendVoiceCommand({ action: 'toggle' })
  })
  const cancelOk = globalShortcut.register(prefs.hotkeyCancel, () => {
    sendVoiceCommand({ action: 'cancel' })
  })
  if (toggleOk) registered.push(prefs.hotkeyToggle)
  if (cancelOk) registered.push(prefs.hotkeyCancel)
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) attachVoicePttToWebContents(win.webContents)
  }
  return { ok: toggleOk && cancelOk, conflict: toggleOk && cancelOk ? undefined : 'globalShortcut' }
}

export function unbindVoiceHotkeys(): void {
  unregisterVoiceAccelerators()
  pttHeld = false
}
