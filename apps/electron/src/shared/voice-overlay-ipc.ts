export const VOICE_OVERLAY_IPC = {
  COMMAND: 'voice-overlay:command',
  STATE: 'voice-overlay:state',
} as const

export type VoiceOverlayCommand = 'toggle' | 'cancel' | 'pause' | 'stop' | 'ask' | 'catch-up'

export const VOICE_OVERLAY_COMMANDS: readonly VoiceOverlayCommand[] = [
  'toggle',
  'cancel',
  'pause',
  'stop',
  'ask',
  'catch-up',
] as const

export function isVoiceOverlayCommand(value: unknown): value is VoiceOverlayCommand {
  return typeof value === 'string' && (VOICE_OVERLAY_COMMANDS as readonly string[]).includes(value)
}

export interface VoiceOverlayState {
  visible: boolean
  recording: boolean
  busy: boolean
  rms: number
  elapsedMs: number
}

export function emptyVoiceOverlayState(): VoiceOverlayState {
  return {
    visible: false,
    recording: false,
    busy: false,
    rms: 0,
    elapsedMs: 0,
  }
}

export function parseVoiceOverlayState(payload: unknown): VoiceOverlayState {
  const body = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
  return {
    visible: body.visible === true,
    recording: body.recording === true,
    busy: body.busy === true,
    rms: typeof body.rms === 'number' && Number.isFinite(body.rms) ? Math.min(1, Math.max(0, body.rms)) : 0,
    elapsedMs: typeof body.elapsedMs === 'number' && Number.isFinite(body.elapsedMs) ? Math.max(0, body.elapsedMs) : 0,
  }
}
