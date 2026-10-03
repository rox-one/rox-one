/**
 * «Слушать» for chat messages.
 *
 * Play the RPC's selected engine on this client. Browser speech requires an
 * explicit renderer response; a failed or refused request never selects it.
 */

export type SpeakVoiceResult = {
  playback?: 'audio' | 'native' | 'renderer' | 'none'
  audioBase64?: string
  mimeType?: 'audio/mpeg'
  textSent?: boolean
  textTransmission?: 'not-sent' | 'possible' | 'sent'
  speaking?: boolean
  voice?: string
  reason?: string
}
export type SpeakVoiceApi = (payload: { text?: string; stop?: boolean; status?: boolean }) => Promise<SpeakVoiceResult>

export type MessageAudio = {
  play(): Promise<void>
  pause(): void
  onended: (() => void) | null
  onerror: (() => void) | null
  dispose(): void
}

function createBrowserAudio(base64: string, mimeType: string): MessageAudio {
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
  const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }))
  let audio: HTMLAudioElement
  try { audio = new Audio(url) } catch (error) {
    URL.revokeObjectURL(url)
    throw error
  }
  let disposed = false
  return {
    play: () => audio.play(),
    pause: () => audio.pause(),
    get onended() { return audio.onended as (() => void) | null },
    set onended(fn) { audio.onended = fn },
    get onerror() { return audio.onerror as (() => void) | null },
    set onerror(fn) { audio.onerror = fn },
    dispose() {
      if (disposed) return
      disposed = true
      audio.onended = null
      audio.onerror = null
      audio.removeAttribute('src')
      try { audio.load() } finally { URL.revokeObjectURL(url) }
    },
  }
}

export type SpeechSynthesisLike = {
  speak(utterance: unknown): void
  cancel(): void
}

export type MessageTtsDeps = {
  speakVoice?: SpeakVoiceApi
  synth?: SpeechSynthesisLike | null
  /** Build an utterance that calls `onEnd` when it finishes or errors. */
  createUtterance?: (text: string, onEnd: () => void) => unknown
  createAudio?: (base64: string, mimeType: string) => MessageAudio
  setInterval?: (fn: () => void, ms: number) => unknown
  clearInterval?: (id: unknown) => void
  pollMs?: number
}

export type MessageTtsPlayback = 'audio' | 'native' | 'web-speech' | 'unavailable'

export function createMessageTts(deps: MessageTtsDeps) {
  const setIntervalFn = deps.setInterval ?? ((fn, ms) => globalThis.setInterval(fn, ms))
  const clearIntervalFn = deps.clearInterval ?? ((id) => globalThis.clearInterval(id as ReturnType<typeof setInterval>))
  let poll: unknown = null
  let token = 0
  let requestTail: Promise<void> | null = null
  let audio: MessageAudio | null = null

  const clearAudio = () => {
    const previous = audio
    audio = null
    if (!previous) return
    previous.onended = null
    previous.onerror = null
    try { previous.pause() } finally { previous.dispose() }
  }

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
      clearAudio()
      deps.synth?.cancel()
      const previous = requestTail
      const {promise, resolve: finishRequest} = Promise.withResolvers<void>()
      requestTail = promise
      if (previous) await previous
      try {
        if (mine !== token) return 'unavailable'
        let ended = false
        const finish = () => {
          if (mine !== token || ended) return
          ended = true
          clearPoll()
          clearAudio()
          onEnd()
        }
        let result: SpeakVoiceResult | undefined
        try {
          result = await deps.speakVoice?.({ text: trimmed })
        } catch { return 'unavailable' }
        if (mine !== token) {
          if (result?.playback === 'native') await deps.speakVoice?.({ stop: true }).catch(() => undefined)
          return 'unavailable'
        }
        if (result?.playback === 'none') return 'unavailable'
        if (result?.playback === 'audio') {
          if (!result.audioBase64 || result.mimeType && result.mimeType !== 'audio/mpeg') return 'unavailable'
          const createAudio = deps.createAudio ?? (typeof Audio !== 'undefined' ? createBrowserAudio : undefined)
          if (!createAudio) return 'unavailable'
          try {
            audio = createAudio(result.audioBase64, result.mimeType ?? 'audio/mpeg')
            audio.onended = finish
            audio.onerror = finish
            await audio.play()
            if (mine !== token || ended) return 'unavailable'
            return 'audio'
          } catch {
            if (mine === token) clearAudio()
            return 'unavailable'
          }
        }
        if (result?.playback === 'native') {
          poll = setIntervalFn(() => {
            void deps.speakVoice?.({ status: true })
              .then((status) => {
                if (mine !== token || status?.speaking) return
                finish()
              })
              .catch(() => { finish() })
          }, deps.pollMs ?? 800)
          return 'native'
        }
        return result?.playback === 'renderer' ? speakWeb(trimmed, finish) : 'unavailable'
      } finally { finishRequest() }
    },
    stop() {
      token += 1
      clearPoll()
      clearAudio()
      deps.synth?.cancel()
      void deps.speakVoice?.({ stop: true }).catch(() => undefined)
    },
  }
}
