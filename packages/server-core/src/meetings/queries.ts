/**
 * Meeting collection queries (issue #368 / I012).
 * ACL is applied before search. Denied is not an empty archive.
 * Manual notes are never replaced by an AI summary.
 */

export type MeetingQueryState = 'ready' | 'empty' | 'denied' | 'offline' | 'incomplete' | 'deleted'

export type MeetingLifecycleStatus =
  | 'planned'
  | 'permission_required'
  | 'capturing'
  | 'paused'
  | 'finalizing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'waiting_device'

export type MeetingQuerySegment = {
  id: string
  streamId: string
  revision: number
  sequence: number
  startMs: number
  endMs: number
  text: string
  final: boolean
  speakerId?: string | null
}

export type MeetingQueryRecord = {
  id: string
  workspaceId: string
  title: string
  updatedAt: number
  transcript?: string
  manualNotes?: string
  sources?: Array<{ id: string; private?: boolean; text: string }>
  deleted?: boolean
  incomplete?: boolean
  status?: MeetingLifecycleStatus
  segments?: MeetingQuerySegment[]
  capture?: 'device-ipc' | 'device-required' | 'web-unsupported'
}

export type MeetingQueryActor = {
  workspaceId: string
  allowed: boolean
  accountId?: string
}

export type MeetingQueryPage = {
  items: MeetingQueryRecord[]
  nextCursor?: string
  state: MeetingQueryState
}

export type MeetingQueryError = {
  code: 'stale-cursor' | 'denied'
  message: string
}

export function encodeMeetingCursor(item: Pick<MeetingQueryRecord, 'id' | 'updatedAt'>): string {
  return Buffer.from(`${item.updatedAt}:${item.id}`, 'utf8').toString('base64')
}

export function decodeMeetingCursor(cursor: string): { updatedAt: number; id: string } {
  const raw = Buffer.from(cursor, 'base64').toString('utf8')
  const sep = raw.indexOf(':')
  const updatedAt = Number(raw.slice(0, sep))
  const id = raw.slice(sep + 1)
  if (!id || !Number.isFinite(updatedAt)) {
    throw Object.assign(new Error('stale-cursor'), { code: 'stale-cursor' })
  }
  return { updatedAt, id }
}

export function applyMeetingSummary(meeting: MeetingQueryRecord, summary: string): MeetingQueryRecord {
  return { ...meeting, transcript: summary }
}

export function queryVisibleMeetings(
  meetings: readonly MeetingQueryRecord[],
  actor: MeetingQueryActor,
): MeetingQueryRecord[] {
  if (!actor.allowed) return []
  return meetings.filter((meeting) => (
    meeting.workspaceId === actor.workspaceId && !meeting.deleted
  ))
}

export function searchMatches(meeting: MeetingQueryRecord, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  if (meeting.title.toLowerCase().includes(q)) return true
  if (meeting.transcript?.toLowerCase().includes(q)) return true
  if (meeting.manualNotes?.toLowerCase().includes(q)) return true
  return (meeting.sources ?? []).some((source) => !source.private && source.text.toLowerCase().includes(q))
}

export function listMeetings(input: {
  meetings: readonly MeetingQueryRecord[]
  actor: MeetingQueryActor
  query?: string
  cursor?: string
  limit: number
  offline?: boolean
}): MeetingQueryPage {
  if (input.offline) {
    return { items: [], state: 'offline' }
  }
  if (!input.actor.allowed) {
    return { items: [], state: 'denied' }
  }
  const visible = queryVisibleMeetings(input.meetings, input.actor)
    .filter((meeting) => searchMatches(meeting, input.query ?? ''))
    .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
  if (visible.length === 0) {
    return { items: [], state: 'empty' }
  }
  let start = 0
  if (input.cursor) {
    const cursor = decodeMeetingCursor(input.cursor)
    const index = visible.findIndex((item) => item.id === cursor.id && item.updatedAt === cursor.updatedAt)
    if (index === -1) {
      throw Object.assign(new Error('stale-cursor'), { code: 'stale-cursor' })
    }
    start = index + 1
  }
  const items = visible.slice(start, start + input.limit)
  const last = items.at(-1)
  const exhausted = start + items.length >= visible.length
  return {
    items,
    nextCursor: exhausted || !last ? undefined : encodeMeetingCursor(last),
    state: items.some((item) => item.incomplete) ? 'incomplete' : 'ready',
  }
}

