/**
 * RMA-I032 / #388 — sharing / export / retention.
 * Private notes never leak into recap/search. Native export is fail-closed (U1);
 * N5 native share/export evidence is not_run. No live share against production.
 */

import { unsupported, type MeetingOpResult } from './types.ts'

export type MeetingShareRecord = {
  readonly recap: string
  readonly privateNotes: readonly string[]
  readonly members: readonly string[]
  readonly links: readonly string[]
  readonly exports: Array<{ kind: 'json' | 'markdown'; body: string }>
  readonly tombstones: string[]
  readonly externalRetained: readonly string[]
}

export type SharingNativeEvidence = {
  readonly evidenceLevel: 'U1'
  readonly native: 'not_run'
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

export function nativeExportAvailable(): false {
  return false
}

export function sharingNativeEvidence(): SharingNativeEvidence {
  return { evidenceLevel: 'U1', native: 'not_run' }
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

export function exportMeeting(
  _record: MeetingShareRecord,
  _kind: 'json' | 'markdown',
): MeetingOpResult<'native-export-unavailable'> {
  return unsupported('native-export-unavailable')
}

export function revokeMember(record: MeetingShareRecord, actorId: string): MeetingShareRecord {
  return { ...record, members: record.members.filter((id) => id !== actorId), links: [] }
}
