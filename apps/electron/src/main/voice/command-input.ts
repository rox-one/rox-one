import type { HotkeyCommand } from '@rox/shared/voice/hotkey-types'
import type { VoicePrefs } from '@rox/shared/voice'

export type VoiceKeyInput = {
  type?: string
  key?: string
  code?: string
  location?: number
  meta?: boolean
  control?: boolean
  alt?: boolean
  shift?: boolean
}

const RESERVED_ACCELERATORS = ['CommandOrControl+Q', 'CommandOrControl+W', 'CommandOrControl+H', 'CommandOrControl+M',
  'CommandOrControl+N', 'CommandOrControl+Shift+N', 'CommandOrControl+K', 'CommandOrControl+,', 'CommandOrControl+/', 'Alt+F4']

export function voiceAcceleratorIsReserved(value: string, platform = process.platform): boolean {
  const normalize = (accelerator: string) => {
    const parts = accelerator.toLowerCase().replace(/\s/g, '').split('+')
    const key = parts.pop()
    return [...parts.map(part => {
      if (part === 'commandorcontrol' || part === 'cmdorctrl') return platform === 'darwin' ? 'command' : 'control'
      if (part === 'cmd' || part === 'meta') return 'command'
      if (part === 'ctrl') return 'control'
      if (part === 'option') return 'alt'
      return part
    }).sort(), key].join('+')
  }
  return RESERVED_ACCELERATORS.some(accelerator => normalize(accelerator) === normalize(value))
}

export function matchesVoiceAccelerator(input: VoiceKeyInput, accelerator: string, platform = process.platform): boolean {
  const parts = accelerator.toLowerCase().split('+').map(part => part.trim())
  const key = parts.pop()
  if (!key || input.type !== 'keyDown') return false
  const modifiers = new Set(parts)
  const commandOrControl = modifiers.has('commandorcontrol') || modifiers.has('cmdorctrl')
  const meta = modifiers.has('command') || modifiers.has('cmd') || modifiers.has('meta') || (commandOrControl && platform === 'darwin')
  const control = modifiers.has('control') || modifiers.has('ctrl') || (commandOrControl && platform !== 'darwin')
  return Boolean(input.meta) === meta && Boolean(input.control) === control
    && Boolean(input.alt) === (modifiers.has('alt') || modifiers.has('option'))
    && Boolean(input.shift) === modifiers.has('shift')
    && (input.key?.toLowerCase() === key || (key === 'escape' && input.key?.toLowerCase() === 'esc'))
}

export type VoiceInputPort = {
  on(event: 'before-input-event', listener: (event: { preventDefault(): void }, input: VoiceKeyInput) => void): unknown
  removeListener(event: 'before-input-event', listener: (event: { preventDefault(): void }, input: VoiceKeyInput) => void): unknown
}

/** Foreground key-up pairing, separate from globalShortcut's key-down API. */
export function attachVoiceCommandInput(port: VoiceInputPort, options: {
  prefs(): Pick<VoicePrefs, 'hotkeyMode' | 'cancelAccelerator'>
  isFocused(): boolean
  send(command: HotkeyCommand): boolean
}): { cancelHeld(): void; dispose(): void } {
  let held = false
  const cancelHeld = () => {
    if (!held) return
    held = false
    options.send('cancel')
  }
  const listener = (event: { preventDefault(): void }, input: VoiceKeyInput) => {
    if (!options.isFocused()) return
    const prefs = options.prefs()
    if (matchesVoiceAccelerator(input, prefs.cancelAccelerator)) {
      const wasHeld = held
      held = false
      // Idle Escape must keep its normal dialog/navigation behavior.
      if (options.send('cancel') && wasHeld) event.preventDefault()
      return
    }
    const rightOption = input.code === 'AltRight' || (input.key?.toLowerCase() === 'alt' && input.location === 2)
    if (!rightOption) return
    if (input.type === 'keyUp' && held) {
      held = false
      if (options.send('ptt-up')) event.preventDefault()
    } else if (input.type === 'keyDown' && prefs.hotkeyMode === 'ptt') {
      if (held) { event.preventDefault(); return }
      if (options.send('ptt-down')) { held = true; event.preventDefault() }
    }
  }
  port.on('before-input-event', listener)
  return { cancelHeld, dispose() { cancelHeld(); port.removeListener('before-input-event', listener) } }
}

/** Use only the client's authenticated native-window handshake; no broadcast/fallback. */
export function sendVoiceHotkeyToClient(options: {
  webContentsId: number
  isManagedWindow(id: number): boolean
  resolveClient(id: number): string | undefined
  push?: ((channel: string, target: { to: 'client'; clientId: string }, payload: { command: HotkeyCommand }) => void) | null
  channel: string
}, command: HotkeyCommand): boolean {
  if (!['toggle', 'ptt-down', 'ptt-up', 'cancel'].includes(command)) return false
  if (!options.isManagedWindow(options.webContentsId) || !options.push) return false
  const clientId = options.resolveClient(options.webContentsId)
  if (!clientId) return false
  options.push(options.channel, { to: 'client', clientId }, { command })
  return true
}
