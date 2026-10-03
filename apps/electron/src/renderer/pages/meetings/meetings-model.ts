/**
 * Pure view model for the Встречи mode screen: navigator buckets, day groups
 * and status badges over the native meetings catalog (meetings:list). No I/O.
 *
 * The catalog carries no calendar data yet (meetings:agenda is v1), so
 * «Предстоящие» are planned meetings and day groups use createdAt.
 */
import type { Meeting, MeetingStatus } from '@rox/core/meetings'
import type { MeetingListItem } from './start-rpc'
import type { MeetingProposalRow } from './proposal-rpc'

/** Proposal row tagged with the meeting it was raised for (rows carry no meetingId). */
export type ProposalWithMeeting = MeetingProposalRow & { meetingId?: string | null }

export type MeetingView = MeetingListItem & {
  createdAt?: number
  updatedAt?: number
  provider?: string
  remoteType?: string
}

export type MeetingsBucket = 'today' | 'upcoming' | 'past' | 'live' | 'needsAction' | 'all'

export const LIVE_STATUSES: readonly string[] = ['capturing', 'paused', 'permission_required'] satisfies MeetingStatus[]
export const PAST_STATUSES: readonly string[] = ['completed', 'failed', 'cancelled', 'finalizing'] satisfies MeetingStatus[]

export function toMeetingView(meeting: Meeting): MeetingView {
  return {
    id: meeting.meetingId,
    title: meeting.title,
    status: meeting.status,
    createdAt: meeting.createdAt,
    updatedAt: meeting.updatedAt,
    provider: meeting.sourceBinding?.provider,
    remoteType: meeting.sourceBinding?.remoteType,
  }
}

/** Merge a thin row (start/search/capture results) over known metadata. */
export function mergeMeetingRow(row: MeetingListItem, known: MeetingView | undefined, now = Date.now()): MeetingView {
  return {
    ...known,
    ...row,
    createdAt: known?.createdAt ?? now,
    updatedAt: now,
  }
}

export function upsertMeeting(list: readonly MeetingView[], row: MeetingListItem, now = Date.now()): MeetingView[] {
  const known = list.find((item) => item.id === row.id)
  const merged = mergeMeetingRow(row, known, now)
  return known ? list.map((item) => (item.id === row.id ? merged : item)) : [merged, ...list]
}

export function startOfDay(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function isLive(view: Pick<MeetingView, 'status'>): boolean {
  return LIVE_STATUSES.includes(view.status)
}

export function pendingProposalCount(proposals: readonly ProposalWithMeeting[], meetingId?: string): number {
  return proposals.filter((row) => row.status === 'proposed' && (meetingId === undefined || row.meetingId === meetingId)).length
}

export function needsAction(view: MeetingView, proposals: readonly ProposalWithMeeting[]): boolean {
  return view.status === 'failed' || view.status === 'permission_required' || pendingProposalCount(proposals, view.id) > 0
}

export function inBucket(view: MeetingView, bucket: MeetingsBucket, proposals: readonly ProposalWithMeeting[], now = Date.now()): boolean {
  switch (bucket) {
    case 'all': return true
    case 'live': return isLive(view)
    case 'upcoming': return view.status === 'planned'
    case 'past': return PAST_STATUSES.includes(view.status)
    case 'needsAction': return needsAction(view, proposals)
    case 'today': {
      if (isLive(view)) return true
      const ts = view.updatedAt ?? view.createdAt
      return ts !== undefined && startOfDay(ts) === startOfDay(now)
    }
  }
}

export function bucketCounts(views: readonly MeetingView[], proposals: readonly ProposalWithMeeting[], now = Date.now()): Record<MeetingsBucket, number> {
  const buckets: MeetingsBucket[] = ['today', 'upcoming', 'past', 'live', 'needsAction', 'all']
  return Object.fromEntries(buckets.map((b) => [b, views.filter((v) => inBucket(v, b, proposals, now)).length])) as Record<MeetingsBucket, number>
}

export type MeetingGroup = { key: string; label: { kind: 'now' | 'planned' | 'today' | 'yesterday' | 'date' | 'undated'; date?: number }; items: MeetingView[] }

/** «Сейчас» (live) → «Запланированы» → by day, newest first. */
export function groupMeetings(views: readonly MeetingView[], now = Date.now()): MeetingGroup[] {
  const groups: MeetingGroup[] = []
  const live = views.filter(isLive)
  const planned = views.filter((v) => v.status === 'planned')
  if (live.length) groups.push({ key: 'now', label: { kind: 'now' }, items: live })
  if (planned.length) groups.push({ key: 'planned', label: { kind: 'planned' }, items: planned })
  const rest = views
    .filter((v) => !isLive(v) && v.status !== 'planned')
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
  const today = startOfDay(now)
  const yesterday = startOfDay(today - 1)
  const byDay = new Map<string, MeetingGroup>()
  for (const view of rest) {
    if (view.createdAt === undefined) {
      const g = byDay.get('undated') ?? { key: 'undated', label: { kind: 'undated' as const }, items: [] }
      g.items.push(view)
      byDay.set('undated', g)
      continue
    }
    const day = startOfDay(view.createdAt)
    const key = `d${day}`
    const kind = day === today ? 'today' : day === yesterday ? 'yesterday' : 'date'
    const g = byDay.get(key) ?? { key, label: { kind, date: day }, items: [] }
    g.items.push(view)
    byDay.set(key, g)
  }
  return [...groups, ...byDay.values()]
}

export type StatusBadge = { key: string; tone: 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'muted'; count?: number }

export function statusBadge(view: MeetingView, proposals: readonly ProposalWithMeeting[]): StatusBadge {
  const pending = pendingProposalCount(proposals, view.id)
  if (view.status === 'capturing') return { key: 'meetings.badge.rec', tone: 'danger' }
  if (view.status === 'paused') return { key: 'meetings.badge.paused', tone: 'warning' }
  if (view.status === 'permission_required') return { key: 'meetings.badge.permission', tone: 'warning' }
  if (pending > 0) return { key: 'meetings.badge.waiting', tone: 'warning', count: pending }
  if (view.status === 'planned') return { key: 'meetings.badge.planned', tone: 'muted' }
  if (view.status === 'finalizing') return { key: 'meetings.badge.finalizing', tone: 'info' }
  if (view.status === 'completed') return { key: 'meetings.badge.done', tone: 'success' }
  if (view.status === 'failed') return { key: 'meetings.badge.failed', tone: 'danger' }
  return { key: 'meetings.badge.cancelled', tone: 'muted' }
}

/** Source label key for a meeting row (no calendar providers yet). */
export function sourceKey(view: MeetingView): string {
  if (view.remoteType === 'import-intent') return 'meetings.sourceImport'
  if (view.remoteType === 'capture-intent') return 'meetings.sourceCapture'
  return 'meetings.sourceLocal'
}

export function durationMs(view: MeetingView): number | null {
  if (view.createdAt === undefined || view.updatedAt === undefined) return null
  if (!PAST_STATUSES.includes(view.status)) return null
  const ms = view.updatedAt - view.createdAt
  return ms > 0 ? ms : null
}
