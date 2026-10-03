import { createHash, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { rmSync } from 'node:fs'
import type { NormalizedTranscript } from './adapters/audio-result.ts'
import { appendChunk, finalizeJournal, openJournal, recoverJournals, type CaptureJournal } from './capture-journal.ts'
import { addRevision, loadHistoryIndex, saveHistoryIndex, upsertRecording } from './history-store.ts'
import type { VoiceRecording } from './history.ts'
import { applyJobEvent, canStartCapture, createVoiceJob, type VoiceJob } from './job-machine.ts'
import { overlayFromCapture, type OverlayState } from './overlay-types.ts'
import {
  appendMeetingAudio,
  pauseMeetingCaptureSession,
  startMeetingCaptureSession,
  stopMeetingCaptureSession,
  type MeetingCaptureSession,
} from './meeting-capture.ts'
import type { VoicePrefs } from './types.ts'

export interface VoiceHostAdapters {
  transcribe(audio: Uint8Array, mimeType: string, language?: string, signal?: AbortSignal): Promise<NormalizedTranscript>
}

export interface VoiceHostEvent {
  type: 'job' | 'overlay' | 'draft'
  job: VoiceJob
  overlay: OverlayState
  draft?: { recordingId: string; text: string; revisionId: string }
}

export class VoiceHost {
  private job: VoiceJob | null = null
  private journal: CaptureJournal | null = null
  private chunks: Uint8Array[] = []
  private archiveCapture = false
  private meetingCapture: MeetingCaptureSession | null = null
  private captureStartedAt: number | null = null
  private captureElapsedMs = 0
  private listeners = new Set<(event: VoiceHostEvent) => void>()
  private transcription: { jobId: string; controller: AbortController } | null = null

  constructor(
    private readonly configDir: string,
    private readonly adapters: VoiceHostAdapters,
    private readonly now: () => number = Date.now,
  ) {}

  on(listener: (event: VoiceHostEvent) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  startMeetingCapture(meetingId: string): MeetingCaptureSession {
    this.meetingCapture = startMeetingCaptureSession(meetingId)
    return this.meetingCapture
  }

  pauseMeetingCapture(): MeetingCaptureSession | null {
    if (!this.meetingCapture) return null
    this.meetingCapture = pauseMeetingCaptureSession(this.meetingCapture)
    return this.meetingCapture
  }

  appendMeetingCapture(source: 'mic' | 'system', bytes: Uint8Array): void {
    if (this.meetingCapture) this.meetingCapture = appendMeetingAudio(this.meetingCapture, source, bytes)
  }

  stopMeetingCapture() {
    if (!this.meetingCapture) return { status: 'stopped' as const, mic: { sha256: '', bytes: 0, durationMs: 0 }, system: { sha256: '', bytes: 0, durationMs: 0 } }
    const result = stopMeetingCaptureSession(this.meetingCapture)
    this.meetingCapture = null
    return result
  }

  recover(): CaptureJournal[] {
    return recoverJournals(this.configDir)
  }

  start(prefs: VoicePrefs, meta: { sampleRate?: number; channels?: number; mimeType?: string } = {}): VoiceJob {
    if (!canStartCapture(this.job) || this.transcription) {
      throw new Error('A capture is already active')
    }
    if (prefs.privacyMigrationPending) {
      throw new Error('Voice archive consent is required before a new recording')
    }
    const recordingId = randomUUID()
    const jobId = randomUUID()
    this.captureStartedAt = null
    this.captureElapsedMs = 0
    this.job = createVoiceJob(recordingId, jobId)
    this.job = applyJobEvent(this.job, {
      ...this.job,
      seq: 1,
      capture: 'requesting-permission',
      recordingId,
      jobId,
    })
    this.archiveCapture = prefs.localArchivePolicy !== 'none'
    const captureMeta = { sampleRate: meta.sampleRate ?? 16000, channels: meta.channels ?? 1, mimeType: meta.mimeType ?? 'audio/webm' }
    this.journal = this.archiveCapture
      ? openJournal(this.configDir, recordingId, captureMeta, this.now())
      : { recordingId, ...captureMeta, createdAt: this.now(), chunks: [], finalized: false, recovered: false }
    this.chunks = []
    this.emit()
    return this.job
  }

  grantPermission(): VoiceJob {
    if (!this.job) throw new Error('No capture')
    this.captureStartedAt = this.now()
    this.job = applyJobEvent(this.job, { ...this.job, seq: this.job.seq + 1, capture: 'recording' })
    this.emit()
    return this.job
  }

  denyPermission(): VoiceJob {
    if (!this.job) throw new Error('No capture')
    this.job = applyJobEvent(this.job, {
      ...this.job,
      seq: this.job.seq + 1,
      capture: 'idle',
      job: 'cancelled',
      error: 'microphone-denied',
    })
    this.emit()
    const job = this.job
    this.job = null
    return job
  }

  chunk(bytes: Uint8Array): void {
    if (!this.job || !this.journal || this.job.capture !== 'recording') return
    this.chunks.push(bytes)
    if (this.archiveCapture) appendChunk(this.configDir, this.journal, bytes)
    this.emit()
  }

  async stop(prefs: VoicePrefs, language?: string): Promise<VoiceJob> {
    if (!this.job || !this.journal) throw new Error('No capture')
    if (this.transcription) throw new Error('Transcription is already in progress')
    this.job = applyJobEvent(this.job, { ...this.job, seq: this.job.seq + 1, capture: 'finalizing', job: 'transcribing' })
    this.captureElapsedMs = this.captureStartedAt === null ? 0 : Math.max(0, this.now() - this.captureStartedAt)
    this.captureStartedAt = null
    const startedJob = this.job
    const journal = this.journal
    const controller = new AbortController()
    const request = { jobId: startedJob.jobId, controller }
    this.transcription = request
    const isCurrent = () => this.job?.jobId === request.jobId && this.transcription === request && !controller.signal.aborted
    const cancelled = (): VoiceJob => ({ ...startedJob, seq: startedJob.seq + 1, capture: 'idle', job: 'cancelled' })
    this.emit()
    const audio = concat(this.chunks)
    try {
      const archive = this.archiveCapture && prefs.localArchivePolicy !== 'none'
      if (archive) finalizeJournal(this.configDir, journal, audio)
      else if (this.archiveCapture) rmSync(join(this.configDir, 'voice', 'recordings', journal.recordingId), { recursive: true, force: true })
      const recording = archive ? this.commitRecording(audio, journal.mimeType) : null
      const result = await this.adapters.transcribe(audio, journal.mimeType, language, controller.signal)
      if (!isCurrent()) return cancelled()
      const revisionId = randomUUID()
      if (recording) {
        let index = loadHistoryIndex(this.configDir)
        index = addRevision(index, {
          id: revisionId,
          recordingId: recording.id,
          kind: 'asr',
          modelId: result.requestedModelId,
          modelRevision: result.modelRevision ?? result.resolvedModelId,
          routeVersion: result.routeVersion,
          detectedLanguage: result.detectedLanguage,
          text: result.text,
          segments: result.segments,
          words: result.words,
          createdAt: this.now(),
        })
        index = upsertRecording(index, { ...recording, durationMs: result.durationMs, selectedRevisionId: revisionId, state: result.noSpeech ? 'failed' : 'finalized' })
        saveHistoryIndex(this.configDir, index)
      }
      this.job = applyJobEvent(this.job!, {
        ...this.job!,
        seq: this.job!.seq + 1,
        capture: 'idle',
        job: result.noSpeech ? 'degraded' : 'ready',
        error: result.noSpeech ? 'no-speech' : undefined,
        transcript: result,
      })
      this.emit({ recordingId: journal.recordingId, text: result.text, revisionId })
    } catch (error) {
      if (!isCurrent()) return cancelled()
      this.job = applyJobEvent(this.job!, {
        ...this.job!,
        seq: this.job!.seq + 1,
        capture: 'idle',
        job: 'failed',
        error: error instanceof Error ? error.message : 'transcribe-failed',
      })
      this.emit()
    } finally {
      if (this.transcription === request) this.transcription = null
    }
    const job = this.job!
    if (job.jobId === startedJob.jobId) {
      this.job = null
      this.journal = null
      this.chunks = []
    }
    return job
  }

  cancel(): VoiceJob | null {
    if (!this.job) return null
    this.transcription?.controller.abort()
    this.transcription = null
    this.job = applyJobEvent(this.job, {
      ...this.job,
      seq: this.job.seq + 1,
      capture: 'idle',
      job: 'cancelled',
    })
    this.emit()
    const job = this.job
    this.job = null
    this.journal = null
    this.chunks = []
    return job
  }

  current(): VoiceJob | null {
    return this.job
  }

  overlay(): OverlayState {
    return {
      recordingId: this.job?.recordingId ?? null,
      phase: !this.job ? 'hidden' : this.job.job === 'transcribing' ? 'transcribing'
        : this.job.job === 'ready' ? 'ready' : this.job.job === 'failed' || this.job.job === 'degraded' ? 'error'
          : overlayFromCapture(this.job.capture),
      elapsedMs: this.captureStartedAt === null ? this.captureElapsedMs : Math.max(0, this.now() - this.captureStartedAt),
      rms: 0,
      streaming: false,
      error: this.job?.error,
    }
  }

  private commitRecording(audio: Uint8Array, format: string): VoiceRecording {
    const recording: VoiceRecording = {
      id: this.job!.recordingId,
      createdAt: this.now(),
      durationMs: 0,
      audioPath: join(this.configDir, 'voice', 'recordings', this.job!.recordingId, 'original.bin'),
      hash: createHash('sha256').update(audio).digest('hex'),
      format,
      state: 'finalized',
      favorite: false,
    }
    const index = upsertRecording(loadHistoryIndex(this.configDir), recording)
    saveHistoryIndex(this.configDir, index)
    return recording
  }

  private emit(draft?: { recordingId: string; text: string; revisionId: string }): void {
    if (!this.job) return
    const event: VoiceHostEvent = {
      type: draft ? 'draft' : 'job',
      job: this.job,
      overlay: this.overlay(),
      draft,
    }
    for (const listener of this.listeners) listener(event)
  }
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}
