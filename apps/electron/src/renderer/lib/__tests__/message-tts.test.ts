import { describe, expect, it } from 'bun:test'
import { createMessageTts } from '../message-tts'

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
