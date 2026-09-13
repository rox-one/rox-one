import { describe, expect, it } from 'bun:test'
import {
  approveMailDraft,
  bindCalendarOccurrence,
  joinNativeRoom,
  listMailThreads,
  prepareMailDraft,
  proposeCrmCard,
  reminderIsToastOnly,
  rollbackMailSend,
  sendPreparedMail,
  type MailLedgerEntry,
  type ReminderLedgerEntry,
} from '../native-shells.ts'
import type { CrmTarget } from '../crm.ts'
import type { CalendarOccurrence } from '../calendar-calls.ts'

describe('native Conation shells (#380/#381/#382/#389)', () => {
  it('queues a mail draft locally and blocks send without credentials', () => {
    const ledger = new Map<string, MailLedgerEntry>()
    const draft = prepareMailDraft(ledger, {
      id: 'd1',
      threadId: 'th1',
      to: ['a@example.com'],
      attachments: ['file-1'],
    })
    expect(draft.status).toBe('queued')
    expect(ledger.get('d1')?.status).toBe('queued')
    const blocked = sendPreparedMail(ledger, 'd1', { present: false }, new Set())
    expect(blocked.status).toBe('blocked')
    expect(blocked.reason).toBe('missing-credentials')
    expect(blocked.live).toBe(false)
  })

  it('does not resend after an unknown attempt and cannot roll back send', () => {
    const ledger = new Map<string, MailLedgerEntry>()
    prepareMailDraft(ledger, { id: 'd2', threadId: 'th1', to: ['a@example.com'] })
    approveMailDraft(ledger, 'd2')
    const first = sendPreparedMail(ledger, 'd2', { present: true, accountId: 'acct-1' }, new Set())
    expect(first.status).toBe('blocked')
    expect(first.reason).toBe('mail-conation-unconfirmed')
    const entry = ledger.get('d2')
    if (!entry) throw new Error('missing ledger')
    entry.sendAttempted = true
    entry.status = 'unknown'
    const replay = sendPreparedMail(ledger, 'd2', { present: true }, new Set())
    expect(replay.status).toBe('unknown')
    expect(rollbackMailSend().reason).toBe('rollback-disabled')
  })

  it('resolves CRM by account+type+id and stays blocked without credentials', () => {
    const acmeA: CrmTarget = { accountId: 'acct-a', remoteType: 'company', remoteId: 'co-1', displayName: 'Acme' }
    const acmeB: CrmTarget = { accountId: 'acct-b', remoteType: 'company', remoteId: 'co-2', displayName: 'Acme' }
    expect(
      proposeCrmCard([acmeA, acmeB], { accountId: 'acct-b', remoteType: 'company', remoteId: 'co-2' }, { present: false }, {
        dealCapability: true,
        baseRevision: '1',
        currentRevision: '1',
      }).reason,
    ).toBe('missing-credentials')
    const withCreds = proposeCrmCard(
      [acmeA, acmeB],
      { accountId: 'acct-b', remoteType: 'company', remoteId: 'co-2' },
      { present: true, accountId: 'acct-b' },
      { dealCapability: true, baseRevision: '1', currentRevision: '1' },
    )
    expect(withCreds.status).toBe('blocked')
    expect(withCreds.reason).toBe('crm-conation-unconfirmed')
  })

  it('records calendar reminders as first-class ledger rows, not toasts', () => {
    const reminders = new Map<string, ReminderLedgerEntry>()
    const row: CalendarOccurrence = {
      accountId: 'acct-1',
      calendarId: 'cal-1',
      eventId: 'evt-1',
      occurrenceId: 'occ-1',
      timeZone: 'Europe/Moscow',
      dateOnly: true,
    }
    expect(bindCalendarOccurrence(row, { present: false }, reminders).reason).toBe('missing-credentials')
    const result = bindCalendarOccurrence(row, { present: true, accountId: 'acct-1' }, reminders)
    expect(result.status).toBe('blocked')
    expect(reminderIsToastOnly()).toBe(false)
    expect([...reminders.values()][0]?.toastOnly).toBe(false)
  })

  it('does not treat an undecided SFU as a room', () => {
    const join = joinNativeRoom({ roomId: 'r1', actorId: 'host', recordingConsent: true })
    expect(join.ok).toBe(false)
    expect(join.decided).toBe(false)
    expect(join.reason).toBe('sfu-undecided')
  })

  it('lists mail-thread entities natively and never as live without credentials', () => {
    const empty = listMailThreads({ present: false }, [{ id: 't1', subject: 'Hello' }])
    expect(empty.items).toEqual([])
    expect(empty.live).toBe(false)
    expect(empty.blocked).toBe(true)
    const listed = listMailThreads({ present: true }, [{ id: 't1', subject: 'Hello' }])
    expect(listed.items[0]?.entityId).toBe('mail-thread:t1')
    expect(listed.live).toBe(false)
    expect(listed.blocked).toBe(true)
  })
})
