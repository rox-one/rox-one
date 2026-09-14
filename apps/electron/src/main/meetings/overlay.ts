/**
 * Meeting overlay (issue #369 / I013).
 * Specializes the existing voice overlay host — it does not create a second window.
 * showInactive only; capture stop remains available if the overlay fails.
 */

import {
  acceleratorsConflict,
  loadVoicePrefs,
  type VoiceOverlayPosition,
} from '@craft-agent/shared/voice'
import {
  answerMeetingQuestion,
  type AnswerMeetingQuestionInput,
} from '@craft-agent/shared/meeting-agents'
import {
  emptyMeetingOverlayState,
  parseMeetingOverlayState,
  resolveOverlayDisplay,
  type MeetingOverlayCommand,
  type MeetingOverlayPhase,
  type MeetingOverlayState,
  type OverlayDisplay,
} from '../../shared/meeting-overlay-ipc'
import type { VoiceOverlayCommand } from '../../shared/voice-overlay-ipc'

export type MeetingOverlayOpenResult = {
  reused: boolean
  visible: boolean
  conflict?: string
  captureExclusion: { attempted: boolean; supported: boolean }
}

export type MeetingOverlayWindow = {
  showInactive(): void
  hide(): void
  setSize?(width: number, height: number): void
  setPosition?(x: number, y: number, animate?: boolean): void
  setContentProtection?(enable: boolean): void
}

export type MeetingOverlayRuntime = {
  ensureWindow?: () => Promise<{ reused: boolean; window: MeetingOverlayWindow | null }>
  displays?: () => OverlayDisplay[]
  overlayPosition?: VoiceOverlayPosition
  rebindHotkeys?: (prefs: { hotkeyToggle: string; hotkeyCancel: string }) => { ok: boolean; conflict?: string }
}

const MEETING_WIDTH = 420
const MEETING_HEIGHT = 120

let lastState: MeetingOverlayState = emptyMeetingOverlayState()
let lastDisplayId: number | undefined
let stopHandler: (() => void) | null = null
let sessionClaimed = false
let usingTestRuntime = false
let assistContext: AnswerMeetingQuestionInput = {}
let assistPromise: Promise<MeetingOverlayState> | null = null
let phaseBeforeAssist: MeetingOverlayPhase = 'recording'

export function setMeetingOverlayAssistContext(context: AnswerMeetingQuestionInput): void {
  assistContext = { ...context }
}

export function flushMeetingOverlayAssist(): Promise<MeetingOverlayState> {
  return assistPromise ?? Promise.resolve(getMeetingOverlayState())
}

export function getMeetingOverlayState(): MeetingOverlayState {
  return { ...lastState }
}

export function isMeetingOverlayActive(): boolean {
  return lastState.visible && lastState.phase !== 'idle' && lastState.phase !== 'stopped'
}

export function setMeetingStopHandler(handler: (() => void) | null): void {
  stopHandler = handler
}

export function rebindMeetingHotkeys(prefs: { hotkeyToggle: string; hotkeyCancel: string }): { ok: boolean; conflict?: string } {
  const toggleConflict = acceleratorsConflict(prefs.hotkeyToggle)
  if (toggleConflict) return { ok: false, conflict: toggleConflict }
  const cancelConflict = acceleratorsConflict(prefs.hotkeyCancel)
  if (cancelConflict) return { ok: false, conflict: cancelConflict }
  if (prefs.hotkeyToggle.replace(/CommandOrControl/gi, 'CmdOrCtrl').toLowerCase()
    === prefs.hotkeyCancel.replace(/CommandOrControl/gi, 'CmdOrCtrl').toLowerCase()) {
    return { ok: false, conflict: prefs.hotkeyToggle }
  }
  return { ok: true }
}

