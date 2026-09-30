import { calendarEventIdentity, emptyCalendarBundle, sameCalendarEvent, type CalendarAccount, type CalendarBundle, type CalendarEvent, type CalendarProvider, type CalendarUiStatus, type ReminderProposal, type SyncConflictKind, type SyncJournal, type TaskLike } from './types.ts'
import { createProductionAdapter, type CalendarAdapter } from './adapters.ts'
import { capabilityFor } from './capabilities.ts'
import { timezoneWarnings } from './merge.ts'

function seqFromId(id: string): number {
  const match = /-([0-9a-f]+)$/i.exec(id)
  if (!match?.[1]) return 0
  const value = Number.parseInt(match[1], 16)
  return Number.isFinite(value) ? value : 0
}

function restoreSeq(bundle: CalendarBundle): number {
  let max = bundle.idSeq ?? 0
  for (const account of bundle.accounts) max = Math.max(max, seqFromId(account.id))
  for (const proposal of bundle.proposals) max = Math.max(max, seqFromId(proposal.id))
  for (const journal of bundle.journals) {
    for (const conflict of journal.conflicts) max = Math.max(max, seqFromId(conflict.id))
  }
  return max
}
function calendarRemoteRevision(event: CalendarEvent): string {
  return JSON.stringify([event.deleted ? 'delete' : 'update', event.etag ?? null])
}


export function resetCalendarIds(): void {
  // Per-store seq is restored from persisted ids. Kept for test isolation of older callers.
}

export function credentialRefFor(provider: CalendarProvider, accountId: string): string {
  return `cred:calendar:${provider}:${accountId}`
}

export class CalendarStore {
  private bundle: CalendarBundle
  private seq: number

  constructor(bundle: CalendarBundle = emptyCalendarBundle()) {
    this.bundle = structuredClone(bundle)
    this.bundle.version = 1
    this.seq = restoreSeq(this.bundle)
  }

  snapshot(): CalendarBundle {
    const copy = structuredClone(this.bundle)
    copy.idSeq = this.seq
    return copy
  }

  exportJson(): string {
    return JSON.stringify(this.snapshot(), null, 2)
  }

  static fromJson(raw: string): CalendarStore {
    const parsed = JSON.parse(raw) as Partial<CalendarBundle>
    return new CalendarStore({
      version: 1,
      idSeq: typeof parsed.idSeq === 'number' ? parsed.idSeq : 0,
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

  resolveConflict(conflictId: string, resolution: 'local' | 'remote'): CalendarEvent {
    const journal = this.bundle.journals.find((item) =>
      item.conflicts.some((conflict) => conflict.id === conflictId),
    )
    const conflictIndex = journal?.conflicts.findIndex((conflict) => conflict.id === conflictId) ?? -1
    const conflict = conflictIndex >= 0 ? journal?.conflicts[conflictIndex] : undefined
    if (!journal || !conflict) throw new Error(`Unknown conflict ${conflictId}`)
    if (!conflict.remoteEvent) throw new Error(`Conflict ${conflictId} has no remote snapshot`)

    const remoteEvent = conflict.remoteEvent
    const event = this.bundle.events.find((item) => sameCalendarEvent(item, remoteEvent))
    if (!event) throw new Error(`Unknown event ${conflict.eventIdentity ?? conflict.eventId}`)
    if (resolution === 'remote') {
      Object.assign(event, conflict.remoteEvent, { localDirty: false, acknowledgedRemoteRevision: undefined })
    } else {
      event.localDirty = true
      event.acknowledgedRemoteRevision = calendarRemoteRevision(conflict.remoteEvent)
    }
    journal.conflicts.splice(conflictIndex, 1)
    return event
  }

  connect(provider: CalendarProvider, displayName: string, timeZone: string): CalendarAccount {
    if (provider === 'appleReminders' && !createProductionAdapter(provider).available()) {
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
    return account
  }

  markLocalDirty(identity: Pick<CalendarEvent, 'accountId' | 'calendarId' | 'id'>): CalendarEvent {
    const event = this.bundle.events.find(
      (item) => sameCalendarEvent(item, identity) && !item.deleted,
    )
    if (!event) throw new Error(`Unknown event ${calendarEventIdentity(identity)}`)
    event.localDirty = true
    return event
  }

  async sync(accountId: string, adapter: CalendarAdapter, now = Date.now()): Promise<void> {
    const account = this.requireAccount(accountId)
    if (account.status === 'revoked') return
    if (account.status !== 'connected') return
    const journal = this.bundle.journals.find((item) => item.accountId === accountId)
    if (!journal) return
    const page = await adapter.listEvents(accountId, journal.cursor)
    if (this.requireAccount(accountId).status !== 'connected') return
    for (const incoming of page.events) {
      const scoped: CalendarEvent = {
        ...incoming,
        accountId,
        calendarId: incoming.calendarId || 'primary',
        deleted: incoming.deleted ?? false,
        localDirty: false,
      }
      const existing = this.bundle.events.find((event) => sameCalendarEvent(event, scoped))
      if (existing?.localDirty) {
        if (existing.acknowledgedRemoteRevision === calendarRemoteRevision(scoped)) continue
        if (!incoming.deleted && incoming.etag && existing.etag === incoming.etag) continue
        this.recordConflict(journal, incoming.deleted ? 'delete' : 'update', existing, scoped)
        continue
      }
      if (existing && incoming.deleted) {
        existing.deleted = true
        existing.localDirty = false
        continue
      }
      if (existing) {
        Object.assign(existing, scoped)
        existing.acknowledgedRemoteRevision = undefined
      } else {
        this.bundle.events.push({ ...scoped, localDirty: false })
      }
    }
    journal.cursor = page.cursor
    journal.lastSyncAt = now
    journal.lastSyncedRevision = page.cursor
  }

  proposeReminder(identity: Pick<CalendarEvent, 'accountId' | 'calendarId' | 'id'>): ReminderProposal {
    const event = this.bundle.events.find((item) =>
      sameCalendarEvent(item, identity) && !item.deleted,
    )
    if (!event) throw new Error(`Unknown event ${calendarEventIdentity(identity)}`)
    const proposal: ReminderProposal = {
      id: this.mint('prop'),
      title: event.title,
      dueAt: event.startAt,
      sourceEventId: event.id,
      sourceEventIdentity: calendarEventIdentity(event),
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
      id: this.mint('prop'),
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
    if (live.some((account) => account.status === 'pending')) return 'pending'
    if (this.conflicts().length > 0) return 'conflict'
    if (timezoneWarnings(this.events(), localTimeZone).length > 0) return 'timezone'
    if (this.bundle.events.some((event) => event.localDirty && !event.deleted)) return 'localChanges'
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

  private recordConflict(
    journal: SyncJournal,
    kind: SyncConflictKind,
    event: CalendarEvent,
    remoteEvent: CalendarEvent,
  ): void {
    const eventIdentity = calendarEventIdentity(event)
    const existing = journal.conflicts.find((conflict) => conflict.eventIdentity === eventIdentity)
    if (existing) {
      existing.kind = kind
      existing.eventId = event.id
      existing.remoteEvent = structuredClone(remoteEvent)
      return
    }
    journal.conflicts.push({
      id: this.mint('conf'),
      kind,
      eventId: event.id,
      eventIdentity,
      remoteEvent: structuredClone(remoteEvent),
    })
  }

  private mint(prefix: string): string {
    this.seq += 1
    this.bundle.idSeq = this.seq
    return `${prefix}-${this.seq.toString(16)}`
  }

  private requireAccount(id: string): CalendarAccount {
    const account = this.bundle.accounts.find((item) => item.id === id)
    if (!account) throw new Error(`Unknown calendar account ${id}`)
    return account
  }
}
