/**
 * Meeting deletion, tombstones, and retention cascade (I032).
 * Delete invalidates audio, transcript, embeddings, cache, derived summaries
 * and shared exports where ROX has authority. Already-sent external copies
 * are marked external-retained. Notes/Tasks remain in their repositories.
 */

import { deleteMeeting, type MeetingQueryActor, type MeetingQueryRecord } from './queries.ts'
import type { MeetingShareRecord } from './sharing.ts'

export type MeetingRetentionCascade = {
  audioPurged: boolean
  transcriptPurged: boolean
  embeddingsInvalidated: boolean
  cacheInvalidated: boolean
  derivedSummariesInvalidated: boolean
  sharedExportsInvalidated: boolean
  indexesInvalidated: string[]
  tombstone: { meetingId: string; workspaceId: string; deleted: true }
  externalCopies: Array<{ id: string; provider: string; status: 'external-retained' }>
  nativeNotesPreserved: true
  nativeTasksPreserved: true
}

export type MeetingDeleteResult = {
  record: MeetingShareRecord
  query: MeetingQueryRecord[]
  cascade: MeetingRetentionCascade
}

function tombstoneText(record: MeetingShareRecord): MeetingShareRecord {
  return {
    ...record,
    transcript: undefined,
    audioSha256: undefined,
    embeddings: [],
    derivedSummary: undefined,
    cache: {},
    sharedExports: [],
    notes: record.notes.map((note) => ({ ...note, text: '' })),
    corrections: [],
    deleted: true,
    revision: record.revision + 1,
    externalCopies: record.externalCopies.map((copy) => ({
      ...copy,
      status: 'external-retained' as const,
    })),
  }
}

export function deleteMeetingWithRetention(input: {
  record: MeetingShareRecord
  meetings: readonly MeetingQueryRecord[]
  actor: MeetingQueryActor
  now?: number
  indexKeys?: readonly string[]
}): MeetingDeleteResult {
  const now = input.now ?? 0
  const query = deleteMeeting(input.meetings, input.record.meetingId, input.actor)
  const record = tombstoneText({
    ...input.record,
    deleted: true,
    deletedAt: now,
  })
  const cascade: MeetingRetentionCascade = {
    audioPurged: true,
    transcriptPurged: true,
    embeddingsInvalidated: true,
    cacheInvalidated: true,
    derivedSummariesInvalidated: true,
    sharedExportsInvalidated: true,
    indexesInvalidated: [...(input.indexKeys ?? [`meetings:${record.meetingId}`])],
    tombstone: {
      meetingId: record.meetingId,
      workspaceId: record.workspaceId,
      deleted: true,
    },
    externalCopies: record.externalCopies,
    nativeNotesPreserved: true,
    nativeTasksPreserved: true,
  }
  return { record, query, cascade }
}
