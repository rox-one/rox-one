/**
 * Pure helpers for the local meeting store: normalization of meeting.json,
 * whisper.cpp JSON parsing, transcript markdown, model choice. No I/O.
 */
import {
  MEETINGS_LOCAL_SCHEMA,
  type LocalMeeting,
  type LocalMeetingAction,
  type LocalMeetingDocument,
  type LocalMeetingPatch,
  type LocalTranscript,
  type LocalTranscriptSegment,
  type TranscriptStatus,
} from '../../shared/meetings-local'

export const MEETING_ID_RE = /^m-[0-9a-z-]{4,64}$/

export function isMeetingId(id: unknown): id is string {
  return typeof id === 'string' && MEETING_ID_RE.test(id)
}

export function newMeetingId(now: number, rand: () => number = Math.random): string {
  const d = new Date(now)
  const p = (n: number) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  const suffix = Math.floor(rand() * 36 ** 4).toString(36).padStart(4, '0')
  return `m-${stamp}-${suffix}`
}

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback)
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const TRANSCRIPT_STATUSES: TranscriptStatus[] = ['none', 'queued', 'running', 'done', 'failed', 'unavailable']

function normActions(v: unknown): LocalMeetingAction[] {
  if (!Array.isArray(v)) return []
  return v.flatMap((a, i): LocalMeetingAction[] => {
    if (!a || typeof a !== 'object') return []
    const o = a as Record<string, unknown>
    const text = str(o.text).trim()
    if (!text) return []
    return [{
      id: str(o.id) || `a-${i}`,
      text,
      done: o.done === true,
      taskId: str(o.taskId) || undefined,
      generated: o.generated === true || undefined,
      createdAt: num(o.createdAt) ?? 0,
    }]
  })
}

function normDocuments(v: unknown): LocalMeetingDocument[] {
  if (!Array.isArray(v)) return []
  return v.flatMap((d): LocalMeetingDocument[] => {
    if (!d || typeof d !== 'object') return []
    const o = d as Record<string, unknown>
    const file = str(o.file)
    if (!file || file.includes('/') || file.includes('\\') || file.startsWith('.')) return []
    return [{ id: str(o.id) || file, name: str(o.name) || file, file, bytes: num(o.bytes) ?? 0, addedAt: num(o.addedAt) ?? 0 }]
  })
}

/** Tolerant reader for meeting.json — never throws; null when it isn't a meeting. */
export function normalizeMeeting(raw: unknown, id: string): LocalMeeting | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const createdAt = num(o.createdAt) ?? 0
  const status = o.status === 'recording' || o.status === 'paused' || o.status === 'planned' ? o.status : 'ready'
  const t = (o.transcript && typeof o.transcript === 'object' ? o.transcript : {}) as Record<string, unknown>
  const tStatus = TRANSCRIPT_STATUSES.includes(t.status as TranscriptStatus) ? (t.status as TranscriptStatus) : 'none'
  const a = (o.audio && typeof o.audio === 'object' ? o.audio : null) as Record<string, unknown> | null
  const audioFile = a ? str(a.file) : ''
  const s = (o.summary && typeof o.summary === 'object' ? o.summary : null) as Record<string, unknown> | null
  const run = (o.summaryRun && typeof o.summaryRun === 'object' ? o.summaryRun : null) as Record<string, unknown> | null
  return {
    schema: MEETINGS_LOCAL_SCHEMA,
    id,
    title: str(o.title).trim() || id,
    workspaceId: str(o.workspaceId) || null,
    createdAt,
    scheduledAt: num(o.scheduledAt),
    startedAt: num(o.startedAt),
    endedAt: num(o.endedAt),
    durationMs: Math.max(0, num(o.durationMs) ?? 0),
    status,
    source: o.source === 'microphone' || o.source === 'import' ? o.source : 'none',
    participants: Array.isArray(o.participants) ? o.participants.map((p) => str(p).trim()).filter(Boolean) : [],
    notes: str(o.notes),
    audio: audioFile && !audioFile.includes('/') && !audioFile.includes('\\')
      ? {
          file: audioFile,
          mimeType: str(a?.mimeType, 'audio/webm'),
          bytes: num(a?.bytes) ?? 0,
          originalName: str(a?.originalName) || undefined,
          recovered: a?.recovered === true || undefined,
        }
      : null,
    transcript: {
      status: tStatus,
      progress: Math.min(100, Math.max(0, num(t.progress) ?? 0)),
      engine: str(t.engine) || undefined,
      model: str(t.model) || undefined,
      language: str(t.language) || undefined,
      error: str(t.error) || undefined,
      segments: num(t.segments),
      startedAt: num(t.startedAt),
      finishedAt: num(t.finishedAt),
    },
    summary: s && str(s.text).trim()
      ? { text: str(s.text), generated: s.generated === true, sessionId: str(s.sessionId) || undefined, updatedAt: num(s.updatedAt) ?? 0 }
      : null,
    summaryRun: run && str(run.sessionId) ? { sessionId: str(run.sessionId), startedAt: num(run.startedAt) ?? 0 } : undefined,
    actions: normActions(o.actions),
    documents: normDocuments(o.documents),
    updatedAt: num(o.updatedAt) ?? createdAt,
  }
}

export function emptyLocalMeeting(input: { id: string; title: string; workspaceId: string | null; now: number; scheduledAt?: number }): LocalMeeting {
  return {
    schema: MEETINGS_LOCAL_SCHEMA,
    id: input.id,
    title: input.title.trim() || input.id,
    workspaceId: input.workspaceId,
    createdAt: input.now,
    scheduledAt: input.scheduledAt,
    durationMs: 0,
    status: input.scheduledAt ? 'planned' : 'ready',
    source: 'none',
    participants: [],
    notes: '',
    audio: null,
    transcript: { status: 'none', progress: 0 },
    summary: null,
    actions: [],
    documents: [],
    updatedAt: input.now,
  }
}

/** Only user-editable fields pass; everything else is owned by main. */
export function applyPatch(meeting: LocalMeeting, patch: LocalMeetingPatch, now: number): LocalMeeting {
  const next: LocalMeeting = { ...meeting, updatedAt: now }
  if (typeof patch.title === 'string') next.title = patch.title.trim() || meeting.title
  if (Array.isArray(patch.participants)) next.participants = patch.participants.map((p) => String(p).trim()).filter(Boolean).slice(0, 100)
  if (typeof patch.notes === 'string') next.notes = patch.notes.slice(0, 200_000)
  if ('scheduledAt' in patch) {
    next.scheduledAt = typeof patch.scheduledAt === 'number' && Number.isFinite(patch.scheduledAt) ? patch.scheduledAt : undefined
    if (next.status === 'planned' && !next.scheduledAt) next.status = 'ready'
  }
  if (Array.isArray(patch.actions)) next.actions = normActions(patch.actions)
  if ('summary' in patch) {
    const s = patch.summary
    next.summary = s && typeof s.text === 'string' && s.text.trim()
      ? { text: s.text.slice(0, 100_000), generated: s.generated === true, sessionId: s.sessionId, updatedAt: now }
      : null
  }
  if ('summaryRun' in patch) {
    next.summaryRun = patch.summaryRun && typeof patch.summaryRun.sessionId === 'string' ? patch.summaryRun : undefined
  }
  return next
}

const AUDIO_EXT_MIME: Record<string, string> = {
  webm: 'audio/webm',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  flac: 'audio/flac',
  aif: 'audio/aiff',
  aiff: 'audio/aiff',
  caf: 'audio/x-caf',
  mov: 'video/quicktime',
}

export const IMPORTABLE_AUDIO_EXTENSIONS = Object.keys(AUDIO_EXT_MIME)

export function mimeForAudioExt(ext: string): string | null {
  return AUDIO_EXT_MIME[ext.toLowerCase().replace(/^\./, '')] ?? null
}

export function extForRecorderMime(mime: string): string {
  const m = mime.toLowerCase()
  if (m.includes('ogg')) return 'ogg'
  if (m.includes('mp4') || m.includes('aac')) return 'm4a'
  return 'webm'
}

