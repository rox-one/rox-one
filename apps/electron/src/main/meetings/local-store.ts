/**
 * Local meeting store: one folder per meeting under `<root>/<id>/`.
 *   meeting.json      — metadata (title, times, participants, actions, docs…)
 *   audio.<ext>       — the recording or imported file
 *   audio.part.<ext>  — an in-progress recording (MediaRecorder chunks appended)
 *   transcript.json   — timestamped segments; transcript.md — readable copy
 *   documents/        — files attached to the meeting
 * Electron-free (dialogs/shell live in local-ipc.ts) so it is testable.
 */
import {
  appendFileSync,
  copyFileSync,
  createReadStream,
  createWriteStream,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createHash } from 'node:crypto'
import { basename, extname, join } from 'node:path'
import type {
  LocalAsrEngine,
  LocalMeeting,
  LocalMeetingPatch,
  LocalTranscriptSegmentUpdate,
  LocalTranscript,
  MeetingsLocalResult,
} from '../../shared/meetings-local'
import {
  applyPatch,
  emptyLocalMeeting,
  extForRecorderMime,
  isMeetingId,
  mimeForAudioExt,
  newMeetingId,
  normalizeMeeting,
  normalizeTranscript,
  parseWhisperJson,
  transcriptMarkdown,
  uniqueName,
} from './local-model'
import { decodeToWav, probeDurationMs, remuxAudio, runWhisper } from './local-asr'

export const MAX_IMPORT_BYTES = 2 * 1024 * 1024 * 1024

type TranscriptionJob = { id: string; generation: number }

async function sha256File(path: string, signal?: AbortSignal): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path, { signal })) hash.update(chunk)
  return hash.digest('hex')
}

async function copyAndHashAudio(source: string, target: string, signal: AbortSignal): Promise<string> {
  const hash = createHash('sha256')
  const tap = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash.update(chunk)
      callback(null, chunk)
    },
  })
  await pipeline(createReadStream(source, { signal }), tap, createWriteStream(target, { flags: 'wx' }), { signal })
  return hash.digest('hex')
}

type ActiveRecording = {
  meetingId: string
  owner: number
  partPath: string
  ext: string
  mimeType: string
  bytes: number
}

export type LocalMeetingStoreDeps = {
  root: string
  detectEngine: () => LocalAsrEngine
  emit: (id: string) => void
  now?: () => number
  log?: (message: string, error?: unknown) => void
}

export class LocalMeetingStore {
  private readonly active = new Map<string, ActiveRecording>()
  private readonly imports = new Map<string, AbortController>()
  private readonly importingMeetings = new Set<string>()
  private readonly queue: TranscriptionJob[] = []
  private transcribing: TranscriptionJob | null = null
  private activeTranscription: { job: TranscriptionJob; controller: AbortController } | null = null
  private readonly finalizing = new Set<string>()

  constructor(private readonly deps: LocalMeetingStoreDeps) {
    mkdirSync(deps.root, { recursive: true })
    this.recoverImportTransactions()
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now()
  }

  dir(id: string): string {
    if (!isMeetingId(id)) throw new Error('invalid-meeting-id')
    return join(this.deps.root, id)
  }

  private recoverImportTransactions(): void {
    for (const name of readdirSync(this.deps.root)) {
      if (!name.startsWith('.importing-') || !name.endsWith('.json')) continue
      const markerPath = join(this.deps.root, name)
      try {
        const marker = JSON.parse(readFileSync(markerPath, 'utf8')) as {
          meetingId?: unknown
          createdMeeting?: unknown
          fileName?: unknown
          sourceHash?: unknown
        }
        if (!isMeetingId(marker.meetingId)) continue
        const meetingDir = this.dir(marker.meetingId)
        const fileName = typeof marker.fileName === 'string' ? marker.fileName : ''
        const committed = fileName.startsWith('audio.') && basename(fileName) === fileName &&
          typeof marker.sourceHash === 'string' &&
          this.read(marker.meetingId)?.audio?.file === fileName &&
          this.read(marker.meetingId)?.audio?.sourceHash === marker.sourceHash
        if (!committed && marker.createdMeeting === true) {
          rmSync(meetingDir, { recursive: true, force: true })
        } else if (!committed) {
          if (fileName.startsWith('audio.') && basename(fileName) === fileName) {
            rmSync(join(meetingDir, fileName), { force: true })
          }
          rmSync(join(meetingDir, `.audio.importing-${marker.meetingId}`), { force: true })
        }
        unlinkSync(markerPath)
      } catch {
        // Keep unknown user files intact; only a valid marker authorizes cleanup.
      }
    }
  }

  read(id: string): LocalMeeting | null {
    if (!isMeetingId(id)) return null
    try {
      return normalizeMeeting(JSON.parse(readFileSync(join(this.dir(id), 'meeting.json'), 'utf8')), id)
    } catch {
      return null
    }
  }

  private write(meeting: LocalMeeting): LocalMeeting {
    const dir = this.dir(meeting.id)
    mkdirSync(dir, { recursive: true })
    const target = join(dir, 'meeting.json')
    const tmp = `${target}.tmp-${process.pid}`
    writeFileSync(tmp, `${JSON.stringify(meeting, null, 2)}\n`)
    renameSync(tmp, target)
    this.deps.emit(meeting.id)
    return meeting
  }

  private mutate(id: string, fn: (m: LocalMeeting) => LocalMeeting): LocalMeeting | null {
    const current = this.read(id)
    if (!current) return null
    return this.write({ ...fn(current), updatedAt: this.now() })
  }

  list(workspaceId: string | null): LocalMeeting[] {
    let names: string[] = []
    try {
      names = readdirSync(this.deps.root)
    } catch {
      return []
    }
    const out: LocalMeeting[] = []
    for (const name of names) {
      if (!isMeetingId(name)) continue
      const meeting = this.read(name)
      if (!meeting) continue
      if (workspaceId && meeting.workspaceId && meeting.workspaceId !== workspaceId) continue
      out.push(meeting)
    }
    return out.sort((a, b) => (b.startedAt ?? b.scheduledAt ?? b.createdAt) - (a.startedAt ?? a.scheduledAt ?? a.createdAt))
  }

  create(input: { title: string; workspaceId: string | null; scheduledAt?: number }): LocalMeeting {
    const now = this.now()
    let id = newMeetingId(now)
    while (existsSync(join(this.deps.root, id))) id = newMeetingId(now)
    return this.write(emptyLocalMeeting({ id, title: input.title, workspaceId: input.workspaceId, now, scheduledAt: input.scheduledAt }))
  }

  update(id: string, patch: LocalMeetingPatch): LocalMeeting | null {
    return this.mutate(id, (m) => applyPatch(m, patch, this.now()))
  }

  isRecording(id: string): boolean {
    return this.active.has(id)
  }

  /** Remove a meeting folder (the IPC layer moves it to the Trash instead when it can). */
  canRemove(id: string): boolean {
    const queued = this.queue.some((job) => job.id === id)
    const running = this.transcribing?.id === id
    return !this.active.has(id) && !queued && !running && !!this.read(id)
  }

  // ── Recording ────────────────────────────────────────────────────────────

  recStart(input: { meetingId?: string; title: string; workspaceId: string | null; mimeType: string; owner: number }): MeetingsLocalResult<LocalMeeting> {
    if (this.active.size > 0) return { ok: false, code: 'already-recording' }
    let meeting = input.meetingId ? this.read(input.meetingId) : null
    if (input.meetingId && !meeting) return { ok: false, code: 'meeting-not-found' }
    if (meeting?.audio) return { ok: false, code: 'meeting-has-audio' }
    if (!meeting) meeting = this.create({ title: input.title, workspaceId: input.workspaceId })
    const ext = extForRecorderMime(input.mimeType)
    const partPath = join(this.dir(meeting.id), `audio.part.${ext}`)
    writeFileSync(partPath, new Uint8Array())
    this.active.set(meeting.id, { meetingId: meeting.id, owner: input.owner, partPath, ext, mimeType: input.mimeType || 'audio/webm', bytes: 0 })
    const now = this.now()
    const next = this.write({
      ...meeting,
      status: 'recording',
      source: 'microphone',
      startedAt: now,
      endedAt: undefined,
      durationMs: 0,
      audio: null,
      transcript: { status: 'none', progress: 0 },
      updatedAt: now,
    })
    return { ok: true, value: next }
  }

  recChunk(id: string, chunk: Uint8Array): boolean {
    const rec = this.active.get(id)
    if (!rec || !chunk?.byteLength) return false
    appendFileSync(rec.partPath, chunk)
    rec.bytes += chunk.byteLength
    return true
  }

  recState(id: string, state: { paused: boolean; durationMs: number }): void {
    if (!this.active.has(id)) return
    this.mutate(id, (m) => ({ ...m, status: state.paused ? 'paused' : 'recording', durationMs: Math.max(0, Math.round(state.durationMs)) }))
  }

  /** Finalize an in-progress recording: remux the part file, probe duration, queue ASR. */
  async recStop(id: string, input: { durationMs?: number; recovered?: boolean } = {}): Promise<MeetingsLocalResult<LocalMeeting>> {
    if (this.finalizing.has(id)) return { ok: false, code: 'finalizing' }
    this.finalizing.add(id)
    try {
      return await this.finalizeRecording(id, input)
    } finally {
      this.finalizing.delete(id)
    }
  }

