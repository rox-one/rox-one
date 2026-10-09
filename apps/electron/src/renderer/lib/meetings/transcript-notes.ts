/**
 * Встречи → «Мои транскрипты» mirror. When a local meeting's transcription
 * finishes, the finished transcript is filed into the notes vault exactly once
 * per meeting generation. The observer is mounted app-wide (not page-scoped) so
 * a transcript that finished while the Встречи screen is closed still lands in
 * the vault as soon as the app notices the change.
 */
import { useEffect } from 'react'
import i18n from 'i18next'
import { toast } from 'sonner'
import type { LocalMeeting, LocalTranscriptSegment, MeetingsLocalApi } from '../../../shared/meetings-local'
import { recordTranscript, type TranscriptRecordInput, type TranscriptRecordResult } from '../transcripts/notes'
import { get, KEYS, set } from '../local-storage'
import { meetingsApi } from './recorder'

/** Only the read side of the meetings API is needed to mirror a transcript. */
export type TranscriptMirrorApi = Pick<MeetingsLocalApi, 'readTranscript'>

/**
 * Dedupe key: one note per meeting generation. A re-render, remount or a second
 * observation of the same finished transcript must never create a second note;
 * a re-transcription bumps `generation` and therefore files a new note.
 */
export function transcriptMirrorKey(meeting: Pick<LocalMeeting, 'id' | 'transcript'>): string | null {
  if (meeting.transcript.status !== 'done') return null
  return `${meeting.id}:${meeting.transcript.generation ?? 0}`
}

/**
 * Plain-text projection of diarized segments: consecutive segments of one
 * speaker form a paragraph, a newline separates speakers' paragraphs.
 */
export function transcriptMirrorText(segments: readonly LocalTranscriptSegment[]): string {
  const paragraphs: Array<{ speaker: string | null; parts: string[] }> = []
  for (const segment of segments) {
    const text = segment.text.trim()
    if (!text) continue
    const speaker = segment.speakerId?.trim() || null
    const current = paragraphs.at(-1)
    if (current && current.speaker === speaker) current.parts.push(text)
    else paragraphs.push({ speaker, parts: [text] })
  }
  return paragraphs.map((paragraph) => paragraph.parts.join(' ')).join('\n')
}

export interface TranscriptMirror {
  /** Keys already claimed (this session, or restored from the persisted ledger). */
  readonly seen: Set<string>
  /** Returns true when this observation filed a note. Never throws. */
  consider(api: TranscriptMirrorApi, meeting: LocalMeeting, workspaceId: string | null): Promise<boolean>
}

export interface TranscriptMirrorDeps {
  record?: (input: TranscriptRecordInput) => Promise<TranscriptRecordResult>
  /** Failure only: success is silent. Receives the meeting title for the toast. */
  notifyFailure?: (meetingTitle: string) => void
  seen?: Set<string>
  /** Called once per newly claimed key, before the write, so the claim survives a crash. */
  onSeen?: (key: string) => void
  /** Called on a failed attempt: releases the pre-write claim so the next tick retries. */
  onForget?: (key: string) => void
}

/** Bound on the renderer-side ledger; meetings are few, so this is never reached in practice. */
const MIRRORED_LIMIT = 500

function loadMirroredKeys(): string[] {
  const stored = get<unknown>(KEYS.meetingsTranscriptNotes, [])
  return Array.isArray(stored) ? stored.filter((key): key is string => typeof key === 'string') : []
}

function rememberMirroredKey(key: string): void {
  const keys = loadMirroredKeys()
  if (keys.includes(key)) return
  set(KEYS.meetingsTranscriptNotes, [...keys, key].slice(-MIRRORED_LIMIT))
}

function forgetMirroredKey(key: string): void {
  const keys = loadMirroredKeys()
  if (!keys.includes(key)) return
  set(KEYS.meetingsTranscriptNotes, keys.filter((stored) => stored !== key))
}

function notifyTranscriptNoteFailure(meetingTitle: string): void {
  toast.error(i18n.t('meetings.local.transcriptNoteFailed', { title: meetingTitle }))
}

export function createTranscriptMirror(deps: TranscriptMirrorDeps = {}): TranscriptMirror {
  const record = deps.record ?? recordTranscript
  const notifyFailure = deps.notifyFailure ?? notifyTranscriptNoteFailure
  const seen = deps.seen ?? new Set<string>()
  const onSeen = deps.onSeen
  const onForget = deps.onForget

  async function consider(api: TranscriptMirrorApi, meeting: LocalMeeting, workspaceId: string | null): Promise<boolean> {
    const key = transcriptMirrorKey(meeting)
    if (!key || !workspaceId || seen.has(key)) return false
    // A finished transcript with no segments (e.g. silent recording) has nothing to file.
    if (meeting.transcript.segments === 0) return false
    seen.add(key)
    onSeen?.(key)
    // A transient failure must not burn the key forever: release the claim so the
    // next observation of the same finished generation retries the write.
    const release = () => { seen.delete(key); onForget?.(key) }
    try {
      const transcript = await api.readTranscript(meeting.id)
      const segments = transcript?.segments ?? []
      if (!segments.length) return false
      const result = await record({
        workspaceId,
        source: 'meeting',
        text: transcriptMirrorText(segments),
        at: meeting.transcript.finishedAt,
        language: transcript?.language ?? meeting.transcript.language ?? null,
        model: transcript?.model ?? meeting.transcript.model ?? null,
        durationMs: meeting.durationMs,
        meetingId: meeting.id,
        meetingTitle: meeting.title,
        segments: segments.map((segment) => ({
          speaker: segment.speakerId?.trim() || '',
          text: segment.text,
          startMs: segment.startMs,
        })),
      })
      if (result.ok) return true
      release()
      notifyFailure(meeting.title)
      return false
    } catch (error) {
      // Fire-and-forget: a mirror failure is surfaced once and never blocks the UI.
      console.error('[meetings] transcript note mirror failed:', error)
      release()
      notifyFailure(meeting.title)
      return false
    }
  }

  return { seen, consider }
}

/**
 * Session-wide mirror with a persisted ledger: an app restart re-observes every
 * finished meeting, so previously filed generations are restored from localStorage
 * and never mirrored twice.
 */
export const meetingTranscriptMirror = createTranscriptMirror({
  seen: new Set(loadMirroredKeys()),
  onSeen: rememberMirroredKey,
  onForget: forgetMirroredKey,
})

/**
 * App-wide observation of local meetings. Mounted next to the automatic meeting
 * extraction runner so it is active whichever page is open.
 */
export function useMeetingTranscriptNotes(workspaceId: string | null): void {
  useEffect(() => {
    const api = meetingsApi()
    if (!api || !workspaceId) return
    let stopped = false
    const tick = async () => {
      if (stopped) return
      const meetings = await api.list(workspaceId)
      for (const meeting of meetings) {
        if (stopped) break
        if (meeting.workspaceId !== workspaceId) continue
        await meetingTranscriptMirror.consider(api, meeting, workspaceId)
      }
    }
    const runTick = () => { void tick().catch(() => { /* transient list/read failures retry on the next tick */ }) }
    runTick()
    const off = api.onChanged(runTick)
    const timer = setInterval(runTick, 5_000)
    return () => { stopped = true; clearInterval(timer); off() }
  }, [workspaceId])
}