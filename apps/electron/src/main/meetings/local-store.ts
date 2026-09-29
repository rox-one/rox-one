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
import { basename, extname, join } from 'node:path'
import type {
  LocalAsrEngine,
  LocalMeeting,
  LocalMeetingPatch,
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
  parseWhisperJson,
  transcriptMarkdown,
  uniqueName,
} from './local-model'
import { decodeToWav, probeDurationMs, remuxAudio, runWhisper } from './local-asr'

export const MAX_IMPORT_BYTES = 2 * 1024 * 1024 * 1024

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
  private readonly queue: string[] = []
  private transcribing: string | null = null
  private readonly finalizing = new Set<string>()

  constructor(private readonly deps: LocalMeetingStoreDeps) {
    mkdirSync(deps.root, { recursive: true })
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now()
  }

  dir(id: string): string {
    if (!isMeetingId(id)) throw new Error('invalid-meeting-id')
    return join(this.deps.root, id)
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
    return !this.active.has(id) && this.transcribing !== id && !!this.read(id)
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
    const next = this.write({
      ...meeting,
      status: 'ready',
      endedAt,
      durationMs,
      audio: { file: finalName, mimeType, bytes: statSync(finalPath).size, recovered: input.recovered || undefined },
      transcript: { status: engine.ready ? 'queued' : 'unavailable', progress: 0, error: engine.ready ? undefined : engine.missing.join(',') },
      updatedAt: this.now(),
    })
    if (engine.ready) this.enqueue(id)
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

  async importAudio(input: { path: string; meetingId?: string; workspaceId: string | null }): Promise<MeetingsLocalResult<LocalMeeting>> {
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
    const originalName = basename(input.path)
    if (!meeting) meeting = this.create({ title: originalName.replace(/\.[^.]+$/, ''), workspaceId: input.workspaceId })
    const finalName = `audio.${ext}`
    const finalPath = join(this.dir(meeting.id), finalName)
    copyFileSync(input.path, finalPath)
    const engine = this.deps.detectEngine()
    const durationMs = (await probeDurationMs(engine.ffmpeg, finalPath)) ?? 0
    const startedAt = meeting.startedAt ?? Math.max(0, Math.round(st.mtimeMs) - durationMs)
    const next = this.write({
      ...meeting,
      status: 'ready',
      source: 'import',
      startedAt,
      endedAt: startedAt + durationMs,
      durationMs,
      audio: { file: finalName, mimeType, bytes: st.size, originalName },
      transcript: { status: engine.ready ? 'queued' : 'unavailable', progress: 0, error: engine.ready ? undefined : engine.missing.join(',') },
      updatedAt: this.now(),
    })
    if (engine.ready) this.enqueue(meeting.id)
    return { ok: true, value: next }
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
      const raw = JSON.parse(readFileSync(join(this.dir(id), 'transcript.json'), 'utf8')) as LocalTranscript
      return Array.isArray(raw?.segments) ? raw : null
    } catch {
      return null
    }
  }

  // ── Transcription ────────────────────────────────────────────────────────

  /** Re-run (or first run) ASR for a meeting with audio. */
  transcribe(id: string): MeetingsLocalResult<LocalMeeting> {
    const meeting = this.read(id)
    if (!meeting) return { ok: false, code: 'meeting-not-found' }
    if (!meeting.audio) return { ok: false, code: 'no-audio' }
    const engine = this.deps.detectEngine()
    if (!engine.ready) {
      const next = this.write({ ...meeting, transcript: { status: 'unavailable', progress: 0, error: engine.missing.join(',') } })
      return { ok: false, code: 'engine-unavailable', message: next.transcript.error }
    }
    if (this.transcribing === id || this.queue.includes(id)) return { ok: true, value: meeting }
    const next = this.write({ ...meeting, transcript: { status: 'queued', progress: 0 } })
    this.enqueue(id)
    return { ok: true, value: next }
  }

  /** Requeue jobs interrupted by a quit (status queued/running on disk). */
  resumePending(): void {
    for (const meeting of this.list(null)) {
      if ((meeting.transcript.status === 'queued' || meeting.transcript.status === 'running') && meeting.audio) this.enqueue(meeting.id)
    }
  }

  private enqueue(id: string): void {
    if (this.transcribing === id || this.queue.includes(id)) return
    this.queue.push(id)
    void this.pump()
  }

  private async pump(): Promise<void> {
    if (this.transcribing) return
    const id = this.queue.shift()
    if (!id) return
    this.transcribing = id
    try {
      await this.runTranscription(id)
    } catch (error) {
      this.deps.log?.(`[meetings-local] transcription failed for ${id}`, error)
      this.mutate(id, (m) => ({ ...m, transcript: { ...m.transcript, status: 'failed', error: error instanceof Error ? error.message : String(error) } }))
    } finally {
      this.transcribing = null
      void this.pump()
    }
  }

  private async runTranscription(id: string): Promise<void> {
    const meeting = this.read(id)
    if (!meeting?.audio) return
    const engine = this.deps.detectEngine()
    if (!engine.ready || !engine.ffmpeg) {
      this.mutate(id, (m) => ({ ...m, transcript: { status: 'unavailable', progress: 0, error: engine.missing.join(',') } }))
      return
    }
    const dir = this.dir(id)
    const startedAt = this.now()
    this.mutate(id, (m) => ({ ...m, transcript: { status: 'running', progress: 0, engine: engine.engine ?? undefined, model: engine.model ?? undefined, startedAt } }))
    const wav = join(dir, '.asr.wav')
    const outBase = join(dir, '.asr')
    try {
      const decoded = await decodeToWav(engine.ffmpeg, join(dir, meeting.audio.file), wav)
      if (decoded.code !== 0) throw new Error(`ffmpeg: ${decoded.stderr.trim().split('\n').pop() ?? 'decode failed'}`)
      let lastEmit = 0
      const res = await runWhisper(engine, wav, outBase, (pct) => {
        const t = this.now()
        if (t - lastEmit < 800 && pct < 100) return
        lastEmit = t
        this.mutate(id, (m) => ({ ...m, transcript: { ...m.transcript, status: 'running', progress: pct } }))
      })
      if (res.code !== 0 || !existsSync(`${outBase}.json`)) {
        throw new Error(`whisper-cli exit ${res.code}: ${res.stderr.trim().split('\n').slice(-2).join(' ').slice(0, 300)}`)
      }
      const parsed = parseWhisperJson(JSON.parse(readFileSync(`${outBase}.json`, 'utf8')))
      const finishedAt = this.now()
      const transcript: LocalTranscript = {
        engine: engine.engine ?? 'whisper.cpp',
        model: engine.model ?? 'unknown',
        language: parsed.language,
        createdAt: finishedAt,
        elapsedMs: finishedAt - startedAt,
        segments: parsed.segments,
      }
      writeFileSync(join(dir, 'transcript.json'), `${JSON.stringify(transcript, null, 2)}\n`)
      const fresh = this.read(id) ?? meeting
      writeFileSync(join(dir, 'transcript.md'), transcriptMarkdown(fresh, transcript))
      this.mutate(id, (m) => ({
        ...m,
        transcript: {
          status: 'done',
          progress: 100,
          engine: transcript.engine,
          model: transcript.model,
          language: transcript.language ?? undefined,
          segments: transcript.segments.length,
          startedAt,
          finishedAt,
        },
      }))
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
