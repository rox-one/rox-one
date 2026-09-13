/**
 * Voice hotkey matching and conflict policy.
 *
 * Toggle/cancel are Electron accelerators (globalShortcut).
 * PTT is release-aware: press starts, release stops. Right Option is identified
 * via KeyboardEvent.code / Electron InputEvent location, not by accelerator
 * string — globalShortcut cannot observe key-up of a lone modifier.
 */

export const DEFAULT_VOICE_TOGGLE_ACCELERATOR = 'CommandOrControl+Shift+D'
export const DEFAULT_VOICE_CANCEL_ACCELERATOR = 'CommandOrControl+Shift+Escape'
export const DEFAULT_VOICE_PTT = 'AltRight' as const

export type VoicePttModifier = 'AltRight' | 'ControlRight' | 'none'
export type VoiceCommandAction = 'toggle' | 'ptt-down' | 'ptt-up' | 'cancel'

export interface VoiceCommand {
  action: VoiceCommandAction
}

export interface VoiceKeyInput {
  type?: string
  key?: string
  code?: string
  location?: number
  meta?: boolean
  control?: boolean
  shift?: boolean
  alt?: boolean
  metaKey?: boolean
  ctrlKey?: boolean
  shiftKey?: boolean
  altKey?: boolean
}

export const RESERVED_VOICE_ACCELERATORS = [
  'CommandOrControl+Q',
  'CommandOrControl+W',
  'CommandOrControl+H',
  'CommandOrControl+M',
  'CommandOrControl+N',
  'CommandOrControl+Shift+N',
  'CommandOrControl+K',
  'CommandOrControl+,',
  'CommandOrControl+/',
  'Alt+F4',
] as const

export const PTT_MODIFIERS: readonly VoicePttModifier[] = ['AltRight', 'ControlRight', 'none']

export function isVoicePttModifier(value: unknown): value is VoicePttModifier {
  return value === 'AltRight' || value === 'ControlRight' || value === 'none'
}

function flag(input: VoiceKeyInput, name: 'meta' | 'control' | 'shift' | 'alt'): boolean {
  if (name === 'meta') return Boolean(input.meta ?? input.metaKey)
  if (name === 'control') return Boolean(input.control ?? input.ctrlKey)
  if (name === 'shift') return Boolean(input.shift ?? input.shiftKey)
  return Boolean(input.alt ?? input.altKey)
}

function keyName(input: VoiceKeyInput): string {
  return (input.key || '').toLowerCase()
}

export function isToggleChord(input: VoiceKeyInput): boolean {
  if (input.type && input.type !== 'keyDown') return false
  if (keyName(input) !== 'd') return false
  if (!flag(input, 'shift')) return false
  return flag(input, 'meta') || flag(input, 'control')
}

export function isCancelChord(input: VoiceKeyInput): boolean {
  if (input.type && input.type !== 'keyDown') return false
  const key = keyName(input)
  if (key !== 'escape' && key !== 'esc') return false
  if (!flag(input, 'shift')) return false
  return flag(input, 'meta') || flag(input, 'control')
}

function isRightOption(input: VoiceKeyInput): boolean {
  if (input.code === 'AltRight') return true
  return keyName(input) === 'alt' && input.location === 2
}

function isRightControl(input: VoiceKeyInput): boolean {
  if (input.code === 'ControlRight') return true
  return (keyName(input) === 'control' || keyName(input) === 'ctrl') && input.location === 2
}

export function isPttPress(input: VoiceKeyInput, ptt: VoicePttModifier): boolean {
  if (ptt === 'none') return false
  if (input.type && input.type !== 'keyDown') return false
  return ptt === 'AltRight' ? isRightOption(input) : isRightControl(input)
}

export function isPttRelease(input: VoiceKeyInput, ptt: VoicePttModifier): boolean {
  if (ptt === 'none') return false
  if (input.type !== 'keyUp') return false
  return ptt === 'AltRight' ? isRightOption(input) : isRightControl(input)
}

export function normalizeAccelerator(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const next = value.trim()
  return next || fallback
}

export function acceleratorsConflict(candidate: string, reserved: readonly string[] = RESERVED_VOICE_ACCELERATORS): string | null {
  const normalized = candidate.replace(/CommandOrControl/gi, 'CmdOrCtrl').toLowerCase()
  for (const item of reserved) {
    if (item.replace(/CommandOrControl/gi, 'CmdOrCtrl').toLowerCase() === normalized) {
      return item
    }
  }
  return null
}

export function voiceCommandFromInput(
  input: VoiceKeyInput,
  ptt: VoicePttModifier,
): VoiceCommand | null {
  if (isToggleChord(input)) return { action: 'toggle' }
  if (isCancelChord(input)) return { action: 'cancel' }
  if (isPttPress(input, ptt)) return { action: 'ptt-down' }
  if (isPttRelease(input, ptt)) return { action: 'ptt-up' }
  return null
}
