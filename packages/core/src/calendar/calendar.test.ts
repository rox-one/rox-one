import { describe, it, expect, beforeEach } from 'bun:test'
import { CalendarStore, resetCalendarIds } from './store.ts'
import { FixtureCalendarAdapter, createProductionAdapter, isCalendarConnectorWired, isFixtureCalendarAdapter, liveCredentialsPresent, UnavailableCalendarAdapter, CalendarProviderUnavailableError } from './adapters.ts'
import { CALENDAR_CAPABILITIES } from './capabilities.ts'
import { mergeTodayUpcoming } from './merge.ts'
import type { CalendarProvider, TaskLike } from './types.ts'

const morning = Date.parse('2026-09-12T09:00:00')

describe('calendar connectors (issue 18)', () => {
  beforeEach(() => {
    resetCalendarIds()
  })

  it('declares capability gaps for every provider', () => {
    const providers: CalendarProvider[] = ['google', 'outlook', 'yandex', 'mailru', 'appleReminders']
    for (const provider of providers) {
      const gap = CALENDAR_CAPABILITIES[provider]
      expect(gap.provider).toBe(provider)
      expect(gap.notes.length).toBeGreaterThan(8)
    }
    expect(CALENDAR_CAPABILITIES.appleReminders.supportsOAuth).toBe(false)
    expect(CALENDAR_CAPABILITIES.google.supportsReminders).toBe(false)
    expect(CALENDAR_CAPABILITIES.yandex.supportsRecurrence).toBe(false)
  })

  it('stores OAuth as credential refs and never tokens', () => {
    const store = new CalendarStore()
    const account = store.connect('google', 'Work', 'Europe/Moscow')
    expect(account.status).toBe('pending')
    expect(account.credentialRef.startsWith('cred:calendar:google:')).toBe(true)
    expect(JSON.stringify(store.snapshot()).toLowerCase()).not.toContain('token')
    expect(JSON.stringify(store.snapshot()).toLowerCase()).not.toContain('secret')
    store.markConnected(account.id)
    expect(store.uiStatus('Europe/Moscow')).toBe('connected')
  })

  it('revokes OAuth without deleting local tasks', async () => {
    const store = new CalendarStore()
    const account = store.connect('outlook', 'Mail', 'UTC')
    store.markConnected(account.id)
    const tasks: TaskLike[] = [{ id: 't1', title: 'Keep me', list: 'today', dueAt: morning }]
    store.revoke(account.id)
    expect(store.accounts()[0]?.status).toBe('revoked')
    expect(store.revokeLeavesTasks(tasks)).toEqual(tasks)
    const adapter = new FixtureCalendarAdapter('outlook', [{ id: 'e1', title: 'After revoke', startAt: morning, endAt: morning + 3600000 }])
    await store.sync(account.id, adapter, morning)
    expect(store.events()).toHaveLength(0)
  })

  it('merges events with Today/Upcoming without converting them into tasks', () => {
    const tasks: TaskLike[] = [
      { id: 't1', title: 'Ship inspect', list: 'today', dueAt: morning, projectId: 'p1' },
      { id: 't2', title: 'Later', list: 'upcoming', dueAt: morning + 3 * 86400000 },
    ]
    const events = [{
      id: 'e1',
      accountId: 'a1',
      calendarId: 'primary',
      title: 'Standup',
      startAt: morning + 3600000,
      endAt: morning + 5400000,
      allDay: false,
      timeZone: 'UTC',
      deleted: false,
      kind: 'event' as const,
    }]
    const merged = mergeTodayUpcoming(tasks, events, morning)
    expect(merged.some((item) => item.kind === 'task' && item.id === 't1')).toBe(true)
    expect(merged.some((item) => item.kind === 'event' && item.event.kind === 'event')).toBe(true)
    expect(merged.filter((item) => item.kind === 'event').map((item) => item.id)).not.toContain('t1')
    expect(merged.filter((item) => item.kind === 'task').map((item) => item.id)).not.toContain('e1')
  })

  it('creates editable reminder proposals and never auto-spams tasks', async () => {
    const store = new CalendarStore()
    const account = store.connect('google', 'Work', 'UTC')
    store.markConnected(account.id)
    const adapter = new FixtureCalendarAdapter('google', [{
      id: 'ev-1',
      title: 'Dentist',
      startAt: morning + 86400000,
      endAt: morning + 86400000 + 3600000,
    }])
    await store.sync(account.id, adapter, morning)
    expect(store.proposals()).toHaveLength(0)
    const proposal = store.proposeReminder(store.events()[0]!)
    expect(proposal.accepted).toBe(false)
    store.acceptProposal(proposal.id)
    expect(store.proposals()[0]?.accepted).toBe(true)
    expect(store.events().every((event) => event.kind === 'event')).toBe(true)
  })

  it('records incremental sync conflicts only when the local event is dirty', async () => {
    const store = new CalendarStore()
    const account = store.connect('mailru', 'Mail', 'UTC')
    store.markConnected(account.id)
    const first = new FixtureCalendarAdapter('mailru', [{ id: 'e1', title: 'A', startAt: morning, endAt: morning + 1000, etag: '1' }])
    await store.sync(account.id, first, morning)
    store.markLocalDirty(store.events()[0]!)
    const second = new FixtureCalendarAdapter('mailru', [{ id: 'e1', title: 'A2', startAt: morning, endAt: morning + 1000, etag: '2' }])
    await store.sync(account.id, second, morning + 1000)
    expect(store.conflicts().some((conflict) => conflict.kind === 'update')).toBe(true)
    expect(store.uiStatus('UTC')).toBe('conflict')
    expect(store.events().find((event) => event.id === 'e1')?.title).toBe('A')
  })

  it('selects duplicate remote event ids by account and calendar identity', async () => {
    const store = new CalendarStore()
    const account = store.connect('google', 'Work', 'UTC')
    store.markConnected(account.id)
    await store.sync(account.id, new FixtureCalendarAdapter('google', [
      { id: 'shared', calendarId: 'primary', title: 'Primary', startAt: morning, endAt: morning + 1000, etag: 'p1' },
      { id: 'shared', calendarId: 'secondary', title: 'Secondary', startAt: morning + 2000, endAt: morning + 3000, etag: 's1' },
    ]), morning)

    const primary = store.events().find((event) => event.calendarId === 'primary')!
    const secondary = store.events().find((event) => event.calendarId === 'secondary')!
    store.markLocalDirty(primary)

    await store.sync(account.id, new FixtureCalendarAdapter('google', [
      { id: 'shared', calendarId: 'primary', title: 'Remote primary', startAt: morning, endAt: morning + 1000, etag: 'p2' },
      { id: 'shared', calendarId: 'secondary', title: 'Remote secondary', startAt: morning + 2000, endAt: morning + 3000, etag: 's2' },
    ]), morning + 1)

    expect(store.events().find((event) => event.calendarId === 'primary')?.title).toBe('Primary')
    expect(store.events().find((event) => event.calendarId === 'secondary')?.title).toBe('Remote secondary')
    const proposal = store.proposeReminder(secondary)
    expect(proposal.title).toBe('Remote secondary')
    const merged = mergeTodayUpcoming([], store.events(), morning).filter((item) => item.kind === 'event')
    expect(new Set(merged.map((item) => item.id)).size).toBe(merged.length)
  })

  it('records one fully scoped conflict across repeated syncs', async () => {
    const store = new CalendarStore()
    const account = store.connect('google', 'Work', 'UTC')
    store.markConnected(account.id)
    const seed = { id: 'shared', calendarId: 'secondary', title: 'Local', startAt: morning, endAt: morning + 1000, etag: '1' }
    await store.sync(account.id, new FixtureCalendarAdapter('google', [seed]), morning)
    const event = store.events()[0]!
    store.markLocalDirty(event)
    const update = { ...seed, title: 'Remote', etag: '2' }

    await store.sync(account.id, new FixtureCalendarAdapter('google', [update]), morning + 1)
    await store.sync(account.id, new FixtureCalendarAdapter('google', [update]), morning + 2)

    expect(store.conflicts()).toEqual([
      expect.objectContaining({
        kind: 'update',
        eventId: 'shared',
        eventIdentity: JSON.stringify([account.id, 'secondary', 'shared']),
      }),
    ])
    expect(store.events()[0]?.title).toBe('Local')
  })
  it('updates one scoped conflict when the remote event is subsequently deleted', async () => {
    const store = new CalendarStore()
    const account = store.connect('google', 'Work', 'UTC')
    store.markConnected(account.id)
    const local = { id: 'delete-conflict', calendarId: 'primary', title: 'Local draft', startAt: morning, endAt: morning + 1000, etag: '1' }
    await store.sync(account.id, new FixtureCalendarAdapter('google', [local]), morning)
    store.markLocalDirty(store.events()[0]!)
    await store.sync(account.id, new FixtureCalendarAdapter('google', [{ ...local, title: 'Remote', etag: '2' }]), morning + 1)
    await store.sync(account.id, new FixtureCalendarAdapter('google', [{ ...local, deleted: true, etag: '3' }]), morning + 2)

    expect(store.conflicts()).toHaveLength(1)
    expect(store.conflicts()[0]?.kind).toBe('delete')
    expect(store.conflicts()[0]?.remoteEvent?.deleted).toBe(true)
    store.resolveConflict(store.conflicts()[0]!.id, 'remote')
    expect(store.events()).toHaveLength(0)
  })

  it('retains a local draft when sync repeats its unchanged base revision', async () => {
    const store = new CalendarStore()
    const account = store.connect('google', 'Work', 'UTC')
    store.markConnected(account.id)
    const remote = { id: 'draft', title: 'Original', startAt: morning, endAt: morning + 1000, etag: '1' }
    await store.sync(account.id, new FixtureCalendarAdapter('google', [remote]), morning)
    const local = store.events()[0]!
    local.title = 'Local draft'
    store.markLocalDirty(local)
    await store.sync(account.id, new FixtureCalendarAdapter('google', [remote]), morning + 1)

    expect(store.events()[0]?.title).toBe('Local draft')
    expect(store.events()[0]?.localDirty).toBe(true)
    expect(store.conflicts()).toHaveLength(0)
  })


  it('persists remote conflict data and resolves to either chosen calendar version', async () => {
    const store = new CalendarStore()
    const account = store.connect('google', 'Work', 'UTC')
    store.markConnected(account.id)
    const local = { id: 'resolve-me', calendarId: 'primary', title: 'Local draft', startAt: morning, endAt: morning + 1000, etag: '1' }
    await store.sync(account.id, new FixtureCalendarAdapter('google', [local]), morning)
    store.markLocalDirty(store.events()[0]!)
    await store.sync(account.id, new FixtureCalendarAdapter('google', [{
      ...local,
      title: 'Remote update',
      startAt: morning + 5000,
      endAt: morning + 6000,
      etag: '2',
    }]), morning + 1)

    const conflict = store.conflicts()[0]!
    expect(conflict.remoteEvent?.title).toBe('Remote update')
    const restored = CalendarStore.fromJson(store.exportJson())
    restored.resolveConflict(conflict.id, 'remote')
    expect(restored.conflicts()).toHaveLength(0)
    expect(restored.events()[0]?.title).toBe('Remote update')
    expect(restored.events()[0]?.startAt).toBe(morning + 5000)
    expect(restored.events()[0]?.localDirty).toBe(false)
    expect(restored.uiStatus('UTC')).toBe('connected')
  })

  it('keeps a locally chosen draft through repeated reads of the acknowledged remote revision', async () => {
    const store = new CalendarStore()
    const account = store.connect('google', 'Work', 'UTC')
    store.markConnected(account.id)
    const local = { id: 'keep-local', calendarId: 'primary', title: 'Local draft', startAt: morning, endAt: morning + 1000, etag: '1' }
    await store.sync(account.id, new FixtureCalendarAdapter('google', [local]), morning)
    store.markLocalDirty(store.events()[0]!)
    const remote = { ...local, title: 'Remote update', etag: '2' }
    await store.sync(account.id, new FixtureCalendarAdapter('google', [remote]), morning + 1)

    store.resolveConflict(store.conflicts()[0]!.id, 'local')
    await store.sync(account.id, new FixtureCalendarAdapter('google', [remote]), morning + 2)

    expect(store.events()[0]?.title).toBe('Local draft')
    expect(store.events()[0]?.localDirty).toBe(true)
    expect(store.uiStatus('UTC')).toBe('localChanges')
    expect(store.conflicts()).toHaveLength(0)
  })


  it('keeps same remote event ids from two accounts and delete is scoped', async () => {
    const store = new CalendarStore()
    const work = store.connect('google', 'Work', 'UTC')
    const home = store.connect('google', 'Home', 'UTC')
    store.markConnected(work.id)
    store.markConnected(home.id)
    await store.sync(work.id, new FixtureCalendarAdapter('google', [{ id: 'shared', title: 'Work copy', startAt: morning, endAt: morning + 1000, etag: 'w1' }]), morning)
    await store.sync(home.id, new FixtureCalendarAdapter('google', [{ id: 'shared', title: 'Home copy', startAt: morning, endAt: morning + 2000, etag: 'h1' }]), morning)
    expect(store.events()).toHaveLength(2)
    expect(store.events().map((event) => event.title).sort()).toEqual(['Home copy', 'Work copy'])
    await store.sync(work.id, new FixtureCalendarAdapter('google', [{ id: 'shared', title: 'Work copy', startAt: morning, endAt: morning + 1000, etag: 'w1', deleted: true }]), morning + 1)
    expect(store.events()).toHaveLength(1)
    expect(store.events()[0]?.accountId).toBe(home.id)
    expect(store.events()[0]?.title).toBe('Home copy')
  })

  it('applies remote-only etag updates without a false conflict', async () => {
    const store = new CalendarStore()
    const account = store.connect('google', 'Work', 'UTC')
    store.markConnected(account.id)
    await store.sync(account.id, new FixtureCalendarAdapter('google', [{ id: 'e1', title: 'A', startAt: morning, endAt: morning + 1000, etag: '1' }]), morning)
    await store.sync(account.id, new FixtureCalendarAdapter('google', [{ id: 'e1', title: 'A2', startAt: morning, endAt: morning + 1000, etag: '2' }]), morning + 1)
    expect(store.conflicts()).toHaveLength(0)
    expect(store.events()[0]?.title).toBe('A2')
    expect(store.events()[0]?.etag).toBe('2')
  })

  it('restores mint seq fromJson so later creates do not collide', () => {
    const store = new CalendarStore()
    store.connect('google', 'Work', 'UTC')
    store.addLocalReminder('Keep', morning)
    const restored = CalendarStore.fromJson(store.exportJson())
    const next = restored.connect('outlook', 'Mail', 'UTC')
    const reminder = restored.addLocalReminder('Later', morning)
    const ids = [...restored.accounts().map((account) => account.id), reminder.id]
    expect(new Set(ids).size).toBe(ids.length)
    expect(next.id).not.toBe(store.accounts()[0]?.id)
  })

  it('does not apply a delayed fetch after revoke', async () => {
    const store = new CalendarStore()
    const account = store.connect('outlook', 'Mail', 'UTC')
    store.markConnected(account.id)
    const adapter = new FixtureCalendarAdapter('outlook', [{ id: 'late', title: 'Too late', startAt: morning, endAt: morning + 1000 }])
    const original = adapter.listEvents.bind(adapter)
    adapter.listEvents = async (accountId, cursor) => {
      store.revoke(account.id)
      return original(accountId, cursor)
    }
    await store.sync(account.id, adapter, morning)
    expect(store.events()).toHaveLength(0)
    expect(store.accounts()[0]?.status).toBe('revoked')
  })

  it('flags timezone mismatch as a visible warning', async () => {
    const store = new CalendarStore()
    const account = store.connect('yandex', 'Ya', 'Europe/Moscow')
    store.markConnected(account.id)
    const adapter = new FixtureCalendarAdapter('yandex', [{
      id: 'tz1',
      title: 'Call',
      startAt: morning,
      endAt: morning + 1800000,
      timeZone: 'America/New_York',
    }])
    await store.sync(account.id, adapter, morning)
    expect(store.uiStatus('Europe/Moscow')).toBe('timezone')
  })

  it('stores local reminders without a connected calendar', () => {
    const store = new CalendarStore()
    expect(store.uiStatus('UTC')).toBe('none')
    const reminder = store.addLocalReminder('Stand up', morning + 3600000)
    expect(reminder.sourceEventId).toBeUndefined()
    expect(store.localReminders().map((item) => item.title)).toEqual(['Stand up'])
    store.dismissProposal(reminder.id)
    expect(store.localReminders()).toHaveLength(0)
  })

  it('does not treat unwired optional connectors as connected', () => {
    expect(isCalendarConnectorWired('google')).toBe(false)
    expect(isCalendarConnectorWired('outlook')).toBe(false)
    expect(isCalendarConnectorWired('yandex')).toBe(false)
    expect(isCalendarConnectorWired('mailru')).toBe(false)
    expect(isCalendarConnectorWired('appleReminders')).toBe(false)
  })

  it('production factory never returns fixture adapters', () => {
    const providers: CalendarProvider[] = ['google', 'outlook', 'yandex', 'mailru', 'appleReminders']
    for (const provider of providers) {
      const adapter = createProductionAdapter(provider)
      expect(isFixtureCalendarAdapter(adapter)).toBe(false)
      expect(adapter).toBeInstanceOf(UnavailableCalendarAdapter)
      expect(adapter.mode).toBe('unavailable')
    }
  })

  it('env credentials are not live evidence for production adapters', () => {
    const previous = process.env.ROX_CALENDAR_GOOGLE_LIVE
    process.env.ROX_CALENDAR_GOOGLE_LIVE = '1'
    try {
      expect(liveCredentialsPresent('google')).toBe(true)
      const adapter = createProductionAdapter('google')
      expect(adapter.available()).toBe(false)
      expect(isCalendarConnectorWired('google')).toBe(false)
      expect(isFixtureCalendarAdapter(adapter)).toBe(false)
    } finally {
      if (previous === undefined) delete process.env.ROX_CALENDAR_GOOGLE_LIVE
      else process.env.ROX_CALENDAR_GOOGLE_LIVE = previous
    }
  })

  it('availableFlag cannot be true when listEvents is unavailable', async () => {
    const adapter = new UnavailableCalendarAdapter('appleReminders', true)
    expect(adapter.available()).toBe(false)
    await expect(adapter.listEvents('live')).rejects.toBeInstanceOf(CalendarProviderUnavailableError)
  })

  it('Apple helper presence is not live evidence for production adapters', async () => {
    const previousHelper = process.env.ROX_APPLE_REMINDERS_HELPER
    const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')
    process.env.ROX_APPLE_REMINDERS_HELPER = '1'
    Object.defineProperty(process, 'platform', { configurable: true, value: 'darwin' })
    try {
      expect(liveCredentialsPresent('appleReminders')).toBe(true)
      const adapter = createProductionAdapter('appleReminders')
      expect(adapter.available()).toBe(false)
      expect(isCalendarConnectorWired('appleReminders')).toBe(false)
      expect(isFixtureCalendarAdapter(adapter)).toBe(false)
      expect(adapter.mode).toBe('unavailable')
      await expect(adapter.listEvents('live')).rejects.toBeInstanceOf(CalendarProviderUnavailableError)
    } finally {
      if (previousHelper === undefined) delete process.env.ROX_APPLE_REMINDERS_HELPER
      else process.env.ROX_APPLE_REMINDERS_HELPER = previousHelper
      if (platformDescriptor) Object.defineProperty(process, 'platform', platformDescriptor)
    }
  })

  const providers: CalendarProvider[] = ['google', 'outlook', 'yandex', 'mailru', 'appleReminders']
  for (const provider of providers) {
    it(`live ${provider} account test skips without a verified adapter`, async () => {
      const adapter = createProductionAdapter(provider)
      expect(isFixtureCalendarAdapter(adapter)).toBe(false)
      if (!adapter.available()) {
        await expect(adapter.listEvents('live')).rejects.toBeInstanceOf(CalendarProviderUnavailableError)
        return
      }
      await expect(adapter.listEvents('live')).rejects.toBeInstanceOf(CalendarProviderUnavailableError)
    })
  }
})