/** «00:00:02,000» / «00:01:02.500» → ms. */
export function parseWhisperTimestamp(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined
  const m = /^(\d+):(\d{2}):(\d{2})[.,](\d{1,3})$/.exec(value.trim())
  if (!m) return undefined
  return ((Number(m[1]) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 + Number(m[4]!.padEnd(3, '0'))
}

/** whisper.cpp `-oj` output → segments + detected language. */
export function parseWhisperJson(raw: unknown): { language: string | null; segments: LocalTranscriptSegment[] } {
  if (!raw || typeof raw !== 'object') return { language: null, segments: [] }
  const o = raw as Record<string, unknown>
  const result = (o.result && typeof o.result === 'object' ? o.result : {}) as Record<string, unknown>
  const language = str(result.language) || null
  const list = Array.isArray(o.transcription) ? o.transcription : []
  const segments: LocalTranscriptSegment[] = []
  list.forEach((item, index) => {
    if (!item || typeof item !== 'object') return
    const it = item as Record<string, unknown>
    const text = str(it.text).replace(/\s+/g, ' ').trim()
    if (!text || /^\[(BLANK_AUDIO|MUSIC|NOISE|SILENCE)\]$/i.test(text)) return
    const offsets = (it.offsets && typeof it.offsets === 'object' ? it.offsets : {}) as Record<string, unknown>
    const stamps = (it.timestamps && typeof it.timestamps === 'object' ? it.timestamps : {}) as Record<string, unknown>
    const startMs = num(offsets.from) ?? parseWhisperTimestamp(stamps.from) ?? 0
    const endMs = num(offsets.to) ?? parseWhisperTimestamp(stamps.to) ?? startMs
    segments.push({ id: `s${index}`, startMs, endMs: Math.max(endMs, startMs), text })
  })
  return { language, segments }
}

/** whisper-cli `-pp` prints «progress = 45%». Returns the last percentage in a chunk. */
export function parseWhisperProgress(chunk: string): number | null {
  const all = [...chunk.matchAll(/progress\s*=\s*(\d{1,3})%/g)]
  const last = all[all.length - 1]
  return last ? Math.min(100, Number(last[1])) : null
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const p = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`
}

/** ISO-8601 in the machine's local zone with its offset, e.g. 2026-09-29T17:51:14+03:00. */
export function localIsoString(d: Date): string {
  const p = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, '0')
  const off = -d.getTimezoneOffset()
  const sign = off >= 0 ? '+' : '-'
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}${sign}${p(off / 60)}:${p(off % 60)}`
}

export function transcriptMarkdown(meeting: Pick<LocalMeeting, 'title' | 'startedAt' | 'createdAt' | 'durationMs'>, transcript: LocalTranscript): string {
  const when = localIsoString(new Date(meeting.startedAt ?? meeting.createdAt))
  const lines = [
    `# ${meeting.title}`,
    '',
    `- date: ${when}`,
    `- duration: ${formatClock(meeting.durationMs)}`,
    `- engine: ${transcript.engine} (${transcript.model})`,
    `- language: ${transcript.language ?? 'auto'}`,
    '',
  ]
  for (const seg of transcript.segments) lines.push(`[${formatClock(seg.startMs)}] ${seg.text}`)
  return `${lines.join('\n')}\n`
}

const MODEL_PREFERENCE = [
  /large-v3-turbo-q5/,
  /large-v3-turbo-q8/,
  /large-v3-turbo\.bin$/,
  /large-v3-turbo/,
  /large-v3/,
  /medium/,
  /small/,
  /base/,
  /tiny/,
]

/** Choose the best installed ggml model file name (ignores partial/VAD/test files). */
export function pickWhisperModel(files: readonly string[]): string | null {
  const usable = files.filter((f) => /^ggml-.*\.bin$/.test(f) && !/silero|vad|for-tests|\.part$/.test(f))
  for (const re of MODEL_PREFERENCE) {
    const hit = usable.find((f) => re.test(f))
    if (hit) return hit
  }
  return usable[0] ?? null
}

export function modelLabel(file: string): string {
  return file.replace(/^ggml-/, '').replace(/\.bin$/, '')
}

/** Unique file name inside a folder: «doc.pdf», «doc (2).pdf», … */
export function uniqueName(name: string, taken: ReadonlySet<string>): string {
  const safe = name.replace(/[/\\:\0]/g, '_').replace(/^\.+/, '_') || 'file'
  if (!taken.has(safe)) return safe
  const dot = safe.lastIndexOf('.')
  const stem = dot > 0 ? safe.slice(0, dot) : safe
  const ext = dot > 0 ? safe.slice(dot) : ''
  for (let i = 2; i < 10_000; i += 1) {
    const candidate = `${stem} (${i})${ext}`
    if (!taken.has(candidate)) return candidate
  }
  return `${stem}-${Date.now()}${ext}`
}
