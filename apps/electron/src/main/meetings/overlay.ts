import { overlayShouldStealFocus, overlayVisible, type OverlayPhase, type OverlayState } from '@craft-agent/shared/voice'
import { answerMeetingQuestion, type AssistAnswer } from '@craft-agent/shared/meeting-agents'

export type MeetingOverlay = OverlayState & { showInactive: boolean; monitorId?: string }

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

export function openMeetingOverlay(current: MeetingOverlay, recordingId: string): MeetingOverlay {
  if (current.phase !== 'hidden' && current.phase !== 'error') {
    return { ...current, error: 'duplicate-open' }
  }
  return { ...current, recordingId, phase: 'recording', error: undefined }
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
