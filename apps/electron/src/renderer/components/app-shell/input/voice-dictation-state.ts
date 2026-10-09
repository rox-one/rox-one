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
