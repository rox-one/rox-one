/**
 * Meeting JSON/Markdown/media export and import (I032).
 * Audience intersection is applied before serialization. Round-trip stores
 * note/task links, not a second canonical copy of Notes or Tasks.
 */

import {
  authorizeShareActor,
  audienceIntersection,
  emptyMeetingShare,
  type MeetingLinkedNote,
  type MeetingShareActor,
  type MeetingShareRecord,
} from './sharing.ts'
import { containsSensitiveIdentifier, redactSensitiveIdentifiers } from './sensitive.ts'

export const MEETING_EXPORT_SCHEMA_VERSION = 1 as const

export type MeetingExportFormat = 'json' | 'markdown' | 'media'

export type MeetingClipRange = {
  startMs: number
  endMs: number
  text: string
}

export type MeetingExportLink = {
  kind: 'note' | 'task'
  id: string
}

export type MeetingExportBundle = {
  schemaVersion: typeof MEETING_EXPORT_SCHEMA_VERSION
  format: MeetingExportFormat
  meetingId: string
  workspaceId: string
  title: string
  transcript?: string
  notes: Array<Pick<MeetingLinkedNote, 'id' | 'audience' | 'text' | 'ownerId'>>
  clips: MeetingClipRange[]
  media: Array<{ id: string; sha256: string; kind: 'audio' | 'clip' }>
  links: MeetingExportLink[]
  audience: 'owner' | 'shared'
}

export type MeetingExportResult =
  | { ok: true; bundle: MeetingExportBundle }
  | { ok: false; code: 'denied' | 'revoked' | 'forged-workspace' | 'deleted'; message: string }

export type MeetingImportResult =
  | { ok: true; record: MeetingShareRecord }
  | { ok: false; code: 'denied' | 'invalid-bundle' | 'forged-workspace'; message: string }

function clipTranscript(transcript: string | undefined, clip?: MeetingClipRange): string | undefined {
  if (!transcript) return undefined
  if (!clip) return transcript
  return clip.text || transcript
}

export function exportMeeting(
  record: MeetingShareRecord,
  actor: MeetingShareActor,
  opts: {
    format: MeetingExportFormat
    audience?: 'owner' | 'shared'
    clip?: MeetingClipRange
    now?: number
  },
): MeetingExportResult {
  if (record.deleted) {
    return { ok: false, code: 'deleted', message: 'Deleted meetings cannot be exported' }
  }
  const auth = authorizeShareActor(record, actor, opts.now)
  if (!auth.ok) {
    return { ok: false, code: auth.code === 'not-found' || auth.code === 'conflict' ? 'denied' : auth.code, message: auth.message }
  }
  const audience = opts.audience ?? (auth.member.role === 'owner' ? 'owner' : 'shared')
  const visible = audienceIntersection(record, actor, opts.now)
  const notes = (audience === 'shared'
    ? visible.filter((note) => note.audience === 'shared')
    : visible
  ).filter((note) => audience !== 'shared' || !containsSensitiveIdentifier(note.text))
  const transcript = audience === 'shared'
    ? redactSensitiveIdentifiers(clipTranscript(record.transcript, opts.clip) ?? '')
    : clipTranscript(record.transcript, opts.clip)
  const bundle: MeetingExportBundle = {
    schemaVersion: MEETING_EXPORT_SCHEMA_VERSION,
    format: opts.format,
    meetingId: record.meetingId,
    workspaceId: record.workspaceId,
    title: record.title,
    transcript: transcript || undefined,
    notes: notes.map((note) => ({
      id: note.id,
      audience: note.audience,
      text: audience === 'shared' ? redactSensitiveIdentifiers(note.text) : note.text,
      ownerId: note.ownerId,
    })),
    clips: opts.clip ? [opts.clip] : [],
    media: record.audioSha256
      ? [{ id: `audio-${record.meetingId}`, sha256: record.audioSha256, kind: 'audio' }]
      : [],
    links: record.notes.map((note) => ({ kind: 'note' as const, id: note.id })),
    audience,
  }
  return { ok: true, bundle }
}

export function renderMeetingMarkdown(bundle: MeetingExportBundle): string {
  const noteLines = bundle.notes.map((note) => `- (${note.audience}) ${note.text}`).join('\n')
  const clipLines = bundle.clips.map((clip) => `- ${clip.startMs}-${clip.endMs}: ${clip.text}`).join('\n')
  return [
    `# ${bundle.title}`,
    '',
    bundle.transcript ?? '',
    noteLines ? `## Notes\n${noteLines}` : '',
    clipLines ? `## Clips\n${clipLines}` : '',
  ].filter(Boolean).join('\n')
}

export function importMeeting(
  bundle: MeetingExportBundle,
  actor: MeetingShareActor,
): MeetingImportResult {
  if (bundle.schemaVersion !== MEETING_EXPORT_SCHEMA_VERSION) {
    return { ok: false, code: 'invalid-bundle', message: 'Unsupported export schemaVersion' }
  }
  if (bundle.workspaceId !== actor.workspaceId) {
    return { ok: false, code: 'forged-workspace', message: 'Import workspace does not match actor' }
  }
  return {
    ok: true,
    record: {
      ...emptyMeetingShare({
        meetingId: bundle.meetingId,
        workspaceId: bundle.workspaceId,
        title: bundle.title,
        ownerId: actor.accountId,
      }),
      transcript: bundle.transcript,
      audioSha256: bundle.media.find((item) => item.kind === 'audio')?.sha256,
      notes: bundle.notes.map((note) => ({
        id: note.id,
        ownerId: note.ownerId,
        audience: note.audience,
        text: note.text,
        revision: 1,
      })),
    },
  }
}
