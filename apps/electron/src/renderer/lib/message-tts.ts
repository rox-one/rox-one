/**
 * «Слушать» for chat messages.
 *
 * Order: native playback through the voice RPC (macOS `say` today) → Web
 * Speech API fallback when the host reports `playback: 'renderer'` or the RPC
 * fails. Previously the renderer awaited the RPC (a no-op stub) and then also
 * spoke via Web Speech, so on hosts where that worked it was the only path and
 * errors from the stub aborted it entirely.
 */

export type SpeakVoiceApi = (payload: { text?: string; stop?: boolean; status?: boolean }) => Promise<{
  playback?: 'native' | 'renderer' | 'none'
  speaking?: boolean
}>

export type SpeechSynthesisLike = {
  speak(utterance: unknown): void
  cancel(): void
}

export type MessageTtsDeps = {
  speakVoice?: SpeakVoiceApi
  synth?: SpeechSynthesisLike | null
  /** Build an utterance that calls `onEnd` when it finishes or errors. */
  createUtterance?: (text: string, onEnd: () => void) => unknown
  setInterval?: (fn: () => void, ms: number) => unknown
  clearInterval?: (id: unknown) => void
  pollMs?: number
}

export type MessageTtsPlayback = 'native' | 'web-speech' | 'unavailable'

export function createMessageTts(deps: MessageTtsDeps) {
  const setIntervalFn = deps.setInterval ?? ((fn, ms) => globalThis.setInterval(fn, ms))
  const clearIntervalFn = deps.clearInterval ?? ((id) => globalThis.clearInterval(id as ReturnType<typeof setInterval>))
  let poll: unknown = null
  let token = 0

  const clearPoll = () => {
    if (poll !== null) clearIntervalFn(poll)
    poll = null
  }

  const speakWeb = (text: string, onEnd: () => void): MessageTtsPlayback => {
    if (!deps.synth || !deps.createUtterance) return 'unavailable'
    deps.synth.cancel()
    deps.synth.speak(deps.createUtterance(text, onEnd))
    return 'web-speech'
  }

  return {
    /** Start speaking; `onEnd` fires once playback finishes or fails. */
    async speak(text: string, onEnd: () => void): Promise<MessageTtsPlayback> {
      const trimmed = text.trim()
      if (!trimmed) return 'unavailable'
      const mine = ++token
      clearPoll()
      deps.synth?.cancel()
      let native = false
      try {
        const result = await deps.speakVoice?.({ text: trimmed })
        native = result?.playback === 'native'
      } catch {
        native = false
      }
      if (mine !== token) return 'unavailable'
      if (native) {
        poll = setIntervalFn(() => {
          void deps.speakVoice?.({ status: true })
            .then((status) => {
              if (mine !== token || status?.speaking) return
              clearPoll()
              onEnd()
            })
            .catch(() => {
              clearPoll()
              onEnd()
            })
        }, deps.pollMs ?? 800)
        return 'native'
      }
      return speakWeb(trimmed, onEnd)
    },
    stop() {
      token += 1
      clearPoll()
      deps.synth?.cancel()
      void deps.speakVoice?.({ stop: true }).catch(() => undefined)
    },
  }
}
