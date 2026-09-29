import { describe, expect, it } from 'bun:test'
import { createMessageTts } from '../message-tts'

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
