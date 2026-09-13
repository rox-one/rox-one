import { emptyCalendarBundle, type CalendarAccount, type CalendarBundle, type CalendarEvent, type CalendarProvider, type CalendarUiStatus, type ReminderProposal, type TaskLike } from './types.ts'
import { createProductionAdapter, type CalendarAdapter } from './adapters.ts'
import { capabilityFor } from './capabilities.ts'
import { timezoneWarnings } from './merge.ts'

let seq = 0
function mint(prefix: string): string {
  seq += 1
  return `${prefix}-${seq.toString(16)}`
}

export function resetCalendarIds(): void {
  seq = 0
}

export function credentialRefFor(provider: CalendarProvider, accountId: string): string {
  return `cred:calendar:${provider}:${accountId}`
}

export class CalendarStore {
  private bundle: CalendarBundle

  constructor(bundle: CalendarBundle = emptyCalendarBundle()) {
    this.bundle = structuredClone(bundle)
    this.bundle.version = 1
  }

  snapshot(): CalendarBundle {
    return structuredClone(this.bundle)
  }

  exportJson(): string {
    return JSON.stringify(this.snapshot(), null, 2)
  }

  static fromJson(raw: string): CalendarStore {
    const parsed = JSON.parse(raw) as Partial<CalendarBundle>
    return new CalendarStore({
      version: 1,
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
    if (provider === 'appleReminders' && !createProductionAdapter(provider).available()) {
      throw new Error('Apple Reminders requires a privileged macOS helper')
    }
    const id = mint('cal')
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
    return account
  }

  async sync(accountId: string, adapter: CalendarAdapter, now = Date.now()): Promise<void> {
    const account = this.requireAccount(accountId)
    if (account.status === 'revoked') return
    if (account.status !== 'connected') return
    const journal = this.bundle.journals.find((item) => item.accountId === accountId)
    if (!journal) return
    const page = await adapter.listEvents(accountId, journal.cursor)
    for (const incoming of page.events) {
      const existing = this.bundle.events.find((event) => event.id === incoming.id)
      if (existing && existing.etag && incoming.etag && existing.etag !== incoming.etag && !incoming.deleted) {
        journal.conflicts.push({ id: mint('conf'), kind: 'update', eventId: incoming.id })
      }
      if (existing && incoming.deleted) {
        journal.conflicts.push({ id: mint('conf'), kind: 'delete', eventId: incoming.id })
        existing.deleted = true
        continue
      }
      if (existing) Object.assign(existing, incoming)
      else this.bundle.events.push(incoming)
    }
    journal.cursor = page.cursor
    journal.lastSyncAt = now
  }

  proposeReminder(eventId: string): ReminderProposal {
    const event = this.bundle.events.find((item) => item.id === eventId)
    if (!event) throw new Error(`Unknown event ${eventId}`)
    const proposal: ReminderProposal = {
      id: mint('prop'),
      title: event.title,
      dueAt: event.startAt,
      sourceEventId: event.id,
      accepted: false,
      dismissed: false,
    }
    this.bundle.proposals.push(proposal)
    return proposal
  }

  /** Local reminder store — no calendar account required. */
  addLocalReminder(title: string, dueAt: number): ReminderProposal {
    const trimmed = title.trim()
    if (!trimmed) throw new Error('Reminder title is required')
    const proposal: ReminderProposal = {
      id: mint('prop'),
      title: trimmed,
      dueAt,
      accepted: false,
      dismissed: false,
    }
    this.bundle.proposals.push(proposal)
    return proposal
  }

  localReminders(): ReminderProposal[] {
    return this.proposals().filter((item) => item.sourceEventId == null)
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

  private requireAccount(id: string): CalendarAccount {
    const account = this.bundle.accounts.find((item) => item.id === id)
    if (!account) throw new Error(`Unknown calendar account ${id}`)
    return account
  }
}
