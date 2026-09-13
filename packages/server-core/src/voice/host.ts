import {
  formatSrt,
  resultFromRevision,
  revisionFromResult,
  assertEditableTranscript,
  loadVoicePrefs,
  shouldDiscardAudio,
  type TranscribeResult,
  type VoiceExportFormat,
  type VoicePrefs,
  type VoiceRecording,
  type VoiceRecordingStatus,
  type VoiceTranscriptRevision,
} from '@craft-agent/shared/voice'
import { resolveConfigDir } from '@craft-agent/shared/config'
import { existsSync } from 'node:fs'
import { appendFile, mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  createDefaultGatewayDeps,
  resolveVoiceAccessToken,
  transcribeViaRoxGateway,
  type VoiceGatewayDeps,
} from './gateway'

export interface StoredVoiceRecording extends Omit<VoiceRecording, 'audioAvailable'> {
  audioPath: string
}

export interface VoiceHostRuntime {
  configDir?: string
  gatewayDeps?: VoiceGatewayDeps
  transcribe?: (input: {
    audio: Buffer
    mimeType: string
    language?: string
    requestId?: string
    signal?: AbortSignal
  }) => Promise<TranscribeResult>
}

interface JournalFile {
  recordings: StoredVoiceRecording[]
}

const JOURNAL = 'journal.json'
const RECORDINGS_DIR = 'recordings'

function nowIso(): string {
  return new Date().toISOString()
}

