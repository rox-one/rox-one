import { applyTranscriptDelivery, type TranscribeResult, type VoiceCommand, type VoicePrefs } from '@craft-agent/shared/voice'
import type { VoiceOverlayState } from '../../shared/voice-overlay-ipc'

const TIMESLICE_MS = 250
const METER_INTERVAL_MS = 100
const TRANSCRIPT_EVENT = 'rox-voice-transcript'

type CaptureState = {
  recording: boolean
  busy: boolean
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result ?? '')
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

function pickMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return 'audio/webm'
  if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) return 'audio/webm;codecs=opus'
  if (MediaRecorder.isTypeSupported('audio/webm')) return 'audio/webm'
  return ''
}

export function rmsFromTimeDomain(samples: Uint8Array): number {
  if (samples.length === 0) return 0
  let sum = 0
  for (const value of samples) {
    const n = (value - 128) / 128
    sum += n * n
  }
  return Math.sqrt(sum / samples.length)
}

async function setOverlay(state: VoiceOverlayState): Promise<void> {
  await window.electronAPI.setVoiceOverlayVisible?.(state).catch(() => {})
}

/**
 * Device-side capture singleton. The React composer may unmount; this session
 * keeps MediaRecorder and the VoiceHost recording id alive until stop/cancel.
 */
class VoiceCaptureSession {
  private state: CaptureState = { recording: false, busy: false }
  private listeners = new Set<(state: CaptureState) => void>()
  private transcriptListeners = new Set<(text: string) => void>()
  private recordingId: string | null = null
  private recorder: MediaRecorder | null = null
  private stream: MediaStream | null = null
  private sending: Promise<void> = Promise.resolve()
  private commandsInstalled = false
  private deviceId: string | null = null
  private delivery: VoicePrefs['delivery'] = 'draft'
  private trailingSpace = false
  private startedAt = 0
  private meterRaf = 0
  private lastMeterAt = 0
  private analyser: AnalyserNode | null = null
  private audioContext: AudioContext | null = null

  subscribe(listener: (state: CaptureState) => void): () => void {
    this.listeners.add(listener)
    listener(this.state)
    return () => {
      this.listeners.delete(listener)
    }
  }

  onTranscript(listener: (text: string) => void): () => void {
    this.transcriptListeners.add(listener)
    return () => {
      this.transcriptListeners.delete(listener)
    }
  }

  setDeviceId(deviceId: string | null): void {
    this.deviceId = deviceId
  }

  setPrefs(prefs: Pick<VoicePrefs, 'selectedInputDeviceId' | 'delivery' | 'trailingSpace'>): void {
    this.deviceId = prefs.selectedInputDeviceId
    this.delivery = prefs.delivery
    this.trailingSpace = prefs.trailingSpace
  }

  getState(): CaptureState {
    return this.state
  }

  installCommandListener(): void {
    if (this.commandsInstalled) return
    this.commandsInstalled = true
    window.electronAPI.onVoiceCommand?.((command: VoiceCommand) => {
      void this.handleCommand(command)
    })
  }

  async handleCommand(command: VoiceCommand): Promise<void> {
    if (command.action === 'toggle') {
      if (this.state.recording) await this.stop()
      else await this.start(this.deviceId)
      return
    }
    if (command.action === 'ptt-down') {
      if (!this.state.recording) await this.start(this.deviceId)
      return
    }
    if (command.action === 'ptt-up') {
      if (this.state.recording) await this.stop()
      return
    }
    if (command.action === 'cancel') {
      await this.cancel()
    }
  }

