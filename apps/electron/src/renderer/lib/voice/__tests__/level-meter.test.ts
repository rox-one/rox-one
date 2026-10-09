import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test'
import { createVoiceLevelMeter } from '../level-meter'

type Recorder = { emissions: number[]; closeCalls: number; setSample: (value: number, count?: number) => void; uninstall: () => void }

/**
 * Host globals this suite patches: a headless bun test has no AudioContext or
 * rAF, so they are installed/deleted per case. `unknown` because the real
 * declarations are DOM-lib typed and we assign structural fakes.
 */
const globals = globalThis as { AudioContext?: unknown; requestAnimationFrame?: unknown; cancelAnimationFrame?: unknown }

function installAudioContext(): Recorder {
  let sample = 0
  let sampleCount = 4
  let closed = 0
  const emissions: number[] = []
  const analyser = {
    fftSize: 0,
    getFloatTimeDomainData(buf: Float32Array) {
      buf.fill(0)
      for (let i = 0; i < sampleCount && i < buf.length; i += 1) buf[i] = sample
    },
    connect() {},
    disconnect() {},
  }
  class FakeAudioContext {
    createMediaStreamSource() { return { connect() {}, disconnect() {} } }
    createAnalyser() { return analyser }
    close() { closed += 1; return Promise.resolve() }
  }
  globals.AudioContext = FakeAudioContext
  return {
    emissions,
    get closeCalls() { return closed },
    setSample: (value, count = 4) => { sample = value; sampleCount = count },
    uninstall: () => { delete globals.AudioContext },
  }
}

function fakeStream(): { stream: MediaStream; trackStops: () => number } {
  let stops = 0
  const stream = {
    getTracks: () => [{ stop: () => { stops += 1 }, kind: 'audio' }],
  } as unknown as MediaStream
  return { stream, trackStops: () => stops }
}

let restoreRaf: (() => void) | null = null

function installRaf(callbacks: FrameRequestCallback[]): void {
  const previousRaf = globals.requestAnimationFrame
  const previousCancel = globals.cancelAnimationFrame
  globals.requestAnimationFrame = (cb: FrameRequestCallback) => { callbacks.push(cb); return callbacks.length }
  globals.cancelAnimationFrame = () => {}
  restoreRaf = () => {
    if (previousRaf === undefined) delete globals.requestAnimationFrame
    else globals.requestAnimationFrame = previousRaf
    if (previousCancel === undefined) delete globals.cancelAnimationFrame
    else globals.cancelAnimationFrame = previousCancel
  }
}

beforeEach(() => { jest.useFakeTimers() })

afterEach(() => {
  jest.useRealTimers()
  restoreRaf?.()
  restoreRaf = null
  delete globals.AudioContext
  delete globals.requestAnimationFrame
  delete globals.cancelAnimationFrame
})

describe('voice level meter', () => {
  test('maps RMS to the same 0..1 curve as the meeting recorder', () => {
    const cases: Array<{ sample: number; expected: number }> = [
      { sample: 1e-5, expected: 0 },
      { sample: 0.01, expected: 0 },
      { sample: 0.04, expected: 0.13 },
      { sample: 0.32, expected: 0.43 },
      { sample: 0.8, expected: 0.57 },
    ]
    for (const { sample, expected } of cases) {
      const recorder = installAudioContext()
      const { stream } = fakeStream()
      const meter = createVoiceLevelMeter(stream, level => recorder.emissions.push(level), { driver: 'interval', intervalMs: 100 })
      recorder.setSample(sample)
      jest.advanceTimersByTime(100)
      expect(recorder.emissions).toEqual([expected])
      meter.stop()
      recorder.uninstall()
    }
  })

  test('decays toward silence instead of snapping', () => {
    const recorder = installAudioContext()
    const { stream } = fakeStream()
    const meter = createVoiceLevelMeter(stream, level => recorder.emissions.push(level), { driver: 'interval', intervalMs: 100 })
    recorder.setSample(0.8)
    jest.advanceTimersByTime(100)
    recorder.setSample(0)
    jest.advanceTimersByTime(100)
    expect(recorder.emissions).toEqual([0.57, 0.45])
    meter.stop()
    recorder.uninstall()
  })

  test('honours the interval driver cadence', () => {
    const recorder = installAudioContext()
    const { stream } = fakeStream()
    const meter = createVoiceLevelMeter(stream, level => recorder.emissions.push(level), { driver: 'interval', intervalMs: 100 })
    jest.advanceTimersByTime(99)
    expect(recorder.emissions).toHaveLength(0)
    jest.advanceTimersByTime(1)
    expect(recorder.emissions).toHaveLength(1)
    jest.advanceTimersByTime(150)
    expect(recorder.emissions).toHaveLength(2)
    jest.advanceTimersByTime(2850)
    expect(recorder.emissions).toHaveLength(31)
    meter.stop()
    recorder.uninstall()
  })

  test('keeps emitting when animation frames starve', () => {
    const recorder = installAudioContext()
    const { stream } = fakeStream()
    const frames: FrameRequestCallback[] = []
    installRaf(frames)
    const meter = createVoiceLevelMeter(stream, level => recorder.emissions.push(level))
    expect(frames).toHaveLength(1)
    frames.shift()!(0)
    expect(recorder.emissions).toEqual([0])
    jest.advanceTimersByTime(200)
    expect(recorder.emissions).toHaveLength(1)
    jest.advanceTimersByTime(200)
    expect(recorder.emissions).toHaveLength(2)
    frames.shift()!(0)
    expect(recorder.emissions).toHaveLength(3)
    jest.advanceTimersByTime(200)
    expect(recorder.emissions).toHaveLength(3)
    meter.stop()
    recorder.uninstall()
  })

  test('stops idempotently without touching stream tracks', () => {
    const recorder = installAudioContext()
    const { stream, trackStops } = fakeStream()
    const meter = createVoiceLevelMeter(stream, level => recorder.emissions.push(level), { driver: 'interval', intervalMs: 100 })
    jest.advanceTimersByTime(100)
    expect(recorder.emissions).toHaveLength(1)
    meter.stop()
    meter.stop()
    jest.advanceTimersByTime(1000)
    expect(recorder.emissions).toHaveLength(1)
    expect(recorder.closeCalls).toBe(1)
    expect(trackStops()).toBe(0)
    recorder.uninstall()
  })

  test('degrades to an inert handle without AudioContext', () => {
    const { stream, trackStops } = fakeStream()
    const emissions: number[] = []
    const meter = createVoiceLevelMeter(stream, level => emissions.push(level), { driver: 'interval', intervalMs: 100 })
    jest.advanceTimersByTime(1000)
    expect(emissions).toHaveLength(0)
    expect(() => meter.stop()).not.toThrow()
    expect(trackStops()).toBe(0)
  })

  test('stop is safe when cancelAnimationFrame is unavailable', () => {
    const recorder = installAudioContext()
    const { stream } = fakeStream()
    installRaf([])
    delete globals.cancelAnimationFrame
    const meter = createVoiceLevelMeter(stream, level => recorder.emissions.push(level))
    expect(() => meter.stop()).not.toThrow()
    expect(recorder.closeCalls).toBe(1)
    recorder.uninstall()
  })
})