import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { NormalizedTranscript } from './adapters/audio-result.ts'
import { appendChunk, finalizeJournal, openJournal, recoverJournals, type CaptureJournal } from './capture-journal.ts'
import { addRevision, loadHistoryIndex, saveHistoryIndex, upsertRecording } from './history-store.ts'
import type { VoiceRecording } from './history.ts'
import { applyJobEvent, canStartCapture, createVoiceJob, type VoiceJob } from './job-machine.ts'
import { overlayFromCapture, type OverlayState } from './overlay-types.ts'
import { shouldUploadAudio } from './policy.ts'
import type { VoicePrefs } from './types.ts'

export interface VoiceHostAdapters {
  transcribe(audio: Uint8Array, mimeType: string, language?: string): Promise<NormalizedTranscript>
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
  private listeners = new Set<(event: VoiceHostEvent) => void>()

  constructor(
    private readonly configDir: string,
    private readonly adapters: VoiceHostAdapters,
    private readonly now: () => number = Date.now,
  ) {}

  on(listener: (event: VoiceHostEvent) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  recover(): CaptureJournal[] {
    return recoverJournals(this.configDir)
  }

  start(prefs: VoicePrefs, meta: { sampleRate?: number; channels?: number; mimeType?: string } = {}): VoiceJob {
    if (!canStartCapture(this.job)) {
      throw new Error('A capture is already active')
    }
    if (prefs.privacyMigrationPending) {
      throw new Error('Voice archive consent is required before a new recording')
    }
    const recordingId = randomUUID()
    const jobId = randomUUID()
    this.job = createVoiceJob(recordingId, jobId)
    this.job = applyJobEvent(this.job, {
      ...this.job,
      seq: 1,
      capture: 'requesting-permission',
      recordingId,
      jobId,
    })
    this.journal = openJournal(this.configDir, recordingId, {
      sampleRate: meta.sampleRate ?? 16000,
      channels: meta.channels ?? 1,
      mimeType: meta.mimeType ?? 'audio/webm',
    }, this.now())
    this.chunks = []
    this.emit()
    return this.job
  }

  grantPermission(): VoiceJob {
    if (!this.job) throw new Error('No capture')
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
    appendChunk(this.configDir, this.journal, bytes)
  }

  async stop(prefs: VoicePrefs, language?: string): Promise<VoiceJob> {
    if (!this.job || !this.journal) throw new Error('No capture')
    this.job = applyJobEvent(this.job, { ...this.job, seq: this.job.seq + 1, capture: 'finalizing', job: 'transcribing' })
    this.emit()
    const audio = concat(this.chunks)
    finalizeJournal(this.configDir, this.journal, audio)
    const recording = this.commitRecording(audio, this.journal.mimeType)
    try {
      const result = await this.adapters.transcribe(audio, this.journal.mimeType, language)
      const revisionId = randomUUID()
      let index = loadHistoryIndex(this.configDir)
      index = addRevision(index, {
        id: revisionId,
        recordingId: recording.id,
        kind: 'asr',
        modelId: result.requestedModelId,
        modelRevision: result.resolvedModelId,
        routeVersion: result.routeVersion,
        detectedLanguage: result.detectedLanguage,
        text: result.text,
        segments: result.segments,
        words: result.words,
        createdAt: this.now(),
      })
      index = upsertRecording(index, { ...recording, selectedRevisionId: revisionId, state: result.noSpeech ? 'failed' : 'finalized' })
      saveHistoryIndex(this.configDir, index)
      this.job = applyJobEvent(this.job, {
        ...this.job,
        seq: this.job.seq + 1,
        capture: 'idle',
        job: result.noSpeech ? 'degraded' : 'ready',
        error: result.noSpeech ? 'no-speech' : undefined,
      })
      this.emit({ recordingId: recording.id, text: result.text, revisionId })
    } catch (error) {
      this.job = applyJobEvent(this.job, {
        ...this.job,
        seq: this.job.seq + 1,
        capture: 'idle',
        job: 'failed',
        error: error instanceof Error ? error.message : 'transcribe-failed',
      })
      this.emit()
    }
    const job = this.job
    this.job = null
    this.journal = null
    this.chunks = []
    void shouldUploadAudio(prefs)
    return job
  }

  cancel(): VoiceJob | null {
    if (!this.job) return null
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
      phase: this.job ? overlayFromCapture(this.job.capture) : 'hidden',
      elapsedMs: 0,
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
      hash: String(audio.byteLength),
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