export function getMeeting(
  meetings: readonly MeetingQueryRecord[],
  id: string,
  actor: MeetingQueryActor,
): { state: MeetingQueryState; meeting?: MeetingQueryRecord } {
  if (!actor.allowed) return { state: 'denied' }
  const found = meetings.find((meeting) => meeting.id === id)
  if (!found || found.workspaceId !== actor.workspaceId) return { state: 'empty' }
  if (found.deleted) return { state: 'deleted', meeting: found }
  if (found.incomplete) return { state: 'incomplete', meeting: found }
  return { state: 'ready', meeting: found }
}

export function deleteMeeting(
  meetings: readonly MeetingQueryRecord[],
  id: string,
  actor: MeetingQueryActor,
): MeetingQueryRecord[] {
  if (!actor.allowed) {
    throw Object.assign(new Error('denied'), { code: 'denied' })
  }
  return meetings.map((meeting) => (
    meeting.id === id && meeting.workspaceId === actor.workspaceId
      ? { ...meeting, deleted: true }
      : meeting
  ))
}

export function createMeeting(
  meetings: readonly MeetingQueryRecord[],
  input: {
    id: string
    workspaceId: string
    title: string
    updatedAt: number
    commandId?: string
  },
  actor: MeetingQueryActor,
): MeetingQueryRecord[] {
  if (!actor.allowed || actor.workspaceId !== input.workspaceId) {
    throw Object.assign(new Error('denied'), { code: 'denied' })
  }
  if (meetings.some((meeting) => meeting.id === input.id && !meeting.deleted)) {
    return [...meetings]
  }
  return [
    ...meetings,
    {
      id: input.id,
      workspaceId: input.workspaceId,
      title: input.title,
      updatedAt: input.updatedAt,
      status: 'planned',
    },
  ]
}

export function setMeetingLifecycle(
  meetings: readonly MeetingQueryRecord[],
  id: string,
  status: MeetingLifecycleStatus,
  actor: MeetingQueryActor,
  now: number,
  capture?: MeetingQueryRecord['capture'],
): MeetingQueryRecord[] {
  if (!actor.allowed) {
    throw Object.assign(new Error('denied'), { code: 'denied' })
  }
  return meetings.map((meeting) => (
    meeting.id === id && meeting.workspaceId === actor.workspaceId
      ? { ...meeting, status, updatedAt: now, capture: capture ?? meeting.capture }
      : meeting
  ))
}

export function addManualNote(
  meetings: readonly MeetingQueryRecord[],
  id: string,
  note: string,
  actor: MeetingQueryActor,
  now: number,
): MeetingQueryRecord[] {
  if (!actor.allowed) {
    throw Object.assign(new Error('denied'), { code: 'denied' })
  }
  return meetings.map((meeting) => {
    if (meeting.id !== id || meeting.workspaceId !== actor.workspaceId) return meeting
    const previous = meeting.manualNotes?.trim() ? `${meeting.manualNotes}\n` : ''
    return { ...meeting, manualNotes: `${previous}${note}`, updatedAt: now }
  })
}

export function correctSegment(
  meetings: readonly MeetingQueryRecord[],
  id: string,
  patch: { streamId: string; segmentId: string; revision: number; text: string },
  actor: MeetingQueryActor,
  now: number,
): MeetingQueryRecord[] {
  if (!actor.allowed) {
    throw Object.assign(new Error('denied'), { code: 'denied' })
  }
  return meetings.map((meeting) => {
    if (meeting.id !== id || meeting.workspaceId !== actor.workspaceId) return meeting
    const segments = [...(meeting.segments ?? [])]
    const keyMatch = (segment: MeetingQuerySegment) => segment.streamId === patch.streamId && segment.id === patch.segmentId
    const index = segments.findIndex(keyMatch)
    if (index === -1) {
      segments.push({
        id: patch.segmentId,
        streamId: patch.streamId,
        revision: patch.revision,
        sequence: segments.length,
        startMs: 0,
        endMs: 0,
        text: patch.text,
        final: true,
      })
    } else {
      const current = segments[index]!
      if (patch.revision >= current.revision) {
        segments[index] = { ...current, revision: patch.revision, text: patch.text, final: true }
      }
    }
    return { ...meeting, segments, updatedAt: now }
  })
}

export function meetingSegments(meeting: MeetingQueryRecord | undefined): MeetingQuerySegment[] {
  return meeting?.segments ? meeting.segments.map((segment) => ({ ...segment })) : []
}
