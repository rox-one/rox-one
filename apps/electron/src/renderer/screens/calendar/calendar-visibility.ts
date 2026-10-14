/**
 * Per-calendar visibility (Календарь «Мои календари» toggles) and the
 * meeting → calendar account join. Pure helpers + one persisted atom.
 */
import { atomWithStorage } from 'jotai/utils'

/** Calendar accounts the user hid from the Календарь/Встречи views. */
export const calendarHiddenAccountsAtom = atomWithStorage<string[]>('rox.calendar.hidden.v1', [], undefined, { getOnInit: true })

export function toggleHidden(hidden: readonly string[], accountId: string): string[] {
  return hidden.includes(accountId) ? hidden.filter((id) => id !== accountId) : [...hidden, accountId]
}

/**
 * Account a recording came from. `calendarEventId` is either the provider
 * occurrence id or `calendarEventIdentity` = JSON `[accountId, calendarId, id]`.
 * Ad-hoc recordings (no event) belong to no calendar → always visible.
 */
export function meetingAccountId(calendarEventId: string | undefined, occurrenceAccount: ReadonlyMap<string, string>): string | null {
  if (!calendarEventId) return null
  if (calendarEventId.startsWith('[')) {
    try {
      const parsed = JSON.parse(calendarEventId) as unknown
      if (Array.isArray(parsed) && typeof parsed[0] === 'string') return parsed[0]
    } catch { /* fall through */ }
  }
  return occurrenceAccount.get(calendarEventId) ?? null
}

export function isMeetingShown(calendarEventId: string | undefined, hidden: ReadonlySet<string>, occurrenceAccount: ReadonlyMap<string, string>): boolean {
  if (hidden.size === 0) return true
  const account = meetingAccountId(calendarEventId, occurrenceAccount)
  return account == null || !hidden.has(account)
}

/** Local start of day (ms). */
export function startOfDay(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** 6×7 month grid (weeks start Monday) for the month containing `monthTs`. */
export function monthGrid(monthTs: number): number[] {
  const d = new Date(monthTs)
  d.setDate(1)
  d.setHours(0, 0, 0, 0)
  const offset = (d.getDay() + 6) % 7
  d.setDate(1 - offset)
  const out: number[] = []
  for (let i = 0; i < 42; i++) {
    out.push(d.getTime())
    d.setDate(d.getDate() + 1)
  }
  return out
}