export async function openMeetingOverlay(
  payload: unknown = { visible: true, phase: 'recording' },
  runtime: MeetingOverlayRuntime = {},
): Promise<MeetingOverlayOpenResult> {
  const prefs = loadVoicePrefsSafe()
  usingTestRuntime = Boolean(runtime.ensureWindow)
  const conflict = rebindMeetingHotkeys({
    hotkeyToggle: prefs.hotkeyToggle,
    hotkeyCancel: prefs.hotkeyCancel,
  })
  if (!conflict.ok) {
    return { reused: sessionClaimed, visible: lastState.visible, conflict: conflict.conflict, captureExclusion: { attempted: false, supported: false } }
  }
  if (runtime.rebindHotkeys) {
    const bound = runtime.rebindHotkeys(prefs)
    if (!bound.ok) {
      return { reused: sessionClaimed, visible: lastState.visible, conflict: bound.conflict, captureExclusion: { attempted: false, supported: false } }
    }
  } else {
    await applyHostHotkeys(prefs)
  }

  const ensured = await ensureHost(runtime)
  const reused = sessionClaimed || ensured.reused
  sessionClaimed = true
  lastState = parseMeetingOverlayState({
    ...lastState,
    ...(payload && typeof payload === 'object' ? payload : {}),
    visible: true,
  })
  const win = ensured.window
  if (!win) {
    lastState = { ...lastState, visible: false, phase: 'error', error: lastState.error ?? 'overlay-unavailable' }
    return { reused, visible: false, captureExclusion: { attempted: false, supported: false } }
  }

  const display = resolveOverlayDisplay({
    displays: runtime.displays?.() ?? [],
    lastDisplayId: lastState.displayId ?? lastDisplayId,
  })
  if (display) {
    lastDisplayId = display.id
    lastState = { ...lastState, displayId: display.id }
    const position = runtime.overlayPosition ?? prefs.overlayPosition
    const x = Math.round(display.workArea.x + (display.workArea.width - MEETING_WIDTH) / 2)
    const y = position === 'bottom'
      ? Math.round(display.workArea.y + display.workArea.height - MEETING_HEIGHT - 24)
      : Math.round(display.workArea.y + 24)
    win.setSize?.(MEETING_WIDTH, MEETING_HEIGHT)
    win.setPosition?.(x, y, false)
  } else {
    await positionOnHost(win, lastState.displayId ?? lastDisplayId)
  }

  const captureExclusion = applyCaptureExclusion(win)
  win.showInactive()
  if (!usingTestRuntime) await occupyHost(lastState)
  return { reused, visible: true, captureExclusion }
}

export async function hideMeetingOverlay(runtime: MeetingOverlayRuntime = {}): Promise<MeetingOverlayState> {
  lastState = { ...lastState, visible: false }
  const ensured = await ensureHost(runtime)
  ensured.window?.hide()
  if (!usingTestRuntime) await occupyHost(lastState, { keepOccupant: true })
  return getMeetingOverlayState()
}

export function dispatchMeetingOverlayCommand(action: MeetingOverlayCommand): MeetingOverlayState {
  if (action === 'stop' || action === 'cancel') {
    return stopMeetingFromHost()
  }
  if (action === 'pause' || action === 'toggle') {
    const next = lastState.phase === 'paused' ? 'recording' : 'paused'
    lastState = parseMeetingOverlayState({ ...lastState, phase: next, error: undefined, visible: lastState.visible })
    if (!usingTestRuntime) void occupyHost(lastState, { keepOccupant: true })
    return getMeetingOverlayState()
  }
  if (action === 'ask' || action === 'catch-up') {
    if (lastState.phase !== 'ask' && lastState.phase !== 'catch-up') {
      phaseBeforeAssist = lastState.phase === 'paused' ? 'paused' : 'recording'
    }
    lastState = parseMeetingOverlayState({ ...lastState, phase: action, error: undefined, visible: lastState.visible })
    if (!usingTestRuntime) void occupyHost(lastState, { keepOccupant: true })
    assistPromise = Promise.resolve().then(async () => {
      const result = await answerMeetingQuestion({
        ...assistContext,
        intent: action,
        question: action === 'ask' ? (assistContext.question ?? lastState.liveTranscript ?? '') : assistContext.question,
      })
      if (!result.ok) {
        lastState = parseMeetingOverlayState({
          ...lastState,
          phase: 'error',
          error: result.message,
        })
      } else {
        lastState = parseMeetingOverlayState({
          ...lastState,
          phase: phaseBeforeAssist,
          liveTranscript: result.text,
          error: undefined,
        })
      }
      if (!usingTestRuntime) void occupyHost(lastState, { keepOccupant: true })
      return getMeetingOverlayState()
    }).catch((error: unknown) => {
      lastState = parseMeetingOverlayState({
        ...lastState,
        phase: 'error',
        error: error instanceof Error ? error.message : 'assist-failed',
      })
      return getMeetingOverlayState()
    })
    return getMeetingOverlayState()
  }
  return getMeetingOverlayState()
}

