import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { isLiveVerified } from '../../types.ts'
import {
  applyCalendarWrite,
  bindCall,
  fakeDialerEnabled,
  occurrenceKey,
  type CalendarOccurrence,
} from '../calendar-calls.ts'

const occ = (overrides: Partial<CalendarOccurrence> = {}): CalendarOccurrence => ({
  accountId: 'acct-1',
  calendarId: 'cal-1',
  eventId: 'evt-1',
  occurrenceId: 'occ-1',
  timeZone: 'UTC',
  ...overrides,
})

describe('calendar-calls (#382) fail-closed', () => {
  it('namespaces identical remoteIds by account', () => {
    const a = occ({ accountId: 'acct-1' })
    const b = occ({ accountId: 'acct-2' })
    expect(occurrenceKey(a)).not.toBe(occurrenceKey(b))
  })

  it('blocks live Conation calendar writes and has no fake dialer', () => {
    expect(applyCalendarWrite(occ({ exception: true })).status).toBe('blocked')
    expect(applyCalendarWrite(occ({ canceled: true })).status).toBe('blocked')
    expect(applyCalendarWrite(occ({ dateOnly: true, timeZone: 'Europe/Moscow' })).status).toBe('blocked')
    expect(fakeDialerEnabled()).toBe(false)
    expect(bindCall('mtg-1', 'call-1', new Map()).status).toBe('blocked')
  })

  it('does not stamp verified / live:true / L4 on calendar or call stubs', () => {
    const src = readFileSync(new URL('../calendar-calls.ts', import.meta.url), 'utf8')
    expect(src).not.toMatch(/status:\s*'verified'/)
    expect(src).not.toMatch(/live:\s*true/)
    expect(src).not.toMatch(/evidenceLevel:\s*'L4'/)

    const canceled = applyCalendarWrite(occ({ canceled: true }))
    expect(canceled.status).not.toBe('verified')
    expect(canceled.live).toBe(false)
    expect(canceled.evidenceLevel).not.toBe('L4')
    expect(isLiveVerified(canceled)).toBe(false)

    const bound = bindCall('mtg-1', 'call-1', new Map())
    expect(bound.status).not.toBe('verified')
    expect(bound.live).toBe(false)
    expect(bound.evidenceLevel).not.toBe('L4')
    expect(isLiveVerified(bound)).toBe(false)
    expect(bound.status).toBe('blocked')
  })
})
