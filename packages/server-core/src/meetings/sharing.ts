/**
 * Meeting team memory, audience intersection, and share links (I032).
 * Notes/Tasks stay in their own repositories; this store keeps links and spans.
 * Private notes never enter a shared recap, export, or workspace search.
 */

export type MeetingShareActor = {
  accountId: string
  workspaceId: string
}

export type MeetingShareMember = {
  accountId: string
  role: 'owner' | 'member'
  revokedAt?: number
}

export type MeetingLinkedNote = {
  id: string
  ownerId: string
  audience: 'private' | 'shared'
  text: string
  revision: number
}

export type MeetingShareLink = {
  id: string
  audienceIds: readonly string[]
  revokedAt?: number
}

export type MeetingCorrection = {
  id: string
  segmentId: string
  text: string
  revision: number
  authorId: string
}

export type MeetingExternalCopy = {
  id: string
  provider: string
  status: 'sent' | 'external-retained'
}

export type MeetingShareRecord = {
  meetingId: string
  workspaceId: string
  title: string
  revision: number
  transcript?: string
  audioSha256?: string
  embeddings: string[]
  derivedSummary?: string
  cache: Record<string, string>
  sharedExports: string[]
  members: MeetingShareMember[]
  notes: MeetingLinkedNote[]
  links: MeetingShareLink[]
  corrections: MeetingCorrection[]
  externalCopies: MeetingExternalCopy[]
  deleted?: boolean
  deletedAt?: number
}

export type MeetingShareDenied = {
  ok: false
  code: 'denied' | 'revoked' | 'conflict' | 'forged-workspace' | 'not-found'
  message: string
}

export function emptyMeetingShare(input: {
  meetingId: string
  workspaceId: string
  title: string
  ownerId: string
}): MeetingShareRecord {
  return {
    meetingId: input.meetingId,
    workspaceId: input.workspaceId,
    title: input.title,
    revision: 1,
    embeddings: [],
    cache: {},
    sharedExports: [],
    members: [{ accountId: input.ownerId, role: 'owner' }],
    notes: [],
    links: [],
    corrections: [],
    externalCopies: [],
  }
}

export function isActiveMember(record: MeetingShareRecord, accountId: string, now = 0): boolean {
  const member = record.members.find((item) => item.accountId === accountId)
  if (!member) return false
  if (member.revokedAt !== undefined && member.revokedAt <= now) return false
  return true
}

export function authorizeShareActor(
  record: MeetingShareRecord,
  actor: MeetingShareActor,
  now = 0,
): MeetingShareDenied | { ok: true; member: MeetingShareMember } {
  if (actor.workspaceId !== record.workspaceId) {
    return { ok: false, code: 'forged-workspace', message: 'Actor workspace does not match the meeting' }
  }
  const member = record.members.find((item) => item.accountId === actor.accountId)
  if (!member) return { ok: false, code: 'denied', message: 'Actor is not a meeting member' }
  if (member.revokedAt !== undefined && member.revokedAt <= now) {
    return { ok: false, code: 'revoked', message: 'Membership was revoked' }
  }
  return { ok: true, member }
}

export function audienceIntersection(
  record: MeetingShareRecord,
  actor: MeetingShareActor,
  now = 0,
): MeetingLinkedNote[] {
  const auth = authorizeShareActor(record, actor, now)
  if (!auth.ok) return []
  return record.notes.filter((note) => {
    if (note.audience === 'private') return note.ownerId === actor.accountId
    return true
  })
}

export function buildSharedRecap(
  record: MeetingShareRecord,
  actor: MeetingShareActor,
  now = 0,
): { text: string; notes: MeetingLinkedNote[]; excludedPrivate: boolean } {
  const visible = audienceIntersection(record, actor, now)
  const shared = visible.filter((note) => note.audience === 'shared')
  const excludedPrivate = record.notes.some((note) => note.audience === 'private')
  const text = shared.map((note) => note.text).join('\n')
  return { text, notes: shared, excludedPrivate }
}

