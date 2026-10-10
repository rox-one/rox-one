import { afterEach, describe, expect, it } from 'bun:test'
import {
  APPLE_CALENDAR_LIVE_ENV,
  AppleCalendarAdapter,
  AppleCalendarAuthDeniedError,
  AppleCalendarHelperError,
  AppleCalendarUnavailableError,
  registerAppleCalendarHelper,
  type AppleCalendarHelperBinding,
  type AppleCalendarHelperResult,
} from '../apple-calendar-adapter.ts'
import { createProductionAdapter, isCalendarConnectorWired, UnavailableCalendarAdapter } from '../adapters.ts'

const RANGE = { start: Date.parse('2026-09-01T00:00:00.000Z'), end: Date.parse('2026-09-30T00:00:00.000Z') }

function result(stdout: unknown, exitCode = 0): AppleCalendarHelperResult {
  return { exitCode, stdout: JSON.stringify(stdout), stderr: '' }
}

type RunnerHandler = (args: readonly string[]) => AppleCalendarHelperResult

function fakeRunner(handlers: Record<string, RunnerHandler>) {
  const calls: string[][] = []
  return {
    calls,
    run: async (args: readonly string[]): Promise<AppleCalendarHelperResult> => {
      calls.push([...args])
      const handler = handlers[args[0] ?? '']
      if (!handler) throw new Error(`unexpected helper command: ${args[0] ?? ''}`)
      return handler(args)
    },
  }
}

function binding(present = true): AppleCalendarHelperBinding {
  return { hasHelper: () => present, run: async () => result([]) }
}

const HELPER_EVENTS = [
  {
    id: 'timed-1',
    title: 'Standup',
    startAt: '2026-09-02T09:00:00Z',
    endAt: '2026-09-02T09:30:00Z',
    allDay: false,
    calendarId: 'cal-home',
    notes: 'agenda',
    location: 'Room 1',
    hasRecurrence: false,
  },
  {
    id: 'allday-1',
    title: 'Holiday',
    startAt: '2026-09-03T00:00:00Z',
    endAt: '2026-09-04T00:00:00Z',
    allDay: true,
    calendarId: 'cal-home',
  },
  {
    id: 'series_20260904',
    title: 'Weekly sync',
    startAt: '2026-09-04T09:00:00Z',
    endAt: '2026-09-04T10:00:00Z',
    calendarId: 'cal-work',
    hasRecurrence: true,
    occurrenceOf: 'series',
  },
]

const originalGate = process.env[APPLE_CALENDAR_LIVE_ENV]

afterEach(() => {
  if (originalGate === undefined) delete process.env[APPLE_CALENDAR_LIVE_ENV]
  else process.env[APPLE_CALENDAR_LIVE_ENV] = originalGate
  registerAppleCalendarHelper(null)
})

