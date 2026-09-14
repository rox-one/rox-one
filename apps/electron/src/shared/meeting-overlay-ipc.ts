/**
 * Meeting overlay state (issue #369 / I013).
 * Error is never mapped to ready. Transcript is only accepted as a string.
 */

export const MEETING_OVERLAY_PHASES = [
  'idle',
  'recording',
  'paused',
  'ask',
  'catch-up',
  'error',
  'stopped',
] as const

export type MeetingOverlayPhase = (typeof MEETING_OVERLAY_PHASES)[number]

export type MeetingOverlayCommand = 'pause' | 'stop' | 'ask' | 'catch-up' | 'toggle' | 'cancel'

export interface MeetingOverlayState {
  kind: 'meeting'
  visible: boolean
  recording: boolean
  busy: boolean
  rms: number
  elapsedMs: number
  phase: MeetingOverlayPhase
  error?: string
  liveTranscript?: string
  displayId?: number
}

export type OverlayDisplay = {
  id: number
  workArea: { x: number; y: number; width: number; height: number }
}

export function emptyMeetingOverlayState(): MeetingOverlayState {
  return {
    kind: 'meeting',
    visible: false,
    recording: false,
    busy: false,
    rms: 0,
    elapsedMs: 0,
    phase: 'idle',
  }
}

export function mapMeetingOverlayPhase(input: {
  error?: string
  phase?: string
  recording?: boolean
  paused?: boolean
}): MeetingOverlayPhase {
  if (input.error) return 'error'
  if (input.phase === 'ready') return 'idle'
  if ((MEETING_OVERLAY_PHASES as readonly string[]).includes(input.phase ?? '')) {
    return input.phase as MeetingOverlayPhase
  }
  if (input.paused) return 'paused'
  if (input.recording) return 'recording'
  return 'idle'
}

export function parseMeetingOverlayState(payload: unknown): MeetingOverlayState {
  const body = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
  const error = typeof body.error === 'string' && body.error.trim() ? body.error : undefined
  const phase = mapMeetingOverlayPhase({
    error,
    phase: typeof body.phase === 'string' ? body.phase : undefined,
    recording: body.recording === true,
    paused: body.paused === true || body.phase === 'paused',
  })
  return {
    kind: 'meeting',
    visible: body.visible === true,
    recording: phase === 'recording',
    busy: phase === 'ask' || phase === 'catch-up',
    rms: typeof body.rms === 'number' && Number.isFinite(body.rms) ? Math.min(1, Math.max(0, body.rms)) : 0,
    elapsedMs: typeof body.elapsedMs === 'number' && Number.isFinite(body.elapsedMs) ? Math.max(0, body.elapsedMs) : 0,
    phase,
    error: phase === 'error' ? error : undefined,
    liveTranscript: typeof body.liveTranscript === 'string' ? body.liveTranscript : undefined,
    displayId: typeof body.displayId === 'number' && Number.isFinite(body.displayId) ? body.displayId : undefined,
  }
}

export function resolveOverlayDisplay(input: {
  displays: readonly OverlayDisplay[]
  lastDisplayId?: number
}): OverlayDisplay | null {
  if (input.displays.length === 0) return null
  const remembered = input.lastDisplayId === undefined
    ? undefined
    : input.displays.find((display) => display.id === input.lastDisplayId)
  return remembered ?? input.displays[0] ?? null
}