function newId(): string {
  return `rec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function extFor(mimeType: string): string {
  if (mimeType.includes('wav')) return 'wav'
  if (mimeType.includes('mpeg') || mimeType.includes('mp3')) return 'mp3'
  if (mimeType.includes('mp4') || mimeType.includes('m4a')) return 'm4a'
  if (mimeType.includes('ogg')) return 'ogg'
  if (mimeType.includes('flac')) return 'flac'
  return 'webm'
}

function applyDuration(rec: StoredVoiceRecording, durationMs: number | undefined): void {
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 0) return
  rec.durationMs = Math.round(durationMs)
}

function publicRecording(rec: StoredVoiceRecording): VoiceRecording {
  return {
    id: rec.id,
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
    status: rec.status,
    mimeType: rec.mimeType,
    durationMs: rec.durationMs,
    error: rec.error,
    favorite: rec.favorite,
    selectedRevisionId: rec.selectedRevisionId,
    revisions: rec.revisions,
    result: rec.result,
    audioAvailable: Boolean(rec.audioPath && existsSync(rec.audioPath)),
  }
}

function hydrateRevisions(rec: StoredVoiceRecording): void {
  if (!rec.revisions) rec.revisions = []
  if (rec.result && rec.revisions.length === 0) {
    const revision = revisionFromResult(rec.result, { createdAt: rec.updatedAt })
    rec.revisions.push(revision)
    rec.selectedRevisionId = revision.id
  }
}

function selectedRevision(rec: StoredVoiceRecording): VoiceTranscriptRevision | undefined {
  if (rec.selectedRevisionId) {
    return rec.revisions?.find((item) => item.id === rec.selectedRevisionId)
  }
  return rec.revisions?.[rec.revisions.length - 1]
}

export class DeviceVoiceHost {
  private readonly configDir: string
  private readonly root: string
  private readonly recordingsDir: string
  private readonly journalPath: string
  private readonly transcribeFn: NonNullable<VoiceHostRuntime['transcribe']>
  private readonly inflight = new Map<string, AbortController>()
  private journal: JournalFile = { recordings: [] }
  private loaded = false
  private activeId: string | null = null

  constructor(runtime: VoiceHostRuntime = {}) {
    this.configDir = runtime.configDir ?? resolveConfigDir()
    this.root = join(this.configDir, 'voice')
    this.recordingsDir = join(this.root, RECORDINGS_DIR)
    this.journalPath = join(this.root, JOURNAL)
    this.transcribeFn = runtime.transcribe ?? (async (input) => {
      const deps = runtime.gatewayDeps ?? createDefaultGatewayDeps({ configDir: this.configDir })
      const { token } = await resolveVoiceAccessToken(deps)
      return transcribeViaRoxGateway(deps, token, {
        audio: new Uint8Array(input.audio),
        mimeType: input.mimeType,
        language: input.language,
        requestId: input.requestId,
        signal: input.signal,
      })
    })
  }

  async ensureReady(): Promise<void> {
    if (this.loaded) return
    await mkdir(this.recordingsDir, { recursive: true })
    try {
      const raw = await readFile(this.journalPath, 'utf8')
      const parsed = JSON.parse(raw) as JournalFile
      this.journal = { recordings: Array.isArray(parsed.recordings) ? parsed.recordings : [] }
    } catch {
      this.journal = { recordings: [] }
    }
    for (const rec of this.journal.recordings) {
      if (rec.status === 'recording') {
        rec.status = 'interrupted'
        rec.updatedAt = nowIso()
      }
      hydrateRevisions(rec)
    }
    const prefs = loadVoicePrefs(this.configDir)
    for (const rec of this.journal.recordings) {
      if (shouldDiscardAudio(prefs, rec, 'host-reload')) {
        await this.purgeAudio(rec)
      }
    }
    await this.persist()
    this.loaded = true
  }

  async list(): Promise<VoiceRecording[]> {
    await this.ensureReady()
    return [...this.journal.recordings]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(publicRecording)
  }

  async status(): Promise<{ activeId: string | null; recording: VoiceRecording | null; archiveDir: string }> {
    await this.ensureReady()
    const rec = this.activeId ? this.journal.recordings.find((item) => item.id === this.activeId) : null
    return {
      activeId: this.activeId,
      recording: rec ? publicRecording(rec) : null,
      archiveDir: this.recordingsDir,
    }
  }

  async start(mimeType = 'audio/webm'): Promise<VoiceRecording> {
    await this.ensureReady()
    if (this.activeId) {
      const previous = this.journal.recordings.find((item) => item.id === this.activeId)
      if (previous && previous.status === 'recording') {
        previous.status = 'interrupted'
        previous.updatedAt = nowIso()
      }
      this.activeId = null
    }
    const id = newId()
    const rec: StoredVoiceRecording = {
      id,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      status: 'recording',
      mimeType,
      audioPath: join(this.recordingsDir, `${id}.${extFor(mimeType)}`),
    }
    this.journal.recordings.push(rec)
    this.activeId = id
    await this.persist()
    return publicRecording(rec)
  }

  async appendChunk(id: string, chunk: Buffer): Promise<void> {
    await this.ensureReady()
    const rec = this.require(id)
    if (rec.status !== 'recording') {
      throw new Error(`Recording ${id} is not active`)
    }
    if (!rec.audioPath) {
      throw new Error('Recording has no audio file')
    }
    await appendFile(rec.audioPath, chunk)
    rec.updatedAt = nowIso()
  }

  async stop(id: string, extras: { durationMs?: number } = {}): Promise<VoiceRecording> {
    await this.ensureReady()
    const rec = this.require(id)
    rec.status = 'queued'
    rec.updatedAt = nowIso()
    applyDuration(rec, extras.durationMs)
    if (this.activeId === id) this.activeId = null
    await this.persist()
    return publicRecording(rec)
  }

  async cancel(id: string, extras: { durationMs?: number } = {}): Promise<VoiceRecording> {
    await this.ensureReady()
    this.inflight.get(id)?.abort()
    this.inflight.delete(id)
    const rec = this.require(id)
    rec.status = 'canceled'
    rec.updatedAt = nowIso()
    applyDuration(rec, extras.durationMs)
    if (this.activeId === id) this.activeId = null
    const prefs = loadVoicePrefs(this.configDir)
    if (shouldDiscardAudio(prefs, rec, 'immediate')) {
      await this.purgeAudio(rec)
    }
    await this.persist()
    return publicRecording(rec)
  }

  async getAudio(id: string): Promise<{ mimeType: string; audioBase64: string }> {
    await this.ensureReady()
    const rec = this.require(id)
    if (!rec.audioPath || !existsSync(rec.audioPath)) {
      throw new Error('Audio was discarded by retention policy')
    }
    const audio = await readFile(rec.audioPath)
    return {
      mimeType: rec.mimeType,
      audioBase64: audio.toString('base64'),
    }
  }

  async transcribeRecording(
    id: string,
    prefs: VoicePrefs,
    options: { language?: string; signal?: AbortSignal } = {},
  ): Promise<TranscribeResult> {
    await this.ensureReady()
    const rec = this.require(id)
    rec.status = 'transcribing'
    rec.updatedAt = nowIso()
    rec.error = undefined
    await this.persist()
    if (!rec.audioPath || !existsSync(rec.audioPath)) {
      rec.status = 'error'
      rec.error = 'Audio was discarded by retention policy'
      rec.updatedAt = nowIso()
      await this.persist()
      throw new Error(rec.error)
    }
    const controller = new AbortController()
    this.inflight.set(id, controller)
    if (options.signal) {
      options.signal.addEventListener('abort', () => controller.abort(), { once: true })
    }
    try {
      const audio = await readFile(rec.audioPath)
      const result = await this.transcribeFn({
        audio,
        mimeType: rec.mimeType,
        language: options.language,
        requestId: `${rec.id}:${rec.revisions?.length ?? 0}`,
        signal: controller.signal,
      })
      rec.status = 'complete'
      const parentId = selectedRevision(rec)?.id
      const revision = revisionFromResult(result, { parentId })
      rec.revisions = [...(rec.revisions ?? []), revision]
      rec.selectedRevisionId = revision.id
      rec.result = result
      rec.durationMs = typeof result.duration === 'number' ? Math.round(result.duration * 1000) : rec.durationMs
      rec.updatedAt = nowIso()
      if (shouldDiscardAudio(prefs, rec, 'immediate')) {
        await this.purgeAudio(rec)
      }
      await this.persist()
      return result
    } catch (err) {
      rec.status = controller.signal.aborted ? 'canceled' : 'error'
      rec.error = err instanceof Error ? err.message : String(err)
      rec.updatedAt = nowIso()
      if (rec.status === 'canceled' && shouldDiscardAudio(loadVoicePrefs(this.configDir), rec, 'immediate')) {
        await this.purgeAudio(rec)
      }
      await this.persist()
      throw err
    } finally {
      this.inflight.delete(id)
    }
  }

  async delete(id: string): Promise<void> {
    await this.ensureReady()
    this.inflight.get(id)?.abort()
    this.inflight.delete(id)
    const rec = this.require(id)
    if (rec.audioPath) {
      try {
        await unlink(rec.audioPath)
      } catch {
        // missing file is still a successful journal delete
      }
    }
    for (const ext of ['txt', 'json', 'srt']) {
      try {
        await unlink(join(this.recordingsDir, `${id}.${ext}`))
      } catch {
        /* ignore sidecar */
      }
    }
    this.journal.recordings = this.journal.recordings.filter((item) => item.id !== id)
    if (this.activeId === id) this.activeId = null
    await this.persist()
  }

  async setFavorite(id: string, favorite: boolean): Promise<VoiceRecording> {
    await this.ensureReady()
    const rec = this.require(id)
    rec.favorite = favorite
    rec.updatedAt = nowIso()
    await this.persist()
    return publicRecording(rec)
  }

  async selectRevision(id: string, revisionId: string): Promise<VoiceRecording> {
    await this.ensureReady()
    const rec = this.require(id)
    const revision = rec.revisions?.find((item) => item.id === revisionId)
    if (!revision) throw new Error('Unknown transcript revision')
    rec.selectedRevisionId = revision.id
    rec.result = resultFromRevision(revision)
    rec.updatedAt = nowIso()
    await this.persist()
    return publicRecording(rec)
  }

  async editTranscript(id: string, text: string): Promise<VoiceRecording> {
    await this.ensureReady()
    const rec = this.require(id)
    const cleaned = assertEditableTranscript(text)
    const parent = selectedRevision(rec)
    const revision = revisionFromResult({
      text: cleaned,
      engine: parent?.engine ?? rec.result?.engine ?? 'cloud-rox',
      uploaded: false,
      modelId: parent?.modelId ?? rec.result?.modelId,
      language: parent?.language ?? rec.result?.language,
    }, { kind: 'manual', parentId: parent?.id })
    rec.revisions = [...(rec.revisions ?? []), revision]
    rec.selectedRevisionId = revision.id
    rec.result = resultFromRevision(revision)
    rec.updatedAt = nowIso()
    await this.persist()
    return publicRecording(rec)
  }

  async exportRecording(id: string, format: VoiceExportFormat): Promise<{ path: string }> {
    await this.ensureReady()
    const rec = this.require(id)
    const revision = selectedRevision(rec)
    const text = revision?.text ?? rec.result?.text ?? ''
    let filename: string
    let body: string
    if (format === 'txt') {
      filename = `${id}.txt`
      body = text
    } else if (format === 'json') {
      filename = `${id}.json`
      body = `${JSON.stringify(publicRecording(rec), null, 2)}\n`
    } else {
      const segments = revision?.kind === 'asr' ? revision.segments : undefined
      if (!segments?.length) {
        throw new Error('SRT export needs timestamped ASR output')
      }
      filename = `${id}.srt`
      body = formatSrt(segments)
    }
    const path = join(this.recordingsDir, filename)
    await writeFile(path, body)
    return { path }
  }

  async shutdown(): Promise<void> {
    await this.ensureReady()
    const activeId = this.activeId
    if (activeId) {
      await this.cancel(activeId)
    }
    for (const controller of this.inflight.values()) {
      controller.abort()
    }
    this.inflight.clear()
  }

  archiveDir(): string {
    return this.recordingsDir
  }

  private async purgeAudio(rec: StoredVoiceRecording): Promise<void> {
    if (!rec.audioPath) return
    try {
      await unlink(rec.audioPath)
    } catch {
      /* already gone */
    }
    rec.audioPath = ''
  }

  private require(id: string): StoredVoiceRecording {
    const rec = this.journal.recordings.find((item) => item.id === id)
    if (!rec) throw new Error(`Unknown recording ${id}`)
    return rec
  }

  private async persist(): Promise<void> {
    await mkdir(this.root, { recursive: true })
    const tmp = `${this.journalPath}.tmp`
    await writeFile(tmp, `${JSON.stringify(this.journal, null, 2)}\n`)
    await rename(tmp, this.journalPath)
  }
}

export async function listVoiceAudioFiles(configDir = resolveConfigDir()): Promise<string[]> {
  const dir = join(configDir, 'voice', RECORDINGS_DIR)
  try {
    return await readdir(dir)
  } catch {
    return []
  }
}

export type { VoiceRecordingStatus }
