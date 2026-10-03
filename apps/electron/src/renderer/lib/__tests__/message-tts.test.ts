import { describe, expect, it } from 'bun:test'
import { createMessageTts, type MessageAudio, type SpeakVoiceApi } from '../message-tts'

function harness(playback: 'native' | 'renderer' | 'none' | 'throw') {
  const calls: Array<Record<string, unknown>> = []
  let speaking = true
  const intervals: Array<() => void> = []
  const spoken: string[] = []
  let cancelled = 0
  const utterances: Array<{ onend: (() => void) | null; onerror: (() => void) | null }> = []
  const tts = createMessageTts({
    speakVoice: async (payload) => {
      calls.push(payload)
      if (payload.status) return { playback: 'none', speaking }
      if (payload.stop) return { playback: 'none' }
      if (playback === 'throw') throw new Error('no engine')
      return { playback }
    },
    synth: { speak: () => { spoken.push('x') }, cancel: () => { cancelled += 1 } },
    createUtterance: (text, onEnd) => {
      const u = { text, onend: onEnd as (() => void) | null, onerror: onEnd as (() => void) | null }
      utterances.push(u)
      return u
    },
    setInterval: (fn) => { intervals.push(fn); return intervals.length },
    clearInterval: () => { intervals.length = 0 },
  })
  return { tts, calls, intervals, spoken, utterances, get cancelled() { return cancelled }, setSpeaking: (v: boolean) => { speaking = v } }
}

