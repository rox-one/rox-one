import { describe, expect, it } from 'bun:test'
import { createMessageTts, type MessageAudio, type SpeakVoiceApi } from '../message-tts'

function harness(playback: 'native' | 'renderer' | 'throw') {
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

  it('releases audio and falls back if client playback is rejected', async () => {
    const h = audioHarness({ play: async () => { throw new Error('autoplay blocked') } })
    expect(await h.tts.speak('hello', () => {})).toBe('web-speech')
    expect(h.disposed).toBe(1)
    expect(h.fallback).toBe(1)
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
    expect(ended).toBe(1)
  })

  it('falls back to Web Speech when the voice RPC fails', async () => {
    const h = harness('throw')
    expect(await h.tts.speak('hello', () => {})).toBe('web-speech')
    expect(h.spoken).toHaveLength(1)
  })

  it('stop() cancels both native and Web Speech playback', async () => {
    const h = harness('native')
    await h.tts.speak('hello', () => {})
    h.tts.stop()
    expect(h.calls.some((c) => c.stop === true)).toBe(true)
    expect(h.intervals).toHaveLength(0)
    expect(h.cancelled).toBeGreaterThan(0)
  })

  it('ignores empty text', async () => {
    const h = harness('native')
    expect(await h.tts.speak('   ', () => {})).toBe('unavailable')
    expect(h.calls).toHaveLength(0)
  })
})