  private async finalizeRecording(id: string, input: { durationMs?: number; recovered?: boolean }): Promise<MeetingsLocalResult<LocalMeeting>> {
    const meeting = this.read(id)
    if (!meeting) return { ok: false, code: 'meeting-not-found' }
    const rec = this.active.get(id)
    this.active.delete(id)
    const dir = this.dir(id)
    const partName = rec ? basename(rec.partPath) : readdirSync(dir).find((f) => f.startsWith('audio.part.'))
    if (!partName) {
      const next = this.write({ ...meeting, status: 'ready', endedAt: meeting.endedAt ?? this.now(), updatedAt: this.now() })
      return { ok: true, value: next }
    }
    const partPath = join(dir, partName)
    const ext = rec?.ext ?? partName.replace('audio.part.', '')
    const mimeType = rec?.mimeType ?? mimeForAudioExt(ext) ?? 'audio/webm'
    const size = existsSync(partPath) ? statSync(partPath).size : 0
    if (size === 0) {
      try { unlinkSync(partPath) } catch { /* gone */ }
      const next = this.write({ ...meeting, status: 'ready', endedAt: this.now(), audio: null, updatedAt: this.now() })
      return { ok: false, code: 'empty-recording', message: next.id }
    }
    const engine = this.deps.detectEngine()
    const finalName = `audio.${ext}`
    const finalPath = join(dir, finalName)
    const remuxed = await remuxAudio(engine.ffmpeg, partPath, finalPath)
    if (remuxed) unlinkSync(partPath)
    else renameSync(partPath, finalPath)
    const probed = await probeDurationMs(engine.ffmpeg, finalPath)
    const durationMs = probed ?? Math.max(meeting.durationMs, Math.round(input.durationMs ?? 0))
    const endedAt = input.recovered ? (meeting.startedAt ?? meeting.createdAt) + durationMs : this.now()
    const sourceHash = await sha256File(finalPath).catch(() => undefined)
    const generation = (meeting.transcript.generation ?? 0) + 1
    const attempt = (meeting.transcript.attempt ?? 0) + 1
    const next = this.write({
      ...meeting,
      status: 'ready',
      endedAt,
      durationMs,
      audio: { file: finalName, mimeType, bytes: statSync(finalPath).size, recovered: input.recovered || undefined, sourceHash },
      transcript: {
        status: engine.ready ? 'queued' : 'unavailable',
        progress: 0,
        generation,
        attempt,
        revision: this.readTranscript(id)?.revision ?? 0,
        error: engine.ready ? undefined : engine.missing.join(','),
      },
      updatedAt: this.now(),
    })
    if (engine.ready) this.enqueue({ id, generation })
    return { ok: true, value: next }
  }

  /**
   * Finalize recordings nobody is feeding any more: after a crash/restart
   * (no active entry) or when the owning renderer is gone/reloaded.
   */
  async recover(isOwnerAlive: (owner: number) => boolean, caller?: number): Promise<string[]> {
    const recovered: string[] = []
    for (const meeting of this.list(null)) {
      if (meeting.status !== 'recording' && meeting.status !== 'paused') continue
      if (this.finalizing.has(meeting.id)) continue
      const rec = this.active.get(meeting.id)
      if (rec && rec.owner !== caller && isOwnerAlive(rec.owner)) continue
      const result = await this.recStop(meeting.id, { recovered: true, durationMs: meeting.durationMs })
      if (result.ok || result.code === 'empty-recording') recovered.push(meeting.id)
    }
    return recovered
  }

  async stopOwnedBy(owner: number): Promise<void> {
    for (const rec of [...this.active.values()]) {
      if (rec.owner === owner) await this.recStop(rec.meetingId, { recovered: true })
    }
  }

  // ── Import ───────────────────────────────────────────────────────────────

  cancelImport(requestId: string): boolean {
    const controller = this.imports.get(requestId)
    if (!controller || controller.signal.aborted) return false
    controller.abort()
    return true
  }

