import { overlayShouldStealFocus, overlayVisible, type OverlayPhase, type OverlayState } from '@craft-agent/shared/voice'
import { answerMeetingQuestion, type AssistAnswer } from '@craft-agent/shared/meeting-agents'

export type CaptureExclusion = { attempted: boolean; supported: boolean }

export type MeetingOverlay = OverlayState & {
  showInactive: boolean
  monitorId?: string
  captureExclusion?: CaptureExclusion
}

/** Existing overlay host only — never a second BrowserWindow. */
export type MeetingOverlayWindow = {
  setContentProtection?(enable: boolean): void
}

export function applyCaptureExclusion(win: MeetingOverlayWindow): CaptureExclusion {
  try {
    win.setContentProtection?.(true)
    return { attempted: true, supported: process.platform === 'darwin' || process.platform === 'win32' }
  } catch {
    return { attempted: true, supported: false }
  }
}

export function createMeetingOverlay(partial: Partial<MeetingOverlay> = {}): MeetingOverlay {
  return {
    recordingId: null,
    phase: 'hidden',
    elapsedMs: 0,
    rms: 0,
    streaming: false,
    showInactive: false,
    ...partial,
  }
}

export function openMeetingOverlay(
  current: MeetingOverlay,
  recordingId: string,
  window?: MeetingOverlayWindow,
): MeetingOverlay {
  const captureExclusion = window ? applyCaptureExclusion(window) : undefined
  if (current.phase !== 'hidden' && current.phase !== 'error') {
    return {
      ...current,
      error: 'duplicate-open',
      ...(captureExclusion ? { captureExclusion } : {}),
    }
  }
  return {
    ...current,
    recordingId,
    phase: 'recording',
    error: undefined,
    ...(captureExclusion ? { captureExclusion } : {}),
  }
}

export function mapOverlayError(message: string): OverlayPhase {
  return message ? 'error' : 'ready'
}

export function overlayFocusContract(phase: OverlayPhase): { visible: boolean; stealFocus: false } {
  return { visible: overlayVisible(phase), stealFocus: overlayShouldStealFocus(phase) }
}

export function bindMeetingHotkey(existing: readonly string[], next: string): { ok: true } | { ok: false; code: 'conflict' } {
  if (existing.includes(next)) return { ok: false, code: 'conflict' }
  return { ok: true }
}

export function rebindMeetingHotkeys(prefs: { hotkeyToggle: string; hotkeyCancel: string }): { ok: boolean; conflict?: string } {
  if (prefs.hotkeyToggle.replace(/CommandOrControl/gi, 'CmdOrCtrl').toLowerCase()
    === prefs.hotkeyCancel.replace(/CommandOrControl/gi, 'CmdOrCtrl').toLowerCase()) {
    return { ok: false, conflict: prefs.hotkeyToggle }
  }
  const toggleBind = bindMeetingHotkey([prefs.hotkeyCancel], prefs.hotkeyToggle)
  if (!toggleBind.ok) return { ok: false, conflict: prefs.hotkeyToggle }
  const cancelBind = bindMeetingHotkey([prefs.hotkeyToggle], prefs.hotkeyCancel)
  if (!cancelBind.ok) return { ok: false, conflict: prefs.hotkeyCancel }
  return { ok: true }
}

export type OverlayCommand = 'ask' | 'catch-up'

export function dispatchOverlayCommand(
  current: MeetingOverlay,
  command: OverlayCommand,
  input: Parameters<typeof answerMeetingQuestion>[0],
): { overlay: MeetingOverlay; answer: AssistAnswer } {
  if (command === 'catch-up') {
    const overlay = { ...current, partialTranscript: undefined }
    return { overlay, answer: answerMeetingQuestion({ ...input, transcriptPartial: false }) }
  }
  return {
    overlay: current,
    answer: answerMeetingQuestion({
      ...input,
      transcriptPartial: input.transcriptPartial ?? Boolean(current.partialTranscript),
    }),
  }
}
