/**
 * App-wide meeting recorder (module singleton, survives screen changes).
 * Microphone → MediaRecorder (webm/opus, 1 s slices) → chunks appended to
 * `<meeting>/audio.part.webm` by main. Stop remuxes the file and queues the
 * local whisper.cpp transcript. Nothing is uploaded.
 */
import { useSyncExternalStore } from 'react'
import type { LocalMeeting, MeetingsLocalApi } from '../../../shared/meetings-local'
import { toErrorMessage } from '@/lib/errors'

export type RecorderStatus = 'idle' | 'starting' | 'recording' | 'paused' | 'stopping'

export interface RecorderState {
  status: RecorderStatus
  meetingId: string | null
  title: string
  /** Accumulated recorded time before the current run segment. */
  accumulatedMs: number
  /** performance-independent wall clock of the current run start (null when paused/idle). */
  runningSince: number | null
  /** 0..1 input level (RMS, smoothed). */
  level: number
  error: string | null
}

const IDLE: RecorderState = { status: 'idle', meetingId: null, title: '', accumulatedMs: 0, runningSince: null, level: 0, error: null }

let state: RecorderState = IDLE
const listeners = new Set<() => void>()

function set(patch: Partial<RecorderState>): void {
  state = { ...state, ...patch }
  for (const l of listeners) l()
}

export function getRecorderState(): RecorderState {
  return state
}

export function subscribeRecorder(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useRecorder(): RecorderState {
  return useSyncExternalStore(subscribeRecorder, getRecorderState, getRecorderState)
}

export function recordedMs(s: RecorderState = state, now = Date.now()): number {
  return s.accumulatedMs + (s.runningSince != null ? Math.max(0, now - s.runningSince) : 0)
}

export function isRecorderBusy(s: RecorderState = state): boolean {
  return s.status !== 'idle'
}

export function meetingsApi(): MeetingsLocalApi | null {
  if (typeof window === 'undefined') return null
  return window.electronAPI?.meetingsLocal ?? null
}

type Session = {
  api: MeetingsLocalApi
  meetingId: string
  stream: MediaStream
  recorder: MediaRecorder
  audioCtx: AudioContext | null
  meter: ReturnType<typeof setInterval> | null
  heartbeat: ReturnType<typeof setInterval> | null
  chain: Promise<unknown>
  failedChunks: number
  failureCode: string | null
}

let session: Session | null = null

function pickMimeType(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']
  for (const c of candidates) {
    try {
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c)) return c
    } catch {
      // ignore
    }
  }
  return ''
}

function startMeter(s: Session): void {
  try {
    const ctx = new AudioContext()
    const source = ctx.createMediaStreamSource(s.stream)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 1024
    source.connect(analyser)
    const buf = new Float32Array(analyser.fftSize)
    s.audioCtx = ctx
    let smooth = 0
    s.meter = setInterval(() => {
      if (state.status !== 'recording') {
        if (state.level !== 0) set({ level: 0 })
        return
      }
      analyser.getFloatTimeDomainData(buf)
      let sum = 0
      for (let i = 0; i < buf.length; i += 1) sum += buf[i]! * buf[i]!
      const rms = Math.sqrt(sum / buf.length)
      // perceptual-ish: -60 dB → 0, 0 dB → 1
      const db = 20 * Math.log10(Math.max(rms, 1e-6))
      const v = Math.min(1, Math.max(0, (db + 60) / 60))
      smooth = v > smooth ? v : smooth * 0.8 + v * 0.2
      set({ level: Math.round(smooth * 100) / 100 })
    }, 100)
  } catch {
    // level meter is cosmetic
  }
}

function teardown(s: Session): void {
  if (s.meter) clearInterval(s.meter)
  if (s.heartbeat) clearInterval(s.heartbeat)
  s.stream.getTracks().forEach((track) => track.stop())
  void s.audioCtx?.close().catch(() => {})
}
async function stopMediaRecorder(recorder: MediaRecorder): Promise<void> {
  if (recorder.state === 'inactive') return
  await new Promise<void>((resolve) => {
    recorder.addEventListener('stop', () => resolve(), { once: true })
    try {
      recorder.stop()
    } catch {
      resolve()
    }
  })
}


export type StartResult = { ok: true; meeting: LocalMeeting } | { ok: false; code: string }