export function stopMeetingFromHost(): MeetingOverlayState {
  stopHandler?.()
  lastState = parseMeetingOverlayState({ ...lastState, visible: false, phase: 'stopped', error: undefined })
  sessionClaimed = false
  if (!usingTestRuntime) void releaseHost()
  return getMeetingOverlayState()
}

export function destroyMeetingOverlay(): void {
  stopHandler?.()
  lastState = emptyMeetingOverlayState()
  sessionClaimed = false
  lastDisplayId = undefined
  assistContext = {}
  assistPromise = null
  if (!usingTestRuntime) void releaseHost()
  usingTestRuntime = false
}

async function ensureHost(runtime: MeetingOverlayRuntime): Promise<{ reused: boolean; window: MeetingOverlayWindow | null }> {
  if (runtime.ensureWindow) return runtime.ensureWindow()
  const host = await import('../voice-overlay')
  host.registerVoiceOverlayIpc()
  const existing = host.getVoiceOverlayWindow()
  const win = await host.ensureVoiceOverlayWindow()
  return { reused: Boolean(existing), window: win }
}

async function occupyHost(state: MeetingOverlayState, opts?: { keepOccupant?: boolean }): Promise<void> {
  try {
    const host = await import('../voice-overlay')
    host.setVoiceOverlayOccupant(state.visible || opts?.keepOccupant ? 'meeting' : null)
    host.setOverlayCommandOverride((action: VoiceOverlayCommand) => {
      dispatchMeetingOverlayCommand(action)
    })
    host.pushOverlayRendererState(state)
  } catch {
    /* tests without Electron skip the live host */
  }
}

async function releaseHost(): Promise<void> {
  try {
    const host = await import('../voice-overlay')
    host.setOverlayCommandOverride(null)
    host.setVoiceOverlayOccupant(null)
    host.hideVoiceOverlay()
    host.pushOverlayRendererState(lastState)
  } catch {
    /* tests without Electron skip the live host */
  }
}

async function positionOnHost(win: MeetingOverlayWindow, displayId?: number): Promise<void> {
  try {
    const host = await import('../voice-overlay')
    const real = host.getVoiceOverlayWindow()
    if (!real) return
    const placed = host.positionVoiceOverlay(real, {
      displayId,
      width: MEETING_WIDTH,
      height: MEETING_HEIGHT,
    })
    lastDisplayId = placed.displayId
    lastState = { ...lastState, displayId: placed.displayId }
  } catch {
    win.setSize?.(MEETING_WIDTH, MEETING_HEIGHT)
  }
}

function applyCaptureExclusion(win: MeetingOverlayWindow): { attempted: boolean; supported: boolean } {
  try {
    win.setContentProtection?.(true)
    return { attempted: true, supported: process.platform === 'darwin' || process.platform === 'win32' }
  } catch {
    return { attempted: true, supported: false }
  }
}

async function applyHostHotkeys(prefs: { hotkeyToggle: string; hotkeyCancel: string }): Promise<{ ok: boolean; conflict?: string }> {
  try {
    const { rebindVoiceHotkeys } = await import('../voice-hotkeys')
    return rebindVoiceHotkeys({ ...loadVoicePrefsSafe(), ...prefs })
  } catch {
    return { ok: true }
  }
}

function loadVoicePrefsSafe(): { hotkeyToggle: string; hotkeyCancel: string; overlayPosition: VoiceOverlayPosition } {
  try {
    return loadVoicePrefs()
  } catch {
    return {
      hotkeyToggle: 'CommandOrControl+Shift+D',
      hotkeyCancel: 'CommandOrControl+Shift+Escape',
      overlayPosition: 'top',
    }
  }
}
