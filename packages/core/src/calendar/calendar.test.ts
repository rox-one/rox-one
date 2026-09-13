import { describe, it, expect, beforeEach } from 'bun:test'
import { CalendarStore, resetCalendarIds } from './store.ts'
import { FixtureCalendarAdapter, UnavailableCalendarAdapter, createProviderAdapter, liveCredentialsPresent } from './adapters.ts'
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
    expect(merged.filter((item) => item.kind === 'event').every((item) => item.kind !== 'task')).toBe(true)
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
    const proposal = store.proposeReminder('ev-1')
    expect(proposal.accepted).toBe(false)
    store.acceptProposal(proposal.id)
    expect(store.proposals()[0]?.accepted).toBe(true)
    expect(store.events().every((event) => event.kind === 'event')).toBe(true)
  })

  it('records incremental sync conflicts for the UI', async () => {
    const store = new CalendarStore()
    const account = store.connect('mailru', 'Mail', 'UTC')
    store.markConnected(account.id)
    const first = new FixtureCalendarAdapter('mailru', [{ id: 'e1', title: 'A', startAt: morning, endAt: morning + 1000, etag: '1' }])
    await store.sync(account.id, first, morning)
    store.updateLocalEvent(account.id, 'e1', { title: 'Local A' })
    const second = new FixtureCalendarAdapter('mailru', [{ id: 'e1', title: 'A2', startAt: morning, endAt: morning + 1000, etag: '2' }])
    await store.sync(account.id, second, morning + 1000)
    expect(store.conflicts().some((conflict) => conflict.kind === 'update')).toBe(true)
    expect(store.uiStatus('UTC')).toBe('conflict')
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

  const providers: CalendarProvider[] = ['google', 'outlook', 'yandex', 'mailru', 'appleReminders']
  for (const provider of providers) {
    it(`production ${provider} factory never returns a fixture adapter`, async () => {
      const adapter = createProviderAdapter(provider)
      expect(adapter).toBeInstanceOf(UnavailableCalendarAdapter)
      expect(adapter).not.toBeInstanceOf(FixtureCalendarAdapter)
      expect(adapter.available()).toBe(false)
      await expect(adapter.listEvents('acct')).rejects.toThrow(/not connected/)
      if (liveCredentialsPresent(provider)) {
        expect(adapter.available()).toBe(false)
      }
    })
  }

  it('keeps the same event id on two accounts as two events', async () => {
    const store = new CalendarStore()
    const google = store.connect('google', 'G', 'UTC')
    const outlook = store.connect('outlook', 'O', 'UTC')
    store.markConnected(google.id)
    store.markConnected(outlook.id)
    await store.sync(google.id, new FixtureCalendarAdapter('google', [{
      id: 'shared',
      title: 'Google copy',
      startAt: morning,
      endAt: morning + 1000,
    }]), morning)
    await store.sync(outlook.id, new FixtureCalendarAdapter('outlook', [{
      id: 'shared',
      title: 'Outlook copy',
      startAt: morning,
      endAt: morning + 1000,
    }]), morning)
    const events = store.events()
    expect(events).toHaveLength(2)
    expect(events.find((event) => event.accountId === google.id)?.title).toBe('Google copy')
    expect(events.find((event) => event.accountId === outlook.id)?.title).toBe('Outlook copy')
  })

  it('restores nextSeq so restore→create does not collide', () => {
    const store = new CalendarStore()
    const first = store.connect('google', 'A', 'UTC')
    const restored = CalendarStore.fromJson(store.exportJson())
    const second = restored.connect('google', 'B', 'UTC')
    expect(second.id).not.toBe(first.id)
    expect(restored.accounts().map((account) => account.id)).toEqual([first.id, second.id])
  })

  it('applies a remote-only etag change without a false conflict', async () => {
    const store = new CalendarStore()
    const account = store.connect('google', 'Work', 'UTC')
    store.markConnected(account.id)
    await store.sync(account.id, new FixtureCalendarAdapter('google', [{
      id: 'e1',
      title: 'Standup',
      startAt: morning,
      endAt: morning + 1000,
      etag: 'v1',
    }]), morning)
    await store.sync(account.id, new FixtureCalendarAdapter('google', [{
      id: 'e1',
      title: 'Standup moved',
      startAt: morning + 2000,
      endAt: morning + 3000,
      etag: 'v2',
    }]), morning + 1)
    expect(store.conflicts()).toHaveLength(0)
    expect(store.events()[0]?.title).toBe('Standup moved')
    expect(store.events()[0]?.localDirty).toBe(false)
  })

  it('conflicts when localDirty and remote etag both changed', async () => {
    const store = new CalendarStore()
    const account = store.connect('google', 'Work', 'UTC')
    store.markConnected(account.id)
    await store.sync(account.id, new FixtureCalendarAdapter('google', [{
      id: 'e1',
      title: 'Standup',
      startAt: morning,
      endAt: morning + 1000,
      etag: 'v1',
    }]), morning)
    store.updateLocalEvent(account.id, 'e1', { title: 'Local title' })
    await store.sync(account.id, new FixtureCalendarAdapter('google', [{
      id: 'e1',
      title: 'Remote title',
      startAt: morning,
      endAt: morning + 1000,
      etag: 'v2',
    }]), morning + 1)
    expect(store.conflicts().some((conflict) => conflict.kind === 'update' && conflict.eventId === 'e1')).toBe(true)
    expect(store.events()[0]?.title).toBe('Local title')
  })

  it('does not apply a delayed fetch after revoke', async () => {
    const store = new CalendarStore()
    const account = store.connect('google', 'Work', 'UTC')
    store.markConnected(account.id)
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const delayed = {
      provider: 'google' as const,
      capabilities: CALENDAR_CAPABILITIES.google,
      available: () => true,
      async listEvents(accountId: string) {
        await gate
        return new FixtureCalendarAdapter('google', [{
          id: 'late',
          title: 'Should not land',
          startAt: morning,
          endAt: morning + 1000,
        }]).listEvents(accountId)
      },
    }
    const pending = store.sync(account.id, delayed, morning)
    store.revoke(account.id)
    release()
    await pending
    expect(store.events()).toHaveLength(0)
  })
})