export async function startRecording(input: { meetingId?: string; title: string; workspaceId: string | null }): Promise<StartResult> {
  const api = meetingsApi()
  if (!api) return { ok: false, code: 'unavailable' }
  if (session || state.status !== 'idle') return { ok: false, code: 'already-recording' }
  set({ ...IDLE, status: 'starting', title: input.title })
  let stream: MediaStream | null = null
  let startedMeetingId: string | null = null
  try {
    const access = await api.micAccess(true)
    if (access === 'denied' || access === 'restricted') {
      set({ ...IDLE, error: 'mic-denied' })
      return { ok: false, code: 'mic-denied' }
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true, channelCount: 1 },
      })
    } catch (error) {
      const code = error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError') ? 'mic-denied' : 'mic-unavailable'
      set({ ...IDLE, error: code })
      return { ok: false, code }
    }
    const mimeType = pickMimeType()
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType, audioBitsPerSecond: 64_000 } : undefined)
    const started = await api.recStart({ meetingId: input.meetingId, title: input.title, workspaceId: input.workspaceId, mimeType: recorder.mimeType || mimeType || 'audio/webm' })
    if (!started.ok) {
      stream.getTracks().forEach((track) => track.stop())
      stream = null
      set({ ...IDLE, error: started.code })
      return { ok: false, code: started.code }
    }
    startedMeetingId = started.value.id
    const s: Session = { api, meetingId: started.value.id, stream, recorder, audioCtx: null, meter: null, heartbeat: null, chain: Promise.resolve(), failedChunks: 0, failureCode: null }
    session = s
    stream = null
    recorder.ondataavailable = (event) => {
      if (!event.data || event.data.size === 0) return
      const blob = event.data
      s.chain = s.chain.then(async () => {
        try {
          const bytes = new Uint8Array(await blob.arrayBuffer())
          if (!await api.recChunk(s.meetingId, bytes)) {
            s.failedChunks += 1
            s.failureCode ??= 'recording-save-failed'
          }
        } catch {
          s.failedChunks += 1
          s.failureCode ??= 'recording-save-failed'
        }
      })
    }
    recorder.onerror = () => {
      s.failureCode ??= 'mic-unavailable'
      if (session === s && (state.status === 'recording' || state.status === 'paused')) void stopRecording()
    }
    // A mic unplugged mid-meeting ends the track: preserve the recording, but
    // report that capture was interrupted rather than claiming a clean stop.
    s.stream.getAudioTracks().forEach((track) => {
      track.onended = () => {
        if (session !== s || (state.status !== 'recording' && state.status !== 'paused')) return
        s.failureCode ??= 'mic-unavailable'
        void stopRecording()
      }
    })
    recorder.start(1000)
    startMeter(s)
    s.heartbeat = setInterval(() => {
      void api.recState(s.meetingId, { paused: state.status === 'paused', durationMs: recordedMs() }).catch(() => {})
    }, 5000)
    set({ status: 'recording', meetingId: s.meetingId, title: started.value.title, accumulatedMs: 0, runningSince: Date.now(), error: null })
    return { ok: true, meeting: started.value }
  } catch (error) {
    const active = session
    if (active) {
      await stopMediaRecorder(active.recorder)
      await active.chain
      teardown(active)
      session = null
      if (startedMeetingId) {
        await active.api.recStop(startedMeetingId, { durationMs: recordedMs() }).catch(() => {})
      }
    }
    stream?.getTracks().forEach((track) => track.stop())
    set({ ...IDLE, error: toErrorMessage(error) })
    return { ok: false, code: 'start-failed' }
  }
}

export function pauseRecording(): void {
  const s = session
  if (!s || state.status !== 'recording') return
  try { s.recorder.pause() } catch { return }
  set({ status: 'paused', accumulatedMs: recordedMs(), runningSince: null, level: 0 })
  void s.api.recState(s.meetingId, { paused: true, durationMs: state.accumulatedMs }).catch(() => {})
}

export function resumeRecording(): void {
  const s = session
  if (!s || state.status !== 'paused') return
  try { s.recorder.resume() } catch { return }
  set({ status: 'recording', runningSince: Date.now() })
  void s.api.recState(s.meetingId, { paused: false, durationMs: state.accumulatedMs }).catch(() => {})
}

export async function stopRecording(): Promise<{ ok: true; meeting: LocalMeeting } | { ok: false; code: string }> {
  const s = session
  if (!s || (state.status !== 'recording' && state.status !== 'paused')) return { ok: false, code: 'not-recording' }
  const durationMs = recordedMs()
  set({ status: 'stopping', accumulatedMs: durationMs, runningSince: null, level: 0 })
  await stopMediaRecorder(s.recorder)
  await s.chain
  if (s.failedChunks > 0) s.failureCode ??= 'recording-save-failed'
  teardown(s)
  session = null
  const result = await s.api.recStop(s.meetingId, { durationMs }).catch((error: unknown) => ({ ok: false as const, code: error instanceof Error ? error.message : 'stop-failed' }))
  if (!result.ok) {
    set({ ...IDLE, error: result.code })
    return { ok: false, code: result.code }
  }
  if (s.failureCode) {
    set({ ...IDLE, error: s.failureCode })
    return { ok: false, code: s.failureCode }
  }
  set({ ...IDLE, error: null })
  return { ok: true, meeting: result.value }
}

export function clearRecorderError(): void {
  if (state.error) set({ error: null })
}

// This renderer just loaded, so it isn't feeding any recording: let main
// finalize recordings orphaned by a reload/crash (their audio is kept).
if (typeof window !== 'undefined') {
  queueMicrotask(() => { void meetingsApi()?.recover().catch(() => {}) })
}
