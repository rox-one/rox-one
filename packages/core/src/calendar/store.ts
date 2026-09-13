import { emptyCalendarBundle, type CalendarAccount, type CalendarBundle, type CalendarEvent, type CalendarProvider, type CalendarUiStatus, type ReminderProposal, type TaskLike } from './types.ts'
import type { CalendarAdapter } from './adapters.ts'
import { appleRemindersAvailable, capabilityFor } from './capabilities.ts'
import { timezoneWarnings } from './merge.ts'

let testSeqSeed = 0

function parseSeqFromId(id: string): number {
  const match = /-([0-9a-f]+)$/i.exec(id)
  return match ? Number.parseInt(match[1]!, 16) : 0
}

function maxSeqFrom(ids: readonly string[], stored = 0): number {
  return ids.reduce((acc, id) => Math.max(acc, parseSeqFromId(id)), stored)
}

export function resetCalendarIds(): void {
  testSeqSeed = 0
}

export function credentialRefFor(provider: CalendarProvider, accountId: string): string {
  return `cred:calendar:${provider}:${accountId}`
}

export class CalendarStore {
  private bundle: CalendarBundle
  private seq: number
  private syncTicket = new Map<string, number>()

  constructor(bundle: CalendarBundle = emptyCalendarBundle()) {
    this.bundle = structuredClone(bundle)
    this.bundle.version = 2
    const ids = [
      ...this.bundle.accounts.map((item) => item.id),
      ...this.bundle.events.map((item) => item.id),
      ...this.bundle.journals.flatMap((journal) => journal.conflicts.map((conflict) => conflict.id)),
      ...this.bundle.proposals.map((item) => item.id),
    ]
    this.seq = maxSeqFrom(ids, this.bundle.nextSeq ?? testSeqSeed)
    this.bundle.nextSeq = this.seq
  }

  snapshot(): CalendarBundle {
    const snap = structuredClone(this.bundle)
    snap.nextSeq = this.seq
    snap.version = 2
    return snap
  }

  exportJson(): string {
    return JSON.stringify(this.snapshot(), null, 2)
  }

  static fromJson(raw: string): CalendarStore {
    const parsed = JSON.parse(raw) as Partial<CalendarBundle>
    return new CalendarStore({
      version: 2,
      nextSeq: typeof parsed.nextSeq === 'number' ? parsed.nextSeq : 0,
      accounts: Array.isArray(parsed.accounts) ? parsed.accounts : [],
      events: Array.isArray(parsed.events) ? parsed.events : [],
      journals: Array.isArray(parsed.journals) ? parsed.journals : [],
      proposals: Array.isArray(parsed.proposals) ? parsed.proposals : [],
    })
  }

  accounts(): CalendarAccount[] {
    return [...this.bundle.accounts]
  }

  events(): CalendarEvent[] {
    return this.bundle.events.filter((event) => !event.deleted)
  }

  proposals(): ReminderProposal[] {
    return this.bundle.proposals.filter((item) => !item.dismissed)
  }

  conflicts() {
    return this.bundle.journals.flatMap((journal) => journal.conflicts)
  }

  connect(provider: CalendarProvider, displayName: string, timeZone: string): CalendarAccount {
    if (provider === 'appleReminders' && !appleRemindersAvailable(process.platform, Boolean(process.env.ROX_APPLE_REMINDERS_HELPER))) {
      throw new Error('Apple Reminders requires a privileged macOS helper')
    }
    const id = this.mint('cal')
    const account: CalendarAccount = {
      id,
      provider,
      displayName,
      status: 'pending',
      scopedCalendarIds: ['primary'],
      timeZone,
      credentialRef: credentialRefFor(provider, id),
    }
    this.bundle.accounts.push(account)
    this.bundle.journals.push({ accountId: id, conflicts: [] })
    return account
  }

  markConnected(accountId: string): CalendarAccount {
    const account = this.requireAccount(accountId)
    if (account.status === 'revoked') throw new Error('Revoked accounts cannot reconnect in-place')
    account.status = 'connected'
    return account
  }

  revoke(accountId: string): CalendarAccount {
    const account = this.requireAccount(accountId)
    account.status = 'revoked'
    this.syncTicket.set(accountId, (this.syncTicket.get(accountId) ?? 0) + 1)
    return account
  }

