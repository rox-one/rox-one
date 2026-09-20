import type { Meeting } from '@craft-agent/core/meetings'

export type MeetingQueryItem = Meeting & { private?: boolean }

export function queryMeetings(input: {
  items: readonly MeetingQueryItem[]
  workspaceId: string
  readableWorkspaceId: string
  cursor?: string
  limit: number
  query?: string
}): { page: MeetingQueryItem[]; continueCursor: string | null; denied: boolean } {
  if (input.workspaceId !== input.readableWorkspaceId) {
    return { page: [], continueCursor: null, denied: true }
  }
  let rows = input.items.filter((item) => item.workspaceId === input.workspaceId && !item.private)
  if (input.query) {
    const q = input.query.toLowerCase()
    rows = rows.filter((item) => item.title.toLowerCase().includes(q))
  }
  const start = input.cursor ? Number.parseInt(input.cursor, 10) : 0
  if (input.cursor && Number.isNaN(start)) {
    return { page: [], continueCursor: null, denied: false }
  }
  const page = rows.slice(start, start + input.limit)
  const next = start + input.limit
  return {
    page,
    continueCursor: next < rows.length ? String(next) : null,
    denied: false,
  }
}

/**
 * Meeting collection queries (issue #368 / I012).
 * ACL is applied before search. Denied is not an empty archive.
 * Manual notes are never replaced by an AI summary.
 */

export type MeetingQueryState = 'ready' | 'empty' | 'denied' | 'offline' | 'incomplete' | 'deleted'

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
}

export type MeetingQueryActor = {
  workspaceId: string
  allowed: boolean
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