describe('AppleCalendarAdapter', () => {
  it('maps helper events to CalendarEvent and passes the window and calendar', async () => {
    const runner = fakeRunner({
      'auth-status': () => result({ status: 'authorized' }),
      'list-events': () => result(HELPER_EVENTS),
    })
    const adapter = new AppleCalendarAdapter({
      runHelper: runner.run,
      calendarId: 'cal-work',
      range: RANGE,
      timeZone: 'Europe/Moscow',
    })

    expect(adapter.mode).toBe('live')
    expect(adapter.provider).toBe('appleCalendar')
    expect(adapter.available()).toBe(true)

    const page = await adapter.listEvents('acct-1')
    expect(runner.calls[0]).toEqual(['auth-status'])
    expect(runner.calls[1]).toEqual([
      'list-events',
      '--start',
      new Date(RANGE.start).toISOString(),
      '--end',
      new Date(RANGE.end).toISOString(),
      '--calendar',
      'cal-work',
    ])

    expect(page.events).toHaveLength(3)
    expect(page.events[0]).toMatchObject({
      id: 'timed-1',
      accountId: 'acct-1',
      calendarId: 'cal-home',
      title: 'Standup',
      allDay: false,
      timeZone: 'Europe/Moscow',
      deleted: false,
      kind: 'event',
    })
    expect(page.events[0]!.startAt).toBe(Date.parse('2026-09-02T09:00:00Z'))
    expect(page.events[0]!.endAt).toBe(Date.parse('2026-09-02T09:30:00Z'))
    expect(page.events[0]!.occurrenceId).toBeUndefined()
    expect(page.events[0]!.recurrence).toBeUndefined()

    const allDay = page.events[1]!
    expect(allDay.allDay).toBe(true)
    expect(allDay.startAt).toBe(Date.parse('2026-09-03T00:00:00Z'))

    const series = page.events[2]!
    expect(series.recurrence).toBe('recurring')
    expect(series.occurrenceId).toBe('series_20260904')
    expect(page.cursor).toBeUndefined()
  })

  it('omits --calendar when no calendar id is configured', async () => {
    const runner = fakeRunner({
      'auth-status': () => result({ status: 'limited' }),
      'list-events': () => result([]),
    })
    const adapter = new AppleCalendarAdapter({ runHelper: runner.run, range: RANGE })

    await adapter.listEvents('acct-1')
    expect(runner.calls[1]).toEqual([
      'list-events',
      '--start',
      new Date(RANGE.start).toISOString(),
      '--end',
      new Date(RANGE.end).toISOString(),
    ])
  })

  it('accepts a string window verbatim', async () => {
    const runner = fakeRunner({
      'auth-status': () => result({ status: 'authorized' }),
      'list-events': () => result([]),
    })
    const adapter = new AppleCalendarAdapter({
      runHelper: runner.run,
      range: { start: '2026-09-01T00:00:00Z', end: '2026-09-30T00:00:00Z' },
    })

    await adapter.listEvents('acct-1')
    expect(runner.calls[1]!.slice(0, 5)).toEqual([
      'list-events',
      '--start',
      '2026-09-01T00:00:00Z',
      '--end',
      '2026-09-30T00:00:00Z',
    ])
  })

  it('uses the rolling default window around now()', async () => {
    const now = Date.parse('2026-09-15T12:00:00Z')
    const runner = fakeRunner({
      'auth-status': () => result({ status: 'authorized' }),
      'list-events': () => result([]),
    })
    const adapter = new AppleCalendarAdapter({ runHelper: runner.run, now: () => now })

    await adapter.listEvents('acct-1')
    expect(runner.calls[1]![2]).toBe(new Date(now - 30 * 86_400_000).toISOString())
    expect(runner.calls[1]![4]).toBe(new Date(now + 90 * 86_400_000).toISOString())
  })

  it('throws a typed auth error when auth-status is denied and never lists', async () => {
    const runner = fakeRunner({ 'auth-status': () => result({ status: 'denied' }) })
    const adapter = new AppleCalendarAdapter({ runHelper: runner.run, range: RANGE })

    await expect(adapter.listEvents('acct-1')).rejects.toBeInstanceOf(AppleCalendarAuthDeniedError)
    await expect(adapter.listEvents('acct-1')).rejects.toMatchObject({
      code: 'APPLE_CALENDAR_AUTH_DENIED',
      status: 'denied',
    })
    expect(runner.calls.every((args) => args[0] === 'auth-status')).toBe(true)
  })

  it('treats notDetermined and restricted as typed auth failures', async () => {
    for (const status of ['notDetermined', 'restricted'] as const) {
      const runner = fakeRunner({ 'auth-status': () => result({ status }) })
      const adapter = new AppleCalendarAdapter({ runHelper: runner.run, range: RANGE })
      await expect(adapter.listEvents('acct-1')).rejects.toMatchObject({ status })
    }
  })

  it('maps a helper auth-denied error payload on list-events to the typed auth error', async () => {
    const runner = fakeRunner({
      'auth-status': () => result({ status: 'authorized' }),
      'list-events': () => result({ error: 'auth-denied' }, 1),
    })
    const adapter = new AppleCalendarAdapter({ runHelper: runner.run, range: RANGE })

    await expect(adapter.listEvents('acct-1')).rejects.toBeInstanceOf(AppleCalendarAuthDeniedError)
  })

  it('surfaces non-auth helper failures with the exit code', async () => {
    const runner = fakeRunner({
      'auth-status': () => result({ status: 'authorized' }),
      'list-events': () => result({ error: 'encode-failed' }, 2),
    })
    const adapter = new AppleCalendarAdapter({ runHelper: runner.run, range: RANGE })

    await expect(adapter.listEvents('acct-1')).rejects.toMatchObject({
      code: 'APPLE_CALENDAR_HELPER',
      exitCode: 2,
    })
    await expect(adapter.listEvents('acct-1')).rejects.toBeInstanceOf(AppleCalendarHelperError)
  })

  it('throws unavailable without a helper and never spawns it', async () => {
    const runner = fakeRunner({})
    const adapter = new AppleCalendarAdapter({ runHelper: runner.run, helperPresent: () => false, range: RANGE })

    expect(adapter.available()).toBe(false)
    await expect(adapter.listEvents('acct-1')).rejects.toBeInstanceOf(AppleCalendarUnavailableError)
    expect(runner.calls).toHaveLength(0)
  })

  it('authStatus() reports the EventKit state without listing events', async () => {
    const runner = fakeRunner({ 'auth-status': () => result({ status: 'denied' }) })
    const adapter = new AppleCalendarAdapter({ runHelper: runner.run, range: RANGE })

    expect(await adapter.authStatus()).toBe('denied')
    expect(runner.calls).toEqual([['auth-status']])
  })

  it('authStatus() throws a helper error for an unknown status payload', async () => {
    const runner = fakeRunner({ 'auth-status': () => result({ status: 'something-else' }) })
    const adapter = new AppleCalendarAdapter({ runHelper: runner.run, range: RANGE })

    await expect(adapter.authStatus()).rejects.toBeInstanceOf(AppleCalendarHelperError)
  })

  it('requestAccess() surfaces the granted flag and resulting status', async () => {
    const granted = fakeRunner({ 'request-access': () => result({ status: 'authorized', granted: true }) })
    const allowed = new AppleCalendarAdapter({ runHelper: granted.run, range: RANGE })
    expect(await allowed.requestAccess()).toEqual({ status: 'authorized', granted: true })

    const refused = fakeRunner({ 'request-access': () => result({ status: 'denied', granted: false }) })
    const denied = new AppleCalendarAdapter({ runHelper: refused.run, range: RANGE })
    expect(await denied.requestAccess()).toEqual({ status: 'denied', granted: false })
  })

  it('maps a spawn failure to a typed helper error', async () => {
    const adapter = new AppleCalendarAdapter({
      runHelper: async () => { throw new Error('ENOENT') },
      range: RANGE,
    })

    await expect(adapter.authStatus()).rejects.toMatchObject({ code: 'APPLE_CALENDAR_HELPER' })
  })
})

