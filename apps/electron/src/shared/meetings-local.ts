/**
 * Local meeting recordings (Встречи) — the device-side store shared by main,
 * preload and renderer. Each meeting is a folder `<configDir>/meetings/<id>/`
 * with meeting.json, the audio file, transcript.json/.md and documents/.
 * Capture/import and Whisper transcription are device-local. Explicit summary
 * generation uses the ordinary configured agent model/provider separately.
 */

export const MEETINGS_LOCAL_SCHEMA = 1
export const MEETING_SOURCE_SEEK_SESSION_KEY = 'rox.meetings.sourceSeek.v1'

export const MEETINGS_LOCAL_IPC = {
  LIST: 'meetings-local:list',
  GET: 'meetings-local:get',
  CREATE: 'meetings-local:create',
  UPDATE: 'meetings-local:update',
  TRASH: 'meetings-local:trash',
  REC_START: 'meetings-local:rec-start',
  REC_CHUNK: 'meetings-local:rec-chunk',
  REC_STATE: 'meetings-local:rec-state',
  REC_STOP: 'meetings-local:rec-stop',
  RECOVER: 'meetings-local:recover',
  IMPORT_AUDIO: 'meetings-local:import-audio',
  READ_AUDIO: 'meetings-local:read-audio',
  IMPORT_CANCEL: 'meetings-local:import-cancel',
  READ_TRANSCRIPT: 'meetings-local:read-transcript',
  READ_TRANSCRIPT_REVISION: 'meetings-local:read-transcript-revision',
  RESTORE_TRANSCRIPT_REVISION: 'meetings-local:restore-transcript-revision',
  TRANSCRIBE: 'meetings-local:transcribe',
  TRANSCRIBE_CANCEL: 'meetings-local:transcribe-cancel',
  TRANSCRIPT_SEGMENT_UPDATE: 'meetings-local:transcript-segment-update',
  ENGINE: 'meetings-local:engine',
  MIC_ACCESS: 'meetings-local:mic-access',
  ATTACH: 'meetings-local:attach',
  OPEN_DOC: 'meetings-local:open-doc',
  REVEAL: 'meetings-local:reveal',
  REMOVE_DOC: 'meetings-local:remove-doc',
  CHANGED: 'meetings-local:changed',
} as const

export type LocalMeetingStatus = 'planned' | 'recording' | 'paused' | 'ready'
export type LocalMeetingSource = 'microphone' | 'import' | 'none'
export type TranscriptStatus = 'none' | 'queued' | 'running' | 'done' | 'failed' | 'unavailable' | 'cancelled' | 'partial'

export interface LocalMeetingAudio {
  file: string
  mimeType: string
  bytes: number
  originalName?: string
  /** SHA-256 of the committed local audio when available. */
  sourceHash?: string
  /** Recovered after the app or renderer stopped mid-recording. */
  recovered?: boolean
}

export interface LocalMeetingTranscriptState {
  status: TranscriptStatus
  progress: number
  /** Monotonically increases for each transcription request; stale workers cannot publish. */
  generation?: number
  attempt?: number
  engine?: string
  model?: string
  language?: string
  error?: string
  segments?: number
  startedAt?: number
  finishedAt?: number
  revision?: number
  provenance?: LocalTranscriptProvenance
}

export interface LocalTranscriptProvenance {
  sourceKind: LocalMeetingSource
  sourceHash?: string
  engine?: string
  model?: string
  generatedAt?: number
}

export interface LocalMeetingQuestion {
  id: string
  text: string
  sourceSegmentIds: string[]
  createdAt: number
}

export interface LocalMeetingAction {
  id: string
  text: string
  done: boolean
  taskId?: string
  generated?: boolean
  sourceSegmentIds?: string[]
  sourceTranscriptRevision?: number
  createdAt: number
}

export interface LocalMeetingDocument {
  id: string
  name: string
  file: string
  bytes: number
  addedAt: number
}

export interface LocalMeetingSummary {
  text: string
  generated: boolean
  sessionId?: string
  sourceSegmentIds?: string[]
  sourceTranscriptRevision?: number
  questions?: LocalMeetingQuestion[]
  updatedAt: number
}

export interface LocalMeeting {
  schema: typeof MEETINGS_LOCAL_SCHEMA
  id: string
  title: string
  workspaceId: string | null
  createdAt: number
  /** Planned start (upcoming meetings); undefined for ad-hoc recordings. */
  scheduledAt?: number
  startedAt?: number
  endedAt?: number
  durationMs: number
  status: LocalMeetingStatus
  source: LocalMeetingSource
  participants: string[]
  notes: string
  /** User-selected analysis profile; does not grant tools or background work. */
  recipeId?: import('@rox/shared/meeting-agents').MeetingProfileId
  audio: LocalMeetingAudio | null
  transcript: LocalMeetingTranscriptState
  summary: LocalMeetingSummary | null
  summaryRun?: { sessionId: string; startedAt: number; transcriptRevision?: number }
  actions: LocalMeetingAction[]
  documents: LocalMeetingDocument[]
  updatedAt: number
}

export interface LocalTranscriptSegment {
  id: string
  startMs: number
  endMs: number
  text: string
  /** Human-correctable only when no diarization engine provides a label. */
  speakerId?: string | null
}

export interface LocalTranscriptRevision {
  revision: number
  createdAt: number
  reason: 'transcribed' | 'corrected' | 'restored'
}

export interface LocalTranscript {
  engine: string
  model: string
  language: string | null
  createdAt: number
  elapsedMs: number
  /** Zero is reserved for normalized legacy transcripts without revision metadata. */
  revision: number
  history?: LocalTranscriptRevision[]
  provenance?: LocalTranscriptProvenance
  segments: LocalTranscriptSegment[]
}

export interface LocalTranscriptSegmentPatch {
  startMs?: number
  endMs?: number
  speakerId?: string | null
}

export interface LocalTranscriptSegmentUpdate {
  expectedRevision: number
  segmentId: string
  patch: LocalTranscriptSegmentPatch
}

export interface LocalAsrEngine {
  ready: boolean
  engine: string | null
  binary: string | null
  model: string | null
  modelPath: string | null
  ffmpeg: string | null
  /** Why it isn't ready: 'no-whisper' | 'no-model' | 'no-ffmpeg'. */
  missing: string[]
}

export type LocalMeetingPatch = Partial<Pick<LocalMeeting,
  'title' | 'participants' | 'notes' | 'recipeId' | 'scheduledAt' | 'actions' | 'summary' | 'summaryRun'>>

export type MeetingsLocalResult<T> = { ok: true; value: T } | { ok: false; code: string; message?: string }

export interface MeetingsLocalApi {
  list(workspaceId: string | null): Promise<LocalMeeting[]>
  get(id: string): Promise<LocalMeeting | null>
  create(input: { title: string; workspaceId: string | null; scheduledAt?: number }): Promise<LocalMeeting>
  update(id: string, patch: LocalMeetingPatch): Promise<LocalMeeting | null>
  trash(id: string): Promise<boolean>
  recStart(input: { meetingId?: string; title: string; workspaceId: string | null; mimeType: string }): Promise<MeetingsLocalResult<LocalMeeting>>
  recChunk(meetingId: string, chunk: Uint8Array): Promise<boolean>
  recState(meetingId: string, state: { paused: boolean; durationMs: number }): Promise<void>
  recStop(meetingId: string, input: { durationMs: number }): Promise<MeetingsLocalResult<LocalMeeting>>
  recover(): Promise<string[]>
  importAudio(input: { requestId: string; meetingId?: string; workspaceId: string | null; path?: string }): Promise<MeetingsLocalResult<LocalMeeting> | null>
  cancelImport(requestId: string): Promise<boolean>
  readAudio(id: string): Promise<{ bytes: Uint8Array; mimeType: string } | null>
  readTranscript(id: string): Promise<LocalTranscript | null>
  readTranscriptRevision(id: string, revision: number): Promise<LocalTranscript | null>
  restoreTranscriptRevision(id: string, input: { expectedRevision: number; restoreRevision: number }): Promise<MeetingsLocalResult<LocalTranscript>>
  updateTranscriptSegment(id: string, input: LocalTranscriptSegmentUpdate): Promise<MeetingsLocalResult<LocalTranscript>>
  cancelTranscription(id: string): Promise<MeetingsLocalResult<LocalMeeting>>
  transcribe(id: string): Promise<MeetingsLocalResult<LocalMeeting>>
  engine(): Promise<LocalAsrEngine>
  micAccess(ask: boolean): Promise<'granted' | 'denied' | 'restricted' | 'not-determined' | 'unknown'>
  attach(id: string, paths?: string[]): Promise<LocalMeeting | null>
  openDocument(id: string, docId: string): Promise<boolean>
  reveal(id: string, docId?: string): Promise<boolean>
  removeDocument(id: string, docId: string): Promise<LocalMeeting | null>
  onChanged(cb: (event: { id: string }) => void): () => void
}