  async importAudio(input: { requestId: string; path: string; meetingId?: string; workspaceId: string | null }): Promise<MeetingsLocalResult<LocalMeeting>> {
    if (!input || typeof input.requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(input.requestId)) {
      return { ok: false, code: 'invalid-import-request' }
    }
    if (this.imports.has(input.requestId)) return { ok: false, code: 'import-in-progress' }
    const ext = extname(input.path).slice(1).toLowerCase()
    const mimeType = mimeForAudioExt(ext)
    if (!mimeType) return { ok: false, code: 'unsupported-format' }
    let st
    try {
      st = lstatSync(input.path)
    } catch {
      return { ok: false, code: 'file-not-found' }
    }
    if (st.isSymbolicLink() || !st.isFile()) return { ok: false, code: 'not-a-file' }
    if (st.size === 0) return { ok: false, code: 'empty-file' }
    if (st.size > MAX_IMPORT_BYTES) return { ok: false, code: 'too-large' }
    let meeting = input.meetingId ? this.read(input.meetingId) : null
    if (input.meetingId && !meeting) return { ok: false, code: 'meeting-not-found' }
    if (meeting && (meeting.audio || this.active.has(meeting.id))) return { ok: false, code: 'meeting-has-audio' }
    const controller = new AbortController()
    this.imports.set(input.requestId, controller)
    const originalName = basename(input.path)
    const createdMeeting = !meeting
    if (!meeting) {
      let id = newMeetingId(this.now())
      while (existsSync(join(this.deps.root, id))) id = newMeetingId(this.now())
      meeting = emptyLocalMeeting({ id, title: originalName.replace(/\.[^.]+$/, ''), workspaceId: input.workspaceId, now: this.now() })
    }
    if (this.importingMeetings.has(meeting.id)) {
      this.imports.delete(input.requestId)
      return { ok: false, code: 'import-in-progress' }
    }
    this.importingMeetings.add(meeting.id)
    const dir = this.dir(meeting.id)
    const finalName = `audio.${ext}`
    const finalPath = join(dir, finalName)
    const stagedPath = join(dir, `.audio.importing-${meeting.id}`)
    const markerPath = join(this.deps.root, `.importing-${meeting.id}.json`)
    const markerTemp = `${markerPath}.tmp-${process.pid}`
    let committed = false
    try {
      writeFileSync(markerTemp, JSON.stringify({ meetingId: meeting.id, createdMeeting, fileName: finalName }))
      renameSync(markerTemp, markerPath)
      mkdirSync(dir, { recursive: true })
      const initialHash = await sha256File(input.path, controller.signal)
      const sourceHash = await copyAndHashAudio(input.path, stagedPath, controller.signal)
      if (sourceHash !== initialHash || sourceHash !== await sha256File(input.path, controller.signal)) {
        throw new Error('import-source-changed')
      }
      writeFileSync(markerTemp, JSON.stringify({ meetingId: meeting.id, createdMeeting, fileName: finalName, sourceHash }))
      renameSync(markerTemp, markerPath)
      renameSync(stagedPath, finalPath)
      const engine = this.deps.detectEngine()
      const durationMs = (await probeDurationMs(engine.ffmpeg, finalPath, controller.signal)) ?? 0
      if (controller.signal.aborted) throw new DOMException('Import cancelled', 'AbortError')
      const startedAt = meeting.startedAt ?? Math.max(0, Math.round(st.mtimeMs) - durationMs)
      const generation = (meeting.transcript.generation ?? 0) + 1
      const attempt = (meeting.transcript.attempt ?? 0) + 1
      const next = this.write({
        ...meeting,
        status: 'ready',
        source: 'import',
        startedAt,
        endedAt: startedAt + durationMs,
        durationMs,
        audio: { file: finalName, mimeType, bytes: st.size, originalName, sourceHash },
        transcript: {
          status: engine.ready ? 'queued' : 'unavailable',
          progress: 0,
          generation,
          attempt,
          revision: this.readTranscript(meeting.id)?.revision ?? 0,
          error: engine.ready ? undefined : engine.missing.join(','),
        },
        updatedAt: this.now(),
      })
      committed = true
      try { unlinkSync(markerPath) } catch { /* startup verifies the committed source hash */ }
      if (engine.ready) this.enqueue({ id: meeting.id, generation })
      return { ok: true, value: next }
    } catch (error) {
      try { rmSync(stagedPath, { force: true }) } catch { /* ignore */ }
      if (!committed) {
        try { rmSync(finalPath, { force: true }) } catch { /* ignore */ }
        if (createdMeeting) {
          try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
        }
      }
      try { unlinkSync(markerPath) } catch { /* ignore */ }
      if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
        return { ok: false, code: 'import-cancelled' }
      }
      return { ok: false, code: 'import-failed', message: error instanceof Error ? error.message : String(error) }
    } finally {
      this.imports.delete(input.requestId)
      this.importingMeetings.delete(meeting.id)
    }
  }

  readAudio(id: string): { bytes: Uint8Array; mimeType: string } | null {
    const meeting = this.read(id)
    if (!meeting?.audio) return null
    try {
      return { bytes: new Uint8Array(readFileSync(join(this.dir(id), meeting.audio.file))), mimeType: meeting.audio.mimeType }
    } catch {
      return null
    }
  }

  audioPath(id: string): string | null {
    const meeting = this.read(id)
    return meeting?.audio ? join(this.dir(id), meeting.audio.file) : null
  }

  readTranscript(id: string): LocalTranscript | null {
    if (!isMeetingId(id)) return null
    try {
      return normalizeTranscript(JSON.parse(readFileSync(join(this.dir(id), 'transcript.json'), 'utf8')))
    } catch {
      return null
    }
  }

  readTranscriptRevision(id: string, revision: number): LocalTranscript | null {
    if (!Number.isSafeInteger(revision) || revision < 0 || !isMeetingId(id)) return null
    const current = this.readTranscript(id)
    if (current?.revision === revision) return current
    try {
      const path = join(this.dir(id), `transcript.revision-${revision}.json`)
      const transcript = normalizeTranscript(JSON.parse(readFileSync(path, 'utf8')))
      return transcript?.revision === revision ? transcript : null
    } catch {
      return null
    }
  }

  restoreTranscriptRevision(
    id: string,
    input: { expectedRevision: number; restoreRevision: number },
  ): MeetingsLocalResult<LocalTranscript> {
    if (!input || !Number.isSafeInteger(input.expectedRevision) || !Number.isSafeInteger(input.restoreRevision)) {
      return { ok: false, code: 'invalid-transcript-revision' }
    }
    const meeting = this.read(id)
    if (!meeting) return { ok: false, code: 'meeting-not-found' }
    if (meeting.transcript.status === 'queued' || meeting.transcript.status === 'running') {
      return { ok: false, code: 'transcription-in-progress' }
    }
    const current = this.readTranscript(id)
    if (!current) return { ok: false, code: 'transcript-not-found' }
    if (current.revision !== input.expectedRevision) return { ok: false, code: 'transcript-conflict' }
    if (input.restoreRevision >= current.revision) return { ok: false, code: 'invalid-transcript-revision' }
    const previous = this.readTranscriptRevision(id, input.restoreRevision)
    if (!previous) return { ok: false, code: 'transcript-revision-not-found' }
    const latestMeeting = this.read(id)
    const latest = this.readTranscript(id)
    if (!latestMeeting?.audio || !latest || latest.revision !== input.expectedRevision) {
      return { ok: false, code: 'transcript-conflict' }
    }
    const revision = latest.revision + 1
    const createdAt = this.now()
    const transcript: LocalTranscript = {
      ...previous,
      revision,
      createdAt,
      history: [...(latest.history ?? []), { revision, createdAt, reason: 'restored' }],
    }
    this.archiveTranscript(id, latest)
    this.writeTranscriptFiles(latestMeeting, transcript)
    this.mutate(id, (m) => ({
      ...m,
      transcript: {
        ...m.transcript,
        status: 'done',
        progress: 100,
        revision,
        provenance: transcript.provenance,
        language: transcript.language ?? undefined,
        segments: transcript.segments.length,
        finishedAt: createdAt,
      },
    }))
    return { ok: true, value: transcript }
  }

  // ── Transcription ────────────────────────────────────────────────────────

  /** Re-run (or first run) ASR for a meeting with audio. */
  transcribe(id: string): MeetingsLocalResult<LocalMeeting> {
    const meeting = this.read(id)
    if (!meeting) return { ok: false, code: 'meeting-not-found' }
    if (!meeting.audio) return { ok: false, code: 'no-audio' }
    if (meeting.transcript.status === 'queued' || meeting.transcript.status === 'running') {
      return { ok: true, value: meeting }
    }
    const engine = this.deps.detectEngine()
    const generation = (meeting.transcript.generation ?? 0) + 1
    const attempt = (meeting.transcript.attempt ?? 0) + 1
    if (!engine.ready) {
      const next = this.write({
        ...meeting,
        transcript: {
          ...meeting.transcript,
          status: 'unavailable',
          progress: 0,
          generation,
          attempt,
          error: engine.missing.join(','),
        },
      })
      return { ok: false, code: 'engine-unavailable', message: next.transcript.error }
    }
    const next = this.write({
      ...meeting,
      transcript: {
        status: 'queued',
        progress: 0,
        generation,
        attempt,
        revision: this.readTranscript(id)?.revision ?? 0,
      },
    })
    this.enqueue({ id, generation })
    return { ok: true, value: next }
  }

  cancelTranscription(id: string): MeetingsLocalResult<LocalMeeting> {
    const meeting = this.read(id)
    if (!meeting) return { ok: false, code: 'meeting-not-found' }
    if (meeting.transcript.status === 'cancelled') return { ok: true, value: meeting }
    if (meeting.transcript.status !== 'queued' && meeting.transcript.status !== 'running') {
      return { ok: false, code: 'transcription-not-cancellable' }
    }
    const generation = meeting.transcript.generation ?? 0
    this.queue.splice(0, this.queue.length, ...this.queue.filter((job) => job.id !== id || job.generation !== generation))
    const cancelled = this.write({
      ...meeting,
      transcript: { ...meeting.transcript, status: 'cancelled', error: undefined, finishedAt: this.now() },
    })
    if (this.activeTranscription?.job.id === id && this.activeTranscription.job.generation === generation) {
      this.activeTranscription.controller.abort()
    }
    return { ok: true, value: cancelled }
  }

  async updateTranscriptSegment(id: string, input: LocalTranscriptSegmentUpdate): Promise<MeetingsLocalResult<LocalTranscript>> {
    if (
      !input || !Number.isSafeInteger(input.expectedRevision) ||
      typeof input.segmentId !== 'string' || !input.segmentId ||
      !input.patch || typeof input.patch !== 'object' || Array.isArray(input.patch)
    ) return { ok: false, code: 'invalid-transcript-update' }
    const patchKeys = Object.keys(input.patch)
    if (patchKeys.length === 0 || patchKeys.some((key) => !['startMs', 'endMs', 'speakerId'].includes(key))) {
      return { ok: false, code: 'invalid-transcript-update' }
    }
    const meeting = this.read(id)
    if (!meeting) return { ok: false, code: 'meeting-not-found' }
    if (!meeting.audio) return { ok: false, code: 'no-audio' }
    const current = this.readTranscript(id)
    if (!current) return { ok: false, code: 'transcript-not-found' }
    if (current.revision !== input.expectedRevision) return { ok: false, code: 'transcript-conflict' }
    if (meeting.transcript.status === 'queued' || meeting.transcript.status === 'running') {
      return { ok: false, code: 'transcription-in-progress' }
    }
    const index = current.segments.findIndex((segment) => segment.id === input.segmentId)
    if (index < 0) return { ok: false, code: 'transcript-segment-not-found' }
    const oldSegment = current.segments[index]!
    const startMs = input.patch.startMs ?? oldSegment.startMs
    const endMs = input.patch.endMs ?? oldSegment.endMs
    const speakerId = input.patch.speakerId
    if ((input.patch.startMs !== undefined && !Number.isFinite(input.patch.startMs)) ||
        (input.patch.endMs !== undefined && !Number.isFinite(input.patch.endMs))) {
      return { ok: false, code: 'invalid-transcript-timecode' }
    }
    if (speakerId !== undefined && speakerId !== null && (typeof speakerId !== 'string' || speakerId.trim().length > 128)) {
      return { ok: false, code: 'invalid-speaker' }
    }
    const ffmpeg = this.deps.detectEngine().ffmpeg
    const probedDuration = await probeDurationMs(ffmpeg, this.audioPath(id) ?? '')
    const durationMs = probedDuration ?? meeting.durationMs
    if (durationMs <= 0) return { ok: false, code: 'audio-duration-unavailable' }
    if (startMs < 0 || startMs > endMs || endMs > durationMs) return { ok: false, code: 'invalid-transcript-timecode' }
    const latestMeeting = this.read(id)
    const latestTranscript = this.readTranscript(id)
    if (!latestMeeting?.audio) return { ok: false, code: 'meeting-not-found' }
    if (!latestTranscript || latestTranscript.revision !== input.expectedRevision) return { ok: false, code: 'transcript-conflict' }
    if (latestMeeting.transcript.status === 'queued' || latestMeeting.transcript.status === 'running') {
      return { ok: false, code: 'transcription-in-progress' }
    }
    const revision = latestTranscript.revision + 1
    const createdAt = this.now()
    const segments = latestTranscript.segments.map((segment, i) => i === index
      ? { ...segment, startMs, endMs, ...(speakerId === undefined ? {} : { speakerId: speakerId?.trim() || null }) }
      : segment)
    const transcript: LocalTranscript = {
      ...latestTranscript,
      revision,
      history: [...(latestTranscript.history ?? []), { revision, createdAt, reason: 'corrected' }],
      segments,
    }
    this.archiveTranscript(id, latestTranscript)
    this.writeTranscriptFiles(latestMeeting, transcript)
    this.mutate(id, (m) => ({
      ...m,
      transcript: { ...m.transcript, status: 'done', progress: 100, revision, segments: segments.length },
    }))
    return { ok: true, value: transcript }
  }

  /** Requeue durable work interrupted by an app quit; fence any prior attempt. */
  resumePending(): void {
    for (const meeting of this.list(null)) {
      if ((meeting.transcript.status !== 'queued' && meeting.transcript.status !== 'running') || !meeting.audio) continue
      const generation = meeting.transcript.status === 'running'
        ? (meeting.transcript.generation ?? 0) + 1
        : (meeting.transcript.generation ?? 1)
      const next = this.write({
        ...meeting,
        transcript: { ...meeting.transcript, status: 'queued', generation, progress: 0 },
      })
      this.enqueue({ id: next.id, generation })
    }
  }

  private enqueue(job: TranscriptionJob): void {
    if (this.transcribing?.id === job.id && this.transcribing.generation === job.generation) return
    if (this.queue.some((queued) => queued.id === job.id && queued.generation === job.generation)) return
    this.queue.push(job)
    void this.pump()
  }

  private async pump(): Promise<void> {
    if (this.transcribing) return
    const job = this.queue.shift()
    if (!job) return
    const meeting = this.read(job.id)
    if (!meeting?.audio || meeting.transcript.generation !== job.generation || meeting.transcript.status !== 'queued') {
      void this.pump()
      return
    }
    this.transcribing = job
    const controller = new AbortController()
    this.activeTranscription = { job, controller }
    try {
      await this.runTranscription(job, controller.signal)
    } catch (error) {
      this.deps.log?.(`[meetings-local] transcription failed for ${job.id}`, error)
      const current = this.read(job.id)
      if (current?.transcript.generation === job.generation && current.transcript.status === 'running' && !controller.signal.aborted) {
        this.mutate(job.id, (m) => ({
          ...m,
          transcript: { ...m.transcript, status: 'failed', error: error instanceof Error ? error.message : String(error), finishedAt: this.now() },
        }))
      }
    } finally {
      if (this.activeTranscription?.job.generation === job.generation && this.activeTranscription.job.id === job.id) {
        this.activeTranscription = null
      }
      if (this.transcribing?.generation === job.generation && this.transcribing.id === job.id) this.transcribing = null
      void this.pump()
    }
  }

  private isCurrentJob(job: TranscriptionJob, status: 'queued' | 'running'): LocalMeeting | null {
    const meeting = this.read(job.id)
    return meeting?.transcript.generation === job.generation && meeting.transcript.status === status ? meeting : null
  }

  private archiveTranscript(id: string, transcript: LocalTranscript): void {
    const dir = this.dir(id)
    const source = join(dir, 'transcript.json')
    if (!existsSync(source)) return
    const revision = transcript.revision
    const jsonArchive = join(dir, `transcript.revision-${revision}.json`)
    if (!existsSync(jsonArchive)) copyFileSync(source, jsonArchive)
    const markdown = join(dir, 'transcript.md')
    const markdownArchive = join(dir, `transcript.revision-${revision}.md`)
    if (existsSync(markdown) && !existsSync(markdownArchive)) copyFileSync(markdown, markdownArchive)
  }

  private writeTranscriptFiles(meeting: LocalMeeting, transcript: LocalTranscript): void {
    const dir = this.dir(meeting.id)
    const jsonPath = join(dir, 'transcript.json')
    const jsonTemp = `${jsonPath}.tmp-${process.pid}`
    const markdownPath = join(dir, 'transcript.md')
    const markdownTemp = `${markdownPath}.tmp-${process.pid}`
    writeFileSync(jsonTemp, `${JSON.stringify(transcript, null, 2)}\n`)
    writeFileSync(markdownTemp, transcriptMarkdown(meeting, transcript))
    renameSync(jsonTemp, jsonPath)
    renameSync(markdownTemp, markdownPath)
  }

  private async runTranscription(job: TranscriptionJob, signal: AbortSignal): Promise<void> {
    let meeting = this.isCurrentJob(job, 'queued')
    if (!meeting?.audio) return
    const engine = this.deps.detectEngine()
    if (!engine.ready || !engine.ffmpeg) {
      this.mutate(job.id, (m) => m.transcript.generation === job.generation
        ? { ...m, transcript: { ...m.transcript, status: 'unavailable', progress: 0, error: engine.missing.join(',') } }
        : m)
      return
    }
    const dir = this.dir(job.id)
    const startedAt = this.now()
    const running = this.mutate(job.id, (m) => m.transcript.generation === job.generation && m.transcript.status === 'queued'
      ? { ...m, transcript: { ...m.transcript, status: 'running', progress: 0, engine: engine.engine ?? undefined, model: engine.model ?? undefined, startedAt, error: undefined } }
      : m)
    if (!running || running.transcript.status !== 'running' || running.transcript.generation !== job.generation) return
    meeting = running
    const wav = join(dir, '.asr.wav')
    const outBase = join(dir, '.asr')
    for (const stale of [wav, `${outBase}.json`]) {
      try { rmSync(stale, { force: true }) } catch { /* ignore */ }
    }
    try {
      const audioPath = join(dir, meeting.audio!.file)
      const sourceHash = meeting.audio!.sourceHash ?? await sha256File(audioPath).catch(() => undefined)
      if (signal.aborted || !this.isCurrentJob(job, 'running')) return
      if (sourceHash && meeting.audio!.sourceHash !== sourceHash) {
        meeting = this.mutate(job.id, (m) => m.transcript.generation === job.generation
          ? { ...m, audio: m.audio ? { ...m.audio, sourceHash } : null }
          : m) ?? meeting
      }
      const decoded = await decodeToWav(engine.ffmpeg, audioPath, wav, signal)
      if (signal.aborted || !this.isCurrentJob(job, 'running')) return
      if (decoded.code !== 0) throw new Error(`ffmpeg: ${decoded.stderr.trim().split('\n').pop() ?? 'decode failed'}`)
      let lastEmit = 0
      const res = await runWhisper(engine, wav, outBase, (pct) => {
        const t = this.now()
        if (t - lastEmit < 800 && pct < 100) return
        lastEmit = t
        if (this.isCurrentJob(job, 'running') && !signal.aborted) {
          this.mutate(job.id, (m) => ({ ...m, transcript: { ...m.transcript, progress: pct } }))
        }
      }, signal)
      if (signal.aborted || !this.isCurrentJob(job, 'running')) return
      const hasOutput = existsSync(`${outBase}.json`)
      if (!hasOutput) throw new Error(`whisper-cli exit ${res.code}: ${res.stderr.trim().split('\n').slice(-2).join(' ').slice(0, 300)}`)
      const parsed = parseWhisperJson(JSON.parse(readFileSync(`${outBase}.json`, 'utf8')))
      if (res.code !== 0 && parsed.segments.length === 0) {
        throw new Error(`whisper-cli exit ${res.code}: ${res.stderr.trim().split('\n').slice(-2).join(' ').slice(0, 300)}`)
      }
      const finishedAt = this.now()
      const previous = this.readTranscript(job.id)
      const revision = (previous?.revision ?? 0) + 1
      const transcript: LocalTranscript = {
        engine: engine.engine ?? 'whisper.cpp',
        model: engine.model ?? 'unknown',
        language: parsed.language,
        createdAt: finishedAt,
        elapsedMs: finishedAt - startedAt,
        revision,
        history: [...(previous?.history ?? []), { revision, createdAt: finishedAt, reason: 'transcribed' }],
        provenance: {
          sourceKind: meeting.source,
          sourceHash,
          engine: engine.engine ?? 'whisper.cpp',
          model: engine.model ?? 'unknown',
          generatedAt: finishedAt,
        },
        segments: parsed.segments,
      }
      if (!this.isCurrentJob(job, 'running')) return
      if (previous) this.archiveTranscript(job.id, previous)
      this.writeTranscriptFiles(meeting, transcript)
      this.mutate(job.id, (m) => {
        if (m.transcript.generation !== job.generation || m.transcript.status !== 'running') return m
        return {
          ...m,
          transcript: {
            ...m.transcript,
            status: res.code === 0 ? 'done' : 'partial',
            progress: res.code === 0 ? 100 : Math.min(m.transcript.progress, 99),
            revision,
            provenance: transcript.provenance,
            language: transcript.language ?? undefined,
            segments: transcript.segments.length,
            finishedAt,
            error: res.code === 0 ? undefined : `whisper-cli exit ${res.code}: partial transcript retained`,
          },
        }
      })
    } finally {
      for (const f of [wav, `${outBase}.json`]) {
        try { rmSync(f, { force: true }) } catch { /* ignore */ }
      }
    }
  }

  // ── Documents ────────────────────────────────────────────────────────────

  attach(id: string, paths: readonly string[]): LocalMeeting | null {
    const meeting = this.read(id)
    if (!meeting) return null
    const docsDir = join(this.dir(id), 'documents')
    mkdirSync(docsDir, { recursive: true })
    const taken = new Set(readdirSync(docsDir))
    const added = [...meeting.documents]
    for (const path of paths) {
      try {
        const st = statSync(path)
        if (!st.isFile()) continue
        const file = uniqueName(basename(path), taken)
        taken.add(file)
        copyFileSync(path, join(docsDir, file))
        added.push({ id: `d-${this.now().toString(36)}-${added.length}`, name: basename(path), file, bytes: st.size, addedAt: this.now() })
      } catch (error) {
        this.deps.log?.(`[meetings-local] attach failed: ${path}`, error)
      }
    }
    return this.mutate(id, (m) => ({ ...m, documents: added }))
  }

  documentPath(id: string, docId: string): string | null {
    const doc = this.read(id)?.documents.find((d) => d.id === docId)
    return doc ? join(this.dir(id), 'documents', doc.file) : null
  }

  removeDocument(id: string, docId: string): LocalMeeting | null {
    const path = this.documentPath(id, docId)
    if (path) {
      try { rmSync(path, { force: true }) } catch { /* ignore */ }
    }
    return this.mutate(id, (m) => ({ ...m, documents: m.documents.filter((d) => d.id !== docId) }))
  }
}
