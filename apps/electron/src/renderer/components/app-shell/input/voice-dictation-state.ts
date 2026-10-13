import { useSyncExternalStore } from 'react'

/**
 * Live microphone level for the composer dictation wave. A single global store
 * keeps the control's publisher and the badge's subscriber in lockstep without
 * threading the value through every intermediate component.
 */
let dictationLevel = 0
const dictationLevelListeners = new Set<() => void>()

/** Publish the current 0..1 level. Values are clamped; identical values are free. */
export function setDictationLevel(level: number): void {
  const next = Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0
  if (next === dictationLevel) return
  dictationLevel = next
  for (const listener of dictationLevelListeners) listener()
}

export function getDictationLevel(): number {
  return dictationLevel
}

export function subscribeDictationLevel(listener: () => void): () => void {
  dictationLevelListeners.add(listener)
  return () => dictationLevelListeners.delete(listener)
}

export function useDictationLevel(): number {
  return useSyncExternalStore(subscribeDictationLevel, getDictationLevel, getDictationLevel)
}

/**
 * Live dictation session (G5 composer deck). The control publishes when capture
 * starts and stops; the deck's dictation strip subscribes so it can render
 * «Слушаю», the remaining time and the stop affordance without owning the
 * capture state machine. A single global store mirrors the level store above.
 */
export interface DictationSession {
  /** True while the recorder is running. */
  active: boolean
  /** Epoch ms of the capture start, or null when idle. */
  startedAt: number | null
}

let dictationSession: DictationSession = { active: false, startedAt: null }
const dictationSessionListeners = new Set<() => void>()

/** Publish the current capture session. Identical values are free. */
export function setDictationSession(active: boolean, startedAt: number | null = null): void {
  const next: DictationSession = { active, startedAt: active ? startedAt : null }
  if (next.active === dictationSession.active && next.startedAt === dictationSession.startedAt) return
  dictationSession = next
  for (const listener of dictationSessionListeners) listener()
}

export function getDictationSession(): DictationSession {
  return dictationSession
}

export function subscribeDictationSession(listener: () => void): () => void {
  dictationSessionListeners.add(listener)
  return () => dictationSessionListeners.delete(listener)
}

export function useDictationSession(): DictationSession {
  return useSyncExternalStore(subscribeDictationSession, getDictationSession, getDictationSession)
}

/**
 * The dictation strip lives outside the control but must drive the same capture
 * state machine. The mounted control (the dictation-ownership winner) registers
 * its toggle here; the strip calls {@link requestDictationToggle}.
 */
let dictationToggleHandler: (() => void) | null = null

/** Register the active control's toggle. Returns an unregister function. */
export function registerDictationToggle(handler: (() => void) | null): () => void {
  dictationToggleHandler = handler
  return () => {
    if (dictationToggleHandler === handler) dictationToggleHandler = null
  }
}

/** Ask the registered control to toggle capture; a no-op when none is mounted. */
export function requestDictationToggle(): void {
  dictationToggleHandler?.()
}

/** One request belongs to one composer; a later request or scope change expires it. */
export function createDictationRequestGuard() {
  let generation = 0
  let scope: string | undefined
  return {
    begin(sessionId: string | undefined) {
      scope = sessionId
      return ++generation
    },
    isCurrent(request: number, sessionId: string | undefined) {
      return request === generation && scope === sessionId
    },
    cancel() { generation += 1 },
  }
}

/** Append to the draft that exists when transcription finishes, preserving its whitespace. */
export function appendDictationTranscript(draft: string, transcript: string): string {
  const text = transcript.trim()
  if (!text) return draft
  return draft ? `${draft}${/\s$/.test(draft) ? '' : ' '}${text}` : text
}