describe('message TTS', () => {
  function audioHarness(overrides: { speakVoice?: SpeakVoiceApi; play?: () => Promise<void> } = {}) {
    let paused = 0
    let disposed = 0
    let fallback = 0
    const audio: MessageAudio = {
      play: overrides.play ?? (async () => {}), pause() { paused++ }, dispose() { disposed++ }, onended: null, onerror: null,
    }
    const tts = createMessageTts({
      speakVoice: overrides.speakVoice ?? (async (payload) => payload.stop ? { playback: 'none' } : { playback: 'audio', audioBase64: 'bXAz', mimeType: 'audio/mpeg' }),
      createAudio: (base64, mimeType) => { expect(base64).toBe('bXAz'); expect(mimeType).toBe('audio/mpeg'); return audio },
      synth: { cancel() {}, speak() { fallback++ } },
      createUtterance: (text) => text,
    })
    return { tts, audio, get paused() { return paused }, get disposed() { return disposed }, get fallback() { return fallback } }
  }

  it('plays Edge MP3, releases it on completion and only calls onEnd once', async () => {
    const h = audioHarness()
    let ended = 0
    expect(await h.tts.speak('Привет', () => { ended++ })).toBe('audio')
    const callback = h.audio.onended!
    callback()
    callback()
    expect(ended).toBe(1)
    expect(h.disposed).toBe(1)
    expect(h.fallback).toBe(0)
  })

  it('stops audio and releases its resources', async () => {
    const h = audioHarness()
    let ended = 0
    await h.tts.speak('hello', () => { ended++ })
    const staleEnd = h.audio.onended!
    h.tts.stop()
    staleEnd()
    expect(h.paused).toBe(1)
    expect(h.disposed).toBe(1)
    expect(ended).toBe(0)
  })

  it('releases rejected audio without silently selecting browser speech', async () => {
    const h = audioHarness({ play: async () => { throw new Error('autoplay blocked') } })
    expect(await h.tts.speak('hello', () => {})).toBe('unavailable')
    expect(h.disposed).toBe(1)
    expect(h.fallback).toBe(0)
  })

  it('does not play a late synthesis response after stop', async () => {
    let resolve!: (result: Awaited<ReturnType<SpeakVoiceApi>>) => void
    const h = audioHarness({ speakVoice: (payload) => payload.stop ? Promise.resolve({ playback: 'none' }) : new Promise((done) => { resolve = done }) })
    const pending = h.tts.speak('hello', () => {})
    h.tts.stop()
    resolve({ playback: 'audio', audioBase64: 'bXAz', mimeType: 'audio/mpeg' })
    expect(await pending).toBe('unavailable')
    expect(h.disposed).toBe(0)
    expect(h.fallback).toBe(0)
  })

  it('honors cancellation from the host without starting Web Speech', async () => {
    const h = audioHarness({ speakVoice: async () => ({ playback: 'none' }) })
    expect(await h.tts.speak('hello', () => {})).toBe('unavailable')
    expect(h.fallback).toBe(0)
  })

  it('does not select browser speech for an incomplete or unspecified RPC result', async () => {
    for (const result of [{}, { playback: 'audio' as const }, { playback: 'audio' as const, audioBase64: 'bXAz', mimeType: 'text/plain' }]) {
      const h = audioHarness({ speakVoice: async () => result as Awaited<ReturnType<SpeakVoiceApi>> })
      expect(await h.tts.speak('hello', () => {})).toBe('unavailable')
      expect(h.fallback).toBe(0)
      expect(h.disposed).toBe(0)
    }
  })

  it('cancels pending client playback and ignores its late completion', async () => {
    const { promise, resolve } = Promise.withResolvers<void>()
    const { promise: started, resolve: markStarted } = Promise.withResolvers<void>()
    const h = audioHarness({ play: () => { markStarted(); return promise } })
    let ended = 0
    const pending = h.tts.speak('hello', () => { ended++ })
    await started
    const staleEnd = h.audio.onended!
    h.tts.stop()
    resolve()
    expect(await pending).toBe('unavailable')
    staleEnd()
    expect(h.disposed).toBe(1)
    expect(h.paused).toBe(1)
    expect(h.fallback).toBe(0)
    expect(ended).toBe(0)
  })

  it('releases replaced audio once and an old event cannot finish the new turn', async () => {
    const audios: MessageAudio[] = []
    const disposed: number[] = []
    const tts = createMessageTts({
      speakVoice: async () => ({ playback: 'audio', audioBase64: 'bXAz' }),
      createAudio: () => {
        const index = audios.length
        disposed.push(0)
        const value: MessageAudio = { play: async () => {}, pause() {}, dispose() { disposed[index]!++ }, onended: null, onerror: null }
        audios.push(value)
        return value
      },
    })
    let firstEnded = 0, secondEnded = 0
    await tts.speak('A', () => { firstEnded++ })
    const stale = audios[0]!.onended!
    await tts.speak('B', () => { secondEnded++ })
    stale()
    expect(disposed).toEqual([1, 0])
    expect(firstEnded).toBe(0)
    expect(secondEnded).toBe(0)
    const finish = audios[1]!.onended!
    finish(); finish(); tts.stop()
    expect(disposed).toEqual([1, 1])
    expect(secondEnded).toBe(1)
  })

  it('revokes a Blob URL when constructing browser audio fails', async () => {
    const originalAudio = globalThis.Audio
    const originalCreate = URL.createObjectURL
    const originalRevoke = URL.revokeObjectURL
    const revoked: string[] = []
    try {
      globalThis.Audio = class { constructor() { throw new Error('audio unavailable') } } as unknown as typeof Audio
      URL.createObjectURL = () => 'blob:fixture'
      URL.revokeObjectURL = (value) => { revoked.push(value) }
      const tts = createMessageTts({ speakVoice: async () => ({ playback: 'audio', audioBase64: 'bXAz' }) })
      expect(await tts.speak('hello', () => {})).toBe('unavailable')
      expect(revoked).toEqual(['blob:fixture'])
    } finally {
      globalThis.Audio = originalAudio
      URL.createObjectURL = originalCreate
      URL.revokeObjectURL = originalRevoke
    }
  })

  it('uses native playback when the host speaks and reports the end via polling', async () => {
    const h = harness('native')
    let ended = 0
    expect(await h.tts.speak('Привет', () => { ended += 1 })).toBe('native')
    expect(h.spoken).toEqual([])
    h.setSpeaking(false)
    h.intervals[0]!()
    await new Promise((r) => setTimeout(r, 0))
    expect(ended).toBe(1)
  })

  it('falls back to Web Speech when the host cannot play audio', async () => {
    const h = harness('renderer')
    let ended = 0
    expect(await h.tts.speak('hello', () => { ended += 1 })).toBe('web-speech')
    expect(h.spoken).toHaveLength(1)
    h.utterances[0]!.onend?.()
    h.utterances[0]!.onerror?.()
    expect(ended).toBe(1)
  })

  it('does not start Web Speech when the local speech RPC fails', async () => {
    const h = harness('throw')
    expect(await h.tts.speak('hello', () => {})).toBe('unavailable')
    expect(h.spoken).toHaveLength(0)
  })
  it('does not hide unavailable local Russian speech behind browser fallback', async () => {
    const h = harness('none')
    expect(await h.tts.speak('Привет', () => {})).toBe('unavailable')
    expect(h.spoken).toHaveLength(0)
  })

  it('stop() cancels both native and Web Speech playback', async () => {
    const h = harness('native')
    await h.tts.speak('hello', () => {})
    h.tts.stop()
    expect(h.calls.some((c) => c.stop === true)).toBe(true)
    expect(h.intervals).toHaveLength(0)
    expect(h.cancelled).toBeGreaterThan(0)
  })
  it('stops a late native start before allowing a newer message to speak', async () => {
    const calls: Array<Record<string, unknown>> = []
    const { promise, resolve } = Promise.withResolvers<{ playback: 'native' | 'none' }>()
    const { promise: started, resolve: markStarted } = Promise.withResolvers<void>()
    let finishFirst = resolve
    const tts = createMessageTts({
      speakVoice: (payload) => {
        calls.push(payload)
        if (payload.text === 'A') { markStarted(); return promise }
        return Promise.resolve({ playback: payload.text === 'B' ? 'native' : 'none' })
      },
      setInterval: () => 1,
      clearInterval: () => {},
    })
    const first = tts.speak('A', () => {})
    await started
    tts.stop()
    const second = tts.speak('B', () => {})
    // B must wait until the late native A response has been stopped.
    expect(calls.filter((call) => typeof call.text === 'string').map((call) => call.text)).toEqual(['A'])
    finishFirst({ playback: 'native' })
    expect(await first).toBe('unavailable')
    expect(await second).toBe('native')
    const starts = calls.filter((call) => typeof call.text === 'string').map((call) => call.text)
    expect(starts).toEqual(['A', 'B'])
    expect(calls.filter((call) => call.stop === true)).toHaveLength(2)
    expect(calls.map((call) => call.text ?? (call.stop ? 'stop' : 'status'))).toEqual(['A', 'stop', 'stop', 'B'])
  })

  it('ignores empty text', async () => {
    const h = harness('native')
    expect(await h.tts.speak('   ', () => {})).toBe('unavailable')
    expect(h.calls).toHaveLength(0)
  })
})
