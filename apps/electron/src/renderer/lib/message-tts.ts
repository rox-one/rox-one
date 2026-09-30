/**
 * «Слушать» for chat messages.
 *
 * Order: native playback through the voice RPC (macOS `say` today) → Web
 * Speech API fallback when the host reports `playback: 'renderer'` or the RPC
 * fails. Previously the renderer awaited the RPC (a no-op stub) and then also
 * spoke via Web Speech, so on hosts where that worked it was the only path and
 * errors from the stub aborted it entirely.
 */

export type SpeakVoiceResult = {
  playback?: 'native' | 'renderer' | 'none'
  speaking?: boolean
  voice?: string
  reason?: string
}

export type SpeakVoiceApi = (payload: { text?: string; stop?: boolean; status?: boolean }) => Promise<SpeakVoiceResult>
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
  // Serialize starts through the RPC. If an old request resolves after Stop,
  // it is stopped before a newer utterance is allowed to start.
  let requestTail: Promise<void> = Promise.resolve()
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

      const previous = requestTail
      const { promise, resolve: finish } = Promise.withResolvers<void>()
      requestTail = promise
      await previous
      let ended = false
      const finishPlayback = () => {
        if (ended || mine !== token) return
        ended = true
        onEnd()
      }
      try {
        if (mine !== token) return 'unavailable'
        let result: SpeakVoiceResult | undefined
        try {
          result = await deps.speakVoice?.({ text: trimmed })
        } catch {
          result = undefined
        }
        if (mine !== token) {
          if (result?.playback === 'native') {
            await deps.speakVoice?.({ stop: true }).catch(() => undefined)
          }
          return 'unavailable'
        }
        if (result?.playback === 'native') {
          poll = setIntervalFn(() => {
            void deps.speakVoice?.({ status: true })
              .then((status) => {
                if (mine !== token || status?.speaking) return
                clearPoll()
                finishPlayback()
              })
              .catch(() => {
                clearPoll()
                finishPlayback()
              })
          }, deps.pollMs ?? 800)
          return 'native'
        }
        return result?.playback === 'renderer'
          ? speakWeb(trimmed, finishPlayback)
          : 'unavailable'
      } finally {
        finish()
      }
    },
    stop() {
      token += 1
      clearPoll()
      deps.synth?.cancel()
      void deps.speakVoice?.({ stop: true }).catch(() => undefined)
    },
  }
}
