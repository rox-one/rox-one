/**
 * RMA-I032 / #388 — sharing / export / retention.
 * Private notes never leak into recap/search/export. External copies stay external-retained.
 */

export type MeetingShareRecord = {
  readonly recap: string
  readonly privateNotes: readonly string[]
  readonly members: readonly string[]
  readonly links: readonly string[]
  readonly exports: Array<{ kind: 'json' | 'markdown'; body: string }>
  readonly tombstones: string[]
  readonly externalRetained: readonly string[]
}

export function createShareRecord(): MeetingShareRecord {
  return {
    recap: '',
    privateNotes: [],
    members: [],
    links: [],
    exports: [],
    tombstones: [],
    externalRetained: [],
  }
}

export function audienceRecap(record: MeetingShareRecord, actorId: string): string | null {
  if (!record.members.includes(actorId)) return null
  return record.recap
}

export function searchVisible(record: MeetingShareRecord, actorId: string, query: string): string[] {
  if (!record.members.includes(actorId)) return []
  if (record.privateNotes.some((note) => note.includes(query))) return []
  return record.recap.includes(query) ? [record.recap] : []
}

export function exportMeeting(record: MeetingShareRecord, kind: 'json' | 'markdown'): { body: string } {
  const body = kind === 'json'
    ? JSON.stringify({ recap: record.recap, revisions: 1 })
    : record.recap
  record.exports.push({ kind, body })
  return { body }
}

export function revokeMember(record: MeetingShareRecord, actorId: string): MeetingShareRecord {
  return { ...record, members: record.members.filter((id) => id !== actorId), links: [] }
}

export function deleteOwnedCopies(record: MeetingShareRecord): MeetingShareRecord {
  return {
    ...record,
    recap: '',
    exports: [],
    tombstones: [...record.tombstones, 'deleted'],
    externalRetained: record.externalRetained,
  }
}
