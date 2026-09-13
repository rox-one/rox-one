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
