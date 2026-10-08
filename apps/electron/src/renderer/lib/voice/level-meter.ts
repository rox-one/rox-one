/**
 * Reusable microphone level meter.
 *
 * The analysis pipeline (fftSize 1024, time-domain RMS → dB → 0..1 clamp,
 * fast-attack/slow-decay smoothing) is the single source of truth for the
 * composer dictation wave and the meeting recorder, so both surfaces expose the
 * same perceptual level.
 *
 * The meter owns every resource it creates (a private `AudioContext` and the
 * analyser graph); it never touches the caller's stream tracks. Setup failures
 * degrade to an inert handle instead of throwing, so headless renderers and
 * browser fixtures stay safe.
 */
export interface VoiceLevelMeterOptions {
  driver?: 'frame' | 'interval'
  intervalMs?: number
}

export interface VoiceLevelMeterHandle {
  stop(): void
}

const FFT_SIZE = 1024
const MIN_RMS = 1e-6
const FLOOR_DB = -60
const WATCHDOG_INTERVAL_MS = 200
const STARVATION_MS = 350

type AudioContextCtor = typeof AudioContext

function audioContextCtor(): AudioContextCtor | null {
  const scope = globalThis as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor }
  return scope.AudioContext ?? scope.webkitAudioContext ?? null
}

/** Shared no-op handle for environments without Web Audio. */
const INERT_HANDLE: VoiceLevelMeterHandle = { stop() {} }

/** RMS → dB → clamped 0..1, matching the meeting recorder cadence exactly. */
function analyse(analyser: AnalyserNode, buf: Float32Array<ArrayBuffer>): number {
  analyser.getFloatTimeDomainData(buf)
  let sum = 0
  for (let index = 0; index < buf.length; index += 1) sum += buf[index]! * buf[index]!
  const rms = Math.sqrt(sum / buf.length)
  // perceptual-ish: -60 dB → 0, 0 dB → 1
  const db = 20 * Math.log10(Math.max(rms, MIN_RMS))
  return Math.min(1, Math.max(0, (db - FLOOR_DB) / -FLOOR_DB))
}

export function createVoiceLevelMeter(
  stream: MediaStream,
  onLevel: (level: number) => void,
  options: VoiceLevelMeterOptions = {},
): VoiceLevelMeterHandle {
  const driver = options.driver ?? 'frame'
  const intervalMs = options.intervalMs ?? 100

  let ctx: AudioContext | null = null
  let source: MediaStreamAudioSourceNode | null = null
  let analyser: AnalyserNode | null = null
  let buf: Float32Array<ArrayBuffer> | null = null
  try {
    const Ctor = audioContextCtor()
    if (!Ctor) return INERT_HANDLE
    ctx = new Ctor()
    source = ctx.createMediaStreamSource(stream)
    analyser = ctx.createAnalyser()
    analyser.fftSize = FFT_SIZE
    source.connect(analyser)
    buf = new Float32Array(analyser.fftSize)
  } catch {
    try { void ctx?.close().catch(() => {}) } catch { /* unavailable AudioContext */ }
    return INERT_HANDLE
  }

  let stopped = false
  let smooth = 0
  let lastFrameAt = 0
  const cancels: Array<() => void> = []

  const emit = (): void => {
    if (stopped || !analyser || !buf) return
    try {
      const level = analyse(analyser, buf)
      smooth = level > smooth ? level : smooth * 0.8 + level * 0.2
      onLevel(Math.round(smooth * 100) / 100)
    } catch {
      // A broken analyser must never break the emission loop.
    }
  }

  const schedule = typeof globalThis.requestAnimationFrame === 'function'
    ? globalThis.requestAnimationFrame.bind(globalThis)
    : null
  const cancelFrame = typeof globalThis.cancelAnimationFrame === 'function'
    ? globalThis.cancelAnimationFrame.bind(globalThis)
    : null

  try {
    if (driver === 'interval' || !schedule) {
      const interval = setInterval(emit, intervalMs)
      cancels.push(() => clearInterval(interval))
    } else {
      const frameHandle = { current: 0 }
      const frame = (): void => {
        if (stopped) return
        lastFrameAt = Date.now()
        emit()
        frameHandle.current = schedule(frame)
      }
      frameHandle.current = schedule(frame)
      cancels.push(() => { if (frameHandle.current) cancelFrame?.(frameHandle.current) })
      // When the window is minimized/unfocused rAF starves; the watchdog keeps
      // the overlay wave alive without ever double-emitting on a live frame.
      const watchdog = setInterval(() => {
        if (stopped) return
        if (Date.now() - lastFrameAt > STARVATION_MS) emit()
      }, WATCHDOG_INTERVAL_MS)
      cancels.push(() => clearInterval(watchdog))
    }
  } catch {
    // Scheduling failure degrades to a silent meter; teardown still succeeds.
  }

  return {
    stop(): void {
      if (stopped) return
      stopped = true
      for (const cancel of cancels.splice(0)) cancel()
      try { source?.disconnect() } catch { /* already detached */ }
      try { analyser?.disconnect() } catch { /* already detached */ }
      source = null
      analyser = null
      buf = null
      const owned = ctx
      ctx = null
      try { void owned?.close().catch(() => {}) } catch { /* already closed */ }
    },
  }
}