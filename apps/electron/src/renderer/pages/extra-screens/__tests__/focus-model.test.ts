import { describe, expect, test } from 'bun:test'
import type { PersonalTask } from '@craft-agent/core/tasks/personal'
import {
  SUMMARY_END,
  SUMMARY_START,
  buildDaySummary,
  calendarEventsToday,
  completedToday,
  mergeDay,
  rankTopTasks,
  upsertSummarySection,
} from '../focus/focus-model'
import {
  deferNotification,
  emptyFocusState,
  focusMinutesOn,
  isFocusRunning,
  localDay,
  normalizeFocusState,
  settleFocus,
  startFocus,
  stopFocus,
} from '@/lib/focus-session'
import { shouldAutoWriteSummary } from '../background'

const now = new Date(2026, 8, 29, 14, 0).getTime()
const MIN = 60000

function task(id: string, patch: Partial<PersonalTask> = {}): PersonalTask {
  return { id, title: id, notes: '', list: 'anytime', tags: [], priority: 'none', evening: false, links: [], order: 0, createdAt: 1, ...patch }
}

describe('focus session', () => {
  test('start / running / stop records history', () => {
    let s = startFocus(emptyFocusState(), 25, now)
    expect(isFocusRunning(s, now + 10 * MIN)).toBe(true)
    expect(isFocusRunning(s, now + 26 * MIN)).toBe(false)
    s = stopFocus(s, now + 10 * MIN)
    expect(s.active).toBeNull()
    expect(s.history).toEqual([{ date: localDay(now), startedAt: now, endedAt: now + 10 * MIN, minutes: 10 }])
  })

  test('settle moves an expired session into history at its planned end', () => {
    const s = settleFocus(startFocus(emptyFocusState(), 25, now), now + 60 * MIN)
    expect(s.active).toBeNull()
    expect(s.history[0].minutes).toBe(25)
    const running = startFocus(emptyFocusState(), 25, now)
    expect(settleFocus(running, now + MIN)).toBe(running)
  })

  test('deferred notifications are deduped per session', () => {
    let s = emptyFocusState()
    s = deferNotification(s, { sessionId: 'a', workspaceId: 'w', title: 'A', at: 1 })
    s = deferNotification(s, { sessionId: 'a', workspaceId: 'w', title: 'A2', at: 2 })
    s = deferNotification(s, { sessionId: 'b', workspaceId: 'w', title: 'B', at: 3 })
    expect(s.queue.map((q) => [q.sessionId, q.title, q.count])).toEqual([['a', 'A2', 2], ['b', 'B', 1]])
  })

  test('minutes today include the running session; normalize is defensive', () => {
    const s = startFocus({ ...emptyFocusState(), history: [{ date: localDay(now), startedAt: now - 3 * 3600e3, endedAt: now - 2 * 3600e3, minutes: 60 }] }, 50, now)
    expect(focusMinutesOn(s, localDay(now), now + 20 * MIN)).toEqual({ sessions: 2, minutes: 80 })
    expect(normalizeFocusState({ active: { startedAt: 'x' }, top3: ['a', 'b', 'c', 'd'], summaryHour: 99 })).toMatchObject({ active: null, top3: ['a', 'b', 'c'], summaryHour: 19 })
    expect(normalizeFocusState({ summaryHour: null }).summaryHour).toBeNull()
  })

  test('auto summary: once per day after the hour, never when manual', () => {
    const evening = new Date(2026, 8, 29, 20).getTime()
    expect(shouldAutoWriteSummary({ summaryHour: 19 }, now)).toBe(false)
    expect(shouldAutoWriteSummary({ summaryHour: 19 }, evening)).toBe(true)
    expect(shouldAutoWriteSummary({ summaryHour: 19, summaryWrittenFor: localDay(evening) }, evening)).toBe(false)
    expect(shouldAutoWriteSummary({ summaryHour: null }, evening)).toBe(false)
  })
})

describe('focus model', () => {
  test('calendar events today from the persisted bundle', () => {
    const bundle = { accounts: [{ id: 'acc' }], events: [
      { id: '1', accountId: 'acc', title: 'Стендап', startAt: now - 3 * 3600e3, endAt: now - 2.5 * 3600e3 },
      { id: '2', accountId: 'acc', title: 'Завтра', startAt: now + 24 * 3600e3 },
      { id: '3', accountId: 'acc', title: 'Удалено', startAt: now, deleted: true },
    ] }
    const cal = calendarEventsToday(bundle, now)
    expect(cal.connected).toBe(true)
    expect(cal.events.map((e) => e.title)).toEqual(['Стендап'])
    expect(calendarEventsToday(null, now)).toEqual({ connected: false, events: [] })
    const merged = mergeDay(cal.events, [{ id: 'm', title: 'Встреча', startAt: now - 4 * 3600e3, kind: 'meeting' }])
    expect(merged.map((e) => e.title)).toEqual(['Встреча', 'Стендап'])
  })

  test('top 3: pinned first, then today/overdue + priority; closed tasks skipped', () => {
    const tasks = [
      task('low', { priority: 'low' }),
      task('high', { priority: 'high' }),
      task('today', { list: 'today' }),
      task('done', { list: 'today', completedAt: now }),
      task('pin'),
    ]
    expect(rankTopTasks(tasks, ['pin'], now).map((t) => t.id)).toEqual(['pin', 'today', 'high'])
    expect(rankTopTasks(tasks, ['gone'], now).map((t) => t.id)).toEqual(['today', 'high', 'low'])
    expect(completedToday(tasks, now).map((t) => t.id)).toEqual(['done'])
  })

  test('summary section is upserted between markers and keeps the note', () => {
    const summary = buildDaySummary({ now, focus: { sessions: 2, minutes: 95 }, done: ['A'], meetings: ['M'], deferred: 3, inboxLeft: 4, language: 'ru' })
    expect(summary).toContain('## Итоги дня')
    expect(summary).toContain('Фокус: 2 · 1 ч 35 мин')
    expect(summary).toContain('  - [x] A')
    expect(summary).toContain('Осталось во Входящих: 4')
    const first = upsertSummarySection('# 29.09\nмои мысли\n', summary)
    expect(first.startsWith('# 29.09\nмои мысли\n\n' + SUMMARY_START)).toBe(true)
    const second = upsertSummarySection(first + '\nпосле', 'NEW')
    expect(second).toContain(`${SUMMARY_START}\nNEW\n${SUMMARY_END}`)
    expect(second).toContain('мои мысли')
    expect(second).toContain('после')
    expect(second.split(SUMMARY_START).length - 1).toBe(1)
    expect(upsertSummarySection('', 'X')).toBe(`${SUMMARY_START}\nX\n${SUMMARY_END}\n`)
  })
})