export function searchShareVisible(
  record: MeetingShareRecord,
  actor: MeetingShareActor,
  query: string,
  now = 0,
): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return authorizeShareActor(record, actor, now).ok === true
  if (record.title.toLowerCase().includes(q) && authorizeShareActor(record, actor, now).ok) return true
  return audienceIntersection(record, actor, now).some((note) => (
    note.audience !== 'private' && note.text.toLowerCase().includes(q)
  ))
}

export function revokeMember(
  record: MeetingShareRecord,
  actor: MeetingShareActor,
  accountId: string,
  now: number,
): MeetingShareRecord | MeetingShareDenied {
  const auth = authorizeShareActor(record, actor, now)
  if (!auth.ok) return auth
  if (auth.member.role !== 'owner') {
    return { ok: false, code: 'denied', message: 'Only the owner can revoke membership' }
  }
  return {
    ...record,
    revision: record.revision + 1,
    members: record.members.map((item) => (
      item.accountId === accountId ? { ...item, revokedAt: now } : item
    )),
    links: record.links.map((link) => (
      link.audienceIds.includes(accountId) ? { ...link, revokedAt: now } : link
    )),
  }
}

export function createShareLink(
  record: MeetingShareRecord,
  actor: MeetingShareActor,
  audienceIds: readonly string[],
  now = 0,
): { record: MeetingShareRecord; link: MeetingShareLink } | MeetingShareDenied {
  const auth = authorizeShareActor(record, actor, now)
  if (!auth.ok) return auth
  const link: MeetingShareLink = {
    id: `link-${record.meetingId}-${record.links.length + 1}`,
    audienceIds: [...audienceIds],
  }
  return {
    record: {
      ...record,
      revision: record.revision + 1,
      links: [...record.links, link],
    },
    link,
  }
}

export function revokeShareLink(
  record: MeetingShareRecord,
  actor: MeetingShareActor,
  linkId: string,
  now: number,
): MeetingShareRecord | MeetingShareDenied {
  const auth = authorizeShareActor(record, actor, now)
  if (!auth.ok) return auth
  const found = record.links.find((item) => item.id === linkId)
  if (!found) return { ok: false, code: 'not-found', message: 'Share link was not found' }
  return {
    ...record,
    revision: record.revision + 1,
    links: record.links.map((item) => (
      item.id === linkId ? { ...item, revokedAt: now } : item
    )),
  }
}

export function shareLinkAllows(link: MeetingShareLink, accountId: string, now = 0): boolean {
  if (link.revokedAt !== undefined && link.revokedAt <= now) return false
  return link.audienceIds.includes(accountId)
}

export function applyCollaborativeCorrection(
  record: MeetingShareRecord,
  actor: MeetingShareActor,
  input: { id: string; segmentId: string; text: string; expectedRevision: number },
  now = 0,
): MeetingShareRecord | MeetingShareDenied {
  const auth = authorizeShareActor(record, actor, now)
  if (!auth.ok) return auth
  const current = record.corrections.find((item) => item.id === input.id)
  if (current && current.revision !== input.expectedRevision) {
    return { ok: false, code: 'conflict', message: 'Correction revision does not match' }
  }
  if (!current && record.revision !== input.expectedRevision) {
    return { ok: false, code: 'conflict', message: 'Meeting revision does not match' }
  }
  const nextCorrection: MeetingCorrection = {
    id: input.id,
    segmentId: input.segmentId,
    text: input.text,
    revision: (current?.revision ?? record.revision) + 1,
    authorId: actor.accountId,
  }
  return {
    ...record,
    revision: record.revision + 1,
    corrections: [
      ...record.corrections.filter((item) => item.id !== input.id),
      nextCorrection,
    ],
  }
}

export function addLinkedNote(
  record: MeetingShareRecord,
  note: MeetingLinkedNote,
): MeetingShareRecord {
  return {
    ...record,
    revision: record.revision + 1,
    notes: [...record.notes.filter((item) => item.id !== note.id), note],
  }
}