describe('apple calendar production gate', () => {
  it('stays unavailable without the env gate even when a helper is registered', () => {
    registerAppleCalendarHelper(binding())
    delete process.env[APPLE_CALENDAR_LIVE_ENV]

    const adapter = createProductionAdapter('appleCalendar')
    expect(adapter).toBeInstanceOf(UnavailableCalendarAdapter)
    expect(adapter.available()).toBe(false)
    expect(isCalendarConnectorWired('appleCalendar')).toBe(false)
  })

  it('stays unavailable with the gate but no registered helper', () => {
    process.env[APPLE_CALENDAR_LIVE_ENV] = '1'
    registerAppleCalendarHelper(null)

    expect(createProductionAdapter('appleCalendar')).toBeInstanceOf(UnavailableCalendarAdapter)
    expect(isCalendarConnectorWired('appleCalendar')).toBe(false)
  })

  it('stays unavailable with the gate when the helper binary is absent', () => {
    process.env[APPLE_CALENDAR_LIVE_ENV] = '1'
    registerAppleCalendarHelper(binding(false))

    expect(createProductionAdapter('appleCalendar')).toBeInstanceOf(UnavailableCalendarAdapter)
    expect(isCalendarConnectorWired('appleCalendar')).toBe(false)
  })

  it('returns the live adapter only with the gate and a present helper', () => {
    process.env[APPLE_CALENDAR_LIVE_ENV] = '1'
    registerAppleCalendarHelper(binding())

    const adapter = createProductionAdapter('appleCalendar')
    expect(adapter).toBeInstanceOf(AppleCalendarAdapter)
    expect(adapter.mode).toBe('live')
    expect(adapter.available()).toBe(true)
    expect(isCalendarConnectorWired('appleCalendar')).toBe(true)
  })

  it('never returns a live appleCalendar adapter for other providers', () => {
    process.env[APPLE_CALENDAR_LIVE_ENV] = '1'
    registerAppleCalendarHelper(binding())

    for (const provider of ['google', 'outlook', 'yandex', 'mailru', 'appleReminders'] as const) {
      expect(createProductionAdapter(provider)).toBeInstanceOf(UnavailableCalendarAdapter)
    }
  })
})