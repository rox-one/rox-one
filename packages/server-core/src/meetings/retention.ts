/**
 * RMA-I032 / #388 — native delete / retention honesty.
 * Owned copies are not claimed deleted: native delete is unavailable (U1).
 * External copies stay labeled external-retained. N5 is not_run.
 * No live delete against production.
 */

import type { MeetingShareRecord } from './sharing.ts'
import type { MeetingOpResult } from './types.ts'

export type RetentionNativeEvidence = {
  readonly evidenceLevel: 'U1'
  readonly native: 'not_run'
}

export type NativeDeletePayload = {
  readonly ownedCopiesDeleted: false
  readonly externalRetained: readonly string[]
}

export function nativeDeleteAvailable(): false {
  return false
}

export function retentionNativeEvidence(): RetentionNativeEvidence {
  return { evidenceLevel: 'U1', native: 'not_run' }
}

export function deleteOwnedCopies(
  record: MeetingShareRecord,
): MeetingOpResult<'native-delete-unavailable', NativeDeletePayload> {
  return {
    status: 'unsupported',
    reason: 'native-delete-unavailable',
    live: false,
    evidenceLevel: 'U1',
    payload: {
      ownedCopiesDeleted: false,
      externalRetained: record.externalRetained,
    },
  }
}
