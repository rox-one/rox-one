export type RuntimeCameraMode = 'following' | 'inspecting'
export interface RuntimeCameraState { mode: RuntimeCameraMode; pending: number; lastSeenSeq: number }
export function receiveCameraEvents(state: RuntimeCameraState, seq: number): RuntimeCameraState {
  if (seq <= state.lastSeenSeq) return state
  return { ...state, lastSeenSeq: seq, pending: state.mode === 'inspecting' ? state.pending + seq - state.lastSeenSeq : 0 }
}
export function inspectCamera(state: RuntimeCameraState): RuntimeCameraState { return { ...state, mode: 'inspecting' } }
export function resumeCamera(state: RuntimeCameraState): RuntimeCameraState { return { ...state, mode: 'following', pending: 0 } }
export function splitStorageKey(scopeKey: string): string { return `rox.runtime-map.split:${scopeKey}` }
export function clampChatRatio(ratio: number, width: number): number {
  if (!Number.isFinite(ratio)) return 0.42
  if (width < 720) return 0.5
  const minimum = 360 / width
  return Math.max(minimum, Math.min(1 - minimum, ratio))
}
