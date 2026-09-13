import { createHash } from 'node:crypto'
import type { Meeting } from '@craft-agent/core/meetings'
import { authorizeMeetingAction, type MeetingGrant } from '@craft-agent/shared/meeting-agents'
import { MeetingJournal } from './journal.ts'

export const NATIVE_IMPORT_PROVIDER = 'native-journal'
export const NATIVE_IMPORT_REMOTE_TYPE = 'import-intent'
export const IMPORT_INTENT_MAX_BYTES = 512 * 1024 * 1024

export type ImportedMedia = {
  workspaceId: string
  hash: string
  bytes: number
  durationMs: number
  meetingId: string
}

export type ImportIntentSpec = {
  contentHash: string
  byteLength: number
  mimeType?: string
}

export type ImportNativeResult =
  | { ok: true; meeting: Meeting }
  | { ok: false; code: string }

export function importMeetingMedia(input: {
  workspaceId: string
  bytes: Uint8Array
  existing: readonly ImportedMedia[]
  maxBytes?: number
  mimeType?: string
}): { status: 'ok' | 'duplicate' | 'rejected'; item?: ImportedMedia; reason?: string } {
  if (input.bytes.byteLength === 0) return { status: 'rejected', reason: 'empty' }
  if (input.maxBytes != null && input.bytes.byteLength > input.maxBytes) {
    return { status: 'rejected', reason: 'too-large' }
  }
  if (input.mimeType && !input.mimeType.startsWith('audio/')) {
    return { status: 'rejected', reason: 'bad-format' }
  }
  const hash = createHash('sha256').update(input.bytes).digest('hex')
  const found = input.existing.find((item) => item.workspaceId === input.workspaceId && item.hash === hash)
  if (found) return { status: 'duplicate', item: found }
  return {
    status: 'ok',
    item: {
      workspaceId: input.workspaceId,
      hash,
      bytes: input.bytes.byteLength,
      durationMs: Math.max(1, Math.round(input.bytes.byteLength / 32)),
      meetingId: `import-${hash.slice(0, 8)}`,
    },
  }
}

export function nativeImportBinding(contentHash: string, actorId: string): NonNullable<Meeting['sourceBinding']> {
  return {
    provider: NATIVE_IMPORT_PROVIDER,
    accountId: actorId,
    remoteType: NATIVE_IMPORT_REMOTE_TYPE,
    remoteId: contentHash,
  }
}

function specError(spec: ImportIntentSpec): string | null {
  if (!Number.isFinite(spec.byteLength) || spec.byteLength <= 0) return 'import-empty'
  if (spec.byteLength > IMPORT_INTENT_MAX_BYTES) return 'import-too-large'
  if (!/^[a-f0-9]{64}$/.test(spec.contentHash)) return 'import-bad-hash'
  if (spec.mimeType && !spec.mimeType.startsWith('audio/')) return 'import-bad-format'
  return null
}

function isNativeImport(meeting: Meeting): boolean {
  const binding = meeting.sourceBinding
  if (!binding) return true
  return binding.provider === NATIVE_IMPORT_PROVIDER && binding.remoteType === NATIVE_IMPORT_REMOTE_TYPE
}

export function applyNativeImportIntent(input: {
  persistRootDir: string
  workspaceId: string
  actorId: string
  grant: MeetingGrant | null
  meetingId: string
  spec: ImportIntentSpec
}): ImportNativeResult {
  if (!input.grant) return { ok: false, code: 'grant-required' }
  if (!input.persistRootDir) return { ok: false, code: 'config-dir-required' }
  if (!input.workspaceId) return { ok: false, code: 'workspace-required' }
  if (!input.meetingId) return { ok: false, code: 'meeting-required' }
  const spec: ImportIntentSpec = {
    contentHash: input.spec.contentHash.toLowerCase(),
    byteLength: input.spec.byteLength,
    mimeType: input.spec.mimeType,
  }
  const invalid = specError(spec)
  if (invalid) return { ok: false, code: invalid }
  const auth = authorizeMeetingAction(input.grant, {
    actorId: input.actorId,
    workspaceId: input.workspaceId,
    deviceId: input.grant.deviceId,
    capability: 'archive',
    operation: 'import',
    targetId: input.meetingId,
  })
  if (!auth.ok) {
    return { ok: false, code: auth.code === 'capability-denied' ? 'archive-denied' : auth.code }
  }
  const journal = new MeetingJournal(input.persistRootDir)
  const contentHash = spec.contentHash
  try {
    let snapshot
    try {
      snapshot = journal.read(input.meetingId)
    } catch {
      return { ok: false, code: 'meeting-not-found' }
    }
    const meeting = snapshot.meeting
    if (meeting.workspaceId !== input.workspaceId) return { ok: false, code: 'workspace-mismatch' }
    if (!isNativeImport(meeting)) return { ok: false, code: 'foreign-binding' }
    if (
      meeting.status === 'finalizing'
      && meeting.sourceBinding?.remoteId === contentHash
      && meeting.sourceBinding.remoteType === NATIVE_IMPORT_REMOTE_TYPE
    ) {
      return { ok: true, meeting }
    }
    const sourceBinding = nativeImportBinding(contentHash, input.actorId)
    journal.commit({
      workspaceId: input.workspaceId,
      meetingId: input.meetingId,
      expectedRevision: meeting.revision,
      commandId: `import-${input.meetingId}-${contentHash}`,
      events: [
        { type: 'meeting.binding', sourceBinding },
        { type: 'meeting.status', status: 'finalizing' },
      ],
      outboxEntries: [],
    })
    return { ok: true, meeting: journal.read(input.meetingId).meeting }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'import-failed'
    if (message.includes('already has a writer')) return { ok: false, code: 'journal-locked' }
    return { ok: false, code: 'import-failed' }
  } finally {
    journal.releaseWriter()
  }
}