  updateLocalEvent(accountId: string, eventId: string, patch: Partial<Pick<CalendarEvent, 'title' | 'startAt' | 'endAt' | 'timeZone' | 'allDay'>>): CalendarEvent {
    const event = this.bundle.events.find((item) => item.id === eventId && item.accountId === accountId)
    if (!event) throw new Error(`Unknown event ${eventId}`)
    Object.assign(event, patch)
    event.localDirty = true
    event.localRevision = (event.localRevision ?? 0) + 1
    return event
  }

  async sync(accountId: string, adapter: CalendarAdapter, now = Date.now()): Promise<void> {
    const account = this.requireAccount(accountId)
    if (account.status === 'revoked' || account.status !== 'connected') return
    const journal = this.bundle.journals.find((item) => item.accountId === accountId)
    if (!journal) return
    const ticket = (this.syncTicket.get(accountId) ?? 0) + 1
    this.syncTicket.set(accountId, ticket)
    const page = await adapter.listEvents(accountId, journal.cursor)
    const latest = this.requireAccount(accountId)
    if (latest.status !== 'connected') return
    if (this.syncTicket.get(accountId) !== ticket) return
    for (const incoming of page.events) {
      const existing = this.bundle.events.find(
        (event) => event.id === incoming.id && event.accountId === accountId,
      )
      if (existing && incoming.deleted) {
        if (existing.localDirty) {
          journal.conflicts.push({ id: this.mint('conf'), kind: 'delete', eventId: incoming.id })
          continue
        }
        journal.conflicts.push({ id: this.mint('conf'), kind: 'delete', eventId: incoming.id })
        existing.deleted = true
        existing.localDirty = false
        existing.lastSyncedEtag = incoming.etag
        existing.lastSyncedRevision = now
        continue
      }
      if (existing && existing.etag && incoming.etag && existing.etag !== incoming.etag && existing.localDirty) {
        journal.conflicts.push({ id: this.mint('conf'), kind: 'update', eventId: incoming.id })
        continue
      }
      if (existing) {
        const localDirty = existing.localDirty
        Object.assign(existing, incoming)
        existing.localDirty = false
        existing.lastSyncedEtag = incoming.etag
        existing.lastSyncedRevision = now
        if (localDirty && existing.etag === incoming.etag) existing.localDirty = false
      } else {
        this.bundle.events.push({
          ...incoming,
          localDirty: false,
          lastSyncedEtag: incoming.etag,
          lastSyncedRevision: now,
        })
      }
    }
    journal.cursor = page.cursor
    journal.lastSyncAt = now
  }

  proposeReminder(eventId: string): ReminderProposal {
    const event = this.bundle.events.find((item) => item.id === eventId)
    if (!event) throw new Error(`Unknown event ${eventId}`)
    const proposal: ReminderProposal = {
      id: this.mint('prop'),
      title: event.title,
      dueAt: event.startAt,
      sourceEventId: event.id,
      accepted: false,
      dismissed: false,
    }
    this.bundle.proposals.push(proposal)
    return proposal
  }

  acceptProposal(id: string): ReminderProposal {
    const proposal = this.bundle.proposals.find((item) => item.id === id)
    if (!proposal) throw new Error(`Unknown proposal ${id}`)
    proposal.accepted = true
    return proposal
  }

  dismissProposal(id: string): ReminderProposal {
    const proposal = this.bundle.proposals.find((item) => item.id === id)
    if (!proposal) throw new Error(`Unknown proposal ${id}`)
    proposal.dismissed = true
    return proposal
  }

  uiStatus(localTimeZone: string): CalendarUiStatus {
    const live = this.bundle.accounts.filter((account) => account.status !== 'revoked')
    if (live.length === 0) return 'none'
    if (live.some((account) => account.status === 'pending')) return 'pending'
    if (this.conflicts().length > 0) return 'conflict'
    if (timezoneWarnings(this.events(), localTimeZone).length > 0) return 'timezone'
    if (live.some((account) => account.status === 'connected')) return 'connected'
    return 'none'
  }

  capabilityNotes(provider: CalendarProvider): string {
    return capabilityFor(provider).notes
  }

  /** Revoke must not mutate caller task lists. */
  revokeLeavesTasks(tasks: readonly TaskLike[]): TaskLike[] {
    return tasks.map((task) => ({ ...task }))
  }

  private mint(prefix: string): string {
    this.seq += 1
    this.bundle.nextSeq = this.seq
    return `${prefix}-${this.seq.toString(16)}`
  }

  private requireAccount(id: string): CalendarAccount {
    const account = this.bundle.accounts.find((item) => item.id === id)
    if (!account) throw new Error(`Unknown calendar account ${id}`)
    return account
  }
}