  async start(deviceId?: string | null): Promise<void> {
    if (this.state.recording || this.state.busy) return
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      throw new Error('Microphone capture is unavailable')
    }
    this.setState({ busy: true })
    const mimeType = pickMimeType()
    try {
      const started = await window.electronAPI.startVoiceCapture?.({
        mimeType: mimeType || 'audio/webm',
      })
      if (!started?.id) throw new Error('Voice host is unavailable')
      this.recordingId = started.id
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
      })
      this.stream = stream
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      recorder.ondataavailable = (event) => {
        if (!event.data.size || !this.recordingId) return
        const id = this.recordingId
        this.sending = this.sending
          .then(async () => {
            const chunkBase64 = await blobToBase64(event.data)
            await window.electronAPI.appendVoiceCaptureChunk?.({ id, chunkBase64 })
          })
          .catch(() => {})
      }
      this.recorder = recorder
      this.startedAt = Date.now()
      recorder.start(TIMESLICE_MS)
      this.setState({ recording: true, busy: false })
      this.startMeter(stream)
      await setOverlay({
        visible: true,
        recording: true,
        busy: false,
        rms: 0,
        elapsedMs: 0,
      })
    } catch (error) {
      const id = this.recordingId
      this.recordingId = null
      this.stopTracks()
      this.stopMeter()
      if (id) {
        await window.electronAPI.cancelVoiceCapture?.({ id }).catch(() => {})
      }
      this.setState({ recording: false, busy: false })
      await setOverlay({ visible: false, recording: false, busy: false, rms: 0, elapsedMs: 0 })
      throw error
    }
  }

  async stop(): Promise<TranscribeResult> {
    if (!this.state.recording && !this.recordingId) {
      throw new Error('No active recording')
    }
    const durationMs = this.elapsedMs()
    this.setState({ busy: true, recording: true })
    await setOverlay({
      visible: true,
      recording: false,
      busy: true,
      rms: 0,
      elapsedMs: durationMs,
    })
    const id = this.recordingId
    const recorder = this.recorder
    this.recorder = null
    if (recorder && recorder.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        recorder.addEventListener('stop', () => resolve(), { once: true })
        recorder.stop()
      })
    }
    await this.sending
    this.stopTracks()
    this.stopMeter()
    this.recordingId = null
    try {
      this.setState({ recording: false, busy: true })
      const result = await window.electronAPI.stopVoiceCapture({ id: id ?? undefined, durationMs })
      const text = result.text.trim()
      if (text) {
        const delivered = applyTranscriptDelivery(text, {
          delivery: this.delivery,
          trailingSpace: this.trailingSpace,
        })
        if (delivered.copy) {
          void navigator.clipboard.writeText(delivered.text).catch(() => {})
        }
        if (delivered.insert) {
          for (const listener of this.transcriptListeners) listener(delivered.text)
          window.dispatchEvent(new CustomEvent(TRANSCRIPT_EVENT, { detail: delivered.text }))
        }
      }
      this.setState({ recording: false, busy: false })
      await setOverlay({ visible: false, recording: false, busy: false, rms: 0, elapsedMs: durationMs })
      return result
    } catch (error) {
      this.setState({ recording: false, busy: false })
      await setOverlay({ visible: false, recording: false, busy: false, rms: 0, elapsedMs: durationMs })
      throw error
    }
  }

  async cancel(): Promise<void> {
    const durationMs = this.elapsedMs()
    const id = this.recordingId
    const recorder = this.recorder
    this.recorder = null
    this.recordingId = null
    if (recorder && recorder.state !== 'inactive') {
      try { recorder.stop() } catch {}
    }
    this.stopTracks()
    this.stopMeter()
    if (id) await window.electronAPI.cancelVoiceCapture?.({ id, durationMs }).catch(() => {})
    this.setState({ recording: false, busy: false })
    await setOverlay({ visible: false, recording: false, busy: false, rms: 0, elapsedMs: durationMs })
  }

  private elapsedMs(): number {
    return this.startedAt ? Date.now() - this.startedAt : 0
  }

  private startMeter(stream: MediaStream): void {
    this.stopMeter()
    const AudioCtx = window.AudioContext
      || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioCtx) return
    try {
      const ctx = new AudioCtx()
      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      source.connect(analyser)
      this.audioContext = ctx
      this.analyser = analyser
    } catch {
      this.analyser = null
    }
    const tick = () => {
      if (!this.state.recording && !this.state.busy) return
      const now = Date.now()
      if (now - this.lastMeterAt >= METER_INTERVAL_MS) {
        this.lastMeterAt = now
        const samples = this.analyser ? new Uint8Array(this.analyser.fftSize) : null
        if (samples && this.analyser) this.analyser.getByteTimeDomainData(samples)
        void setOverlay({
          visible: true,
          recording: this.state.recording,
          busy: this.state.busy,
          rms: samples ? rmsFromTimeDomain(samples) : 0,
          elapsedMs: this.elapsedMs(),
        })
      }
      this.meterRaf = requestAnimationFrame(tick)
    }
    this.meterRaf = requestAnimationFrame(tick)
  }

  private stopMeter(): void {
    if (this.meterRaf) cancelAnimationFrame(this.meterRaf)
    this.meterRaf = 0
    this.analyser = null
    const ctx = this.audioContext
    this.audioContext = null
    void ctx?.close().catch(() => {})
  }

  private stopTracks(): void {
    this.stream?.getTracks().forEach((track) => track.stop())
    this.stream = null
  }

  private setState(patch: Partial<CaptureState>): void {
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener(this.state)
  }
}

export const voiceCaptureSession = new VoiceCaptureSession()
export const VOICE_TRANSCRIPT_EVENT = TRANSCRIPT_EVENT
