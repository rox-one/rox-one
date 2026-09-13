export type OverlayPhase = 'hidden' | 'permission' | 'recording' | 'saving' | 'transcribing' | 'enhancing' | 'ready' | 'error'
export interface OverlayState {
  recordingId: string | null
  phase: OverlayPhase
  elapsedMs: number
  rms: number
  error?: string
  partialTranscript?: string
  streaming: boolean
}
export function overlayShouldStealFocus(phase: OverlayPhase): false {
  void phase
  return false
}
export function overlayVisible(phase: OverlayPhase): boolean {
  return phase !== 'hidden'
}
export function overlayFromCapture(state: 'idle' | 'requesting-permission' | 'recording' | 'finalizing'): OverlayPhase {
  switch (state) {
    case 'idle': return 'hidden'
    case 'requesting-permission': return 'permission'
    case 'recording': return 'recording'
    case 'finalizing': return 'saving'
    default: {
      const _never: never = state
      return _never
    }
  }
}
