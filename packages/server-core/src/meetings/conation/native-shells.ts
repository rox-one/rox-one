/**
 * Native Mail/CRM/Calendar/Rooms shells (#380/#381/#382/#389).
 * Drafts and ledgers persist locally. Live Conation stays BLOCKED without
 * credentials and until AUD #333. No fake dialer, no iframe inbox.
 */

import { joinRoom, ROOM_PROVIDER_DECISION } from '../rooms.ts'
import { blocked, denied, unknownEffect, type MeetingOpResult } from '../types.ts'
import { occurrenceKey, type CalendarOccurrence } from './calendar-calls.ts'
import { proposeCrmEdit, resolveCrmTarget, type CrmTarget } from './crm.ts'
import { sendMail, type MailDraft } from './mail-channels.ts'

export type ConationCredentials = {
  readonly present: boolean
  readonly accountId?: string
}

export type DeliveryState = 'draft' | 'queued' | 'blocked' | 'unknown' | 'verified'

export type MailLedgerEntry = {
  id: string
  threadId: string
  to: string[]
  attachments: string[]
  approvedTo: string[]
  approvedAttachments: string[]
  includesPrivateNote: boolean
  status: DeliveryState
  sendAttempted: boolean
  lastResult: MeetingOpResult
}

export type ReminderLedgerEntry = {
  id: string
  occurrenceKey: string
  toastOnly: false
  status: DeliveryState
  lastResult: MeetingOpResult
}

export type MailThreadRow = {
  entityId: string
  subject: string
  live: false
}

const missingCredentials = (reason: 'missing-credentials'): MeetingOpResult => blocked(reason)

export function prepareMailDraft(
  ledger: Map<string, MailLedgerEntry>,
  input: {
    readonly id: string
    readonly threadId: string
    readonly to: readonly string[]
    readonly attachments?: readonly string[]
  },
): MailLedgerEntry {
  const entry: MailLedgerEntry = {
    id: input.id,
    threadId: input.threadId,
    to: [...input.to],
    attachments: [...(input.attachments ?? [])],
    approvedTo: [],
    approvedAttachments: [],
    includesPrivateNote: false,
    status: 'queued',
    sendAttempted: false,
    lastResult: { status: 'pending', reason: 'draft-queued', live: false, evidenceLevel: 'U1' },
  }
  ledger.set(entry.id, entry)
  return entry
}

export function approveMailDraft(ledger: Map<string, MailLedgerEntry>, id: string): MailLedgerEntry | undefined {
  const entry = ledger.get(id)
  if (!entry) return undefined
  entry.approvedTo = [...entry.to]
  entry.approvedAttachments = [...entry.attachments]
  entry.lastResult = { status: 'pending', reason: 'approved-payload', live: false, evidenceLevel: 'U1' }
  return entry
}

export function sendPreparedMail(
  ledger: Map<string, MailLedgerEntry>,
  id: string,
  credentials: ConationCredentials,
  seen: Set<string>,
): MeetingOpResult {
  const entry = ledger.get(id)
  if (!entry) return denied('missing-draft')
  if (entry.sendAttempted) {
    entry.status = 'unknown'
    entry.lastResult = unknownEffect('send-unknown')
    return entry.lastResult
  }
  if (!credentials.present) {
    entry.status = 'blocked'
    entry.lastResult = missingCredentials('missing-credentials')
    return entry.lastResult
  }
  const draft: MailDraft = {
    id: entry.id,
    threadId: entry.threadId,
    to: entry.to,
    approvedTo: entry.approvedTo,
    attachments: entry.attachments,
    approvedAttachments: entry.approvedAttachments,
    includesPrivateNote: entry.includesPrivateNote,
  }
  entry.sendAttempted = true
  const result = sendMail(draft, `mail:${entry.id}`, seen)
  entry.lastResult = result
  entry.status = result.status === 'blocked' || result.status === 'denied' ? 'blocked' : 'unknown'
  return result
}

export function rollbackMailSend(): MeetingOpResult {
  return denied('rollback-disabled')
}

export function proposeCrmCard(
  candidates: readonly CrmTarget[],
  wanted: { readonly accountId: string; readonly remoteType: CrmTarget['remoteType']; readonly remoteId: string },
  credentials: ConationCredentials,
  options: {
    readonly dealCapability: boolean
    readonly relatedSourceDenied?: boolean
    readonly baseRevision: string
    readonly currentRevision: string
  },
): MeetingOpResult {
  if (!credentials.present) return missingCredentials('missing-credentials')
  const target = resolveCrmTarget(candidates, wanted)
  return proposeCrmEdit(target, options)
}

export function bindCalendarOccurrence(
  row: CalendarOccurrence,
  credentials: ConationCredentials,
  reminders: Map<string, ReminderLedgerEntry>,
): MeetingOpResult {
  if (!credentials.present) return missingCredentials('missing-credentials')
  const key = occurrenceKey(row)
  const reminder: ReminderLedgerEntry = {
    id: `reminder:${key}`,
    occurrenceKey: key,
    toastOnly: false,
    status: 'blocked',
    lastResult: blocked('calendar-conation-unconfirmed'),
  }
  reminders.set(key, reminder)
  return reminder.lastResult
}

export function reminderIsToastOnly(): false {
  return false
}

export function joinNativeRoom(input: {
  readonly roomId: string
  readonly actorId: string
  readonly guest?: boolean
  readonly recordingConsent?: boolean
}): { ok: false; reason: string; decided: false } {
  const result = joinRoom(
    {
      roomId: input.roomId,
      actorId: input.actorId,
      guest: input.guest,
      recordingConsent: input.recordingConsent,
    },
    [],
  )
  return { ok: false, reason: result.reason, decided: ROOM_PROVIDER_DECISION.decided }
}

export function listMailThreads(
  credentials: ConationCredentials,
  stored: readonly { readonly id: string; readonly subject: string }[] = [],
): { items: MailThreadRow[]; live: false; blocked: boolean } {
  if (!credentials.present) {
    return { items: [], live: false, blocked: true }
  }
  return {
    items: stored.map((row) => ({
      entityId: `mail-thread:${row.id}`,
      subject: row.subject,
      live: false,
    })),
    live: false,
    blocked: true,
  }
}
