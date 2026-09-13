export type HotkeyCommand = 'toggle' | 'ptt-down' | 'ptt-up' | 'cancel'
export interface HotkeyCapabilities {
  globalToggle: boolean
  keyUp: boolean
  leftRightModifiers: boolean
  canSuppress: boolean
  conflictDetection: boolean
  modifierOnlyPtt: boolean
  platform: 'darwin' | 'win32' | 'linux' | 'web'
}
export interface HotkeyBinding { command: HotkeyCommand; accelerator: string; enabled: boolean }
export interface HotkeyConflict { accelerator: string; reason: 'system' | 'rox' | 'unregistered' }
export const DEFAULT_TOGGLE_ACCELERATOR = 'CommandOrControl+Shift+D'
export const RIGHT_OPTION_PRESET = 'RightAlt'
export const DEFAULT_CANCEL_ACCELERATOR = 'Escape'

export function detectHotkeyCapabilities(platform: NodeJS.Platform | 'web' = process.platform): HotkeyCapabilities {
  if (platform === 'web') {
    return { globalToggle: false, keyUp: false, leftRightModifiers: false, canSuppress: false, conflictDetection: false, modifierOnlyPtt: false, platform: 'web' }
  }
  if (platform === 'darwin') {
    return { globalToggle: true, keyUp: false, leftRightModifiers: false, canSuppress: true, conflictDetection: true, modifierOnlyPtt: false, platform: 'darwin' }
  }
  if (platform === 'win32') {
    return { globalToggle: true, keyUp: true, leftRightModifiers: true, canSuppress: true, conflictDetection: true, modifierOnlyPtt: false, platform: 'win32' }
  }
  return { globalToggle: true, keyUp: false, leftRightModifiers: false, canSuppress: false, conflictDetection: false, modifierOnlyPtt: false, platform: 'linux' }
}

export function isModifierOnly(accelerator: string): boolean {
  return /^(RightAlt|Alt|Option|RightOption|Meta|Control)$/i.test(accelerator.replace(/\s/g, ''))
}

export function canBindAccelerator(accelerator: string, capabilities: HotkeyCapabilities): HotkeyConflict | null {
  if (isModifierOnly(accelerator) && !capabilities.modifierOnlyPtt) return { accelerator, reason: 'unregistered' }
  if (!capabilities.globalToggle) return { accelerator, reason: 'unregistered' }
  return null
}

export function normalizeAccelerator(accelerator: string): string {
  return accelerator.replace(/Cmd/gi, 'Command').replace(/Option/gi, 'Alt').trim()
}
