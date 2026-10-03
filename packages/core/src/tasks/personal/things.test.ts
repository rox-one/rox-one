import { describe, expect, it, spyOn } from 'bun:test'
import { startOfLocalDay } from './dates.ts'
import { nextRepeatDate, parseDateExpression, parseTaskEntry } from './quick-entry.ts'
import { matchesProjection, projectProgress, upcomingByDay } from './projections.ts'
import { PersonalTaskStore } from './store.ts'

// Tuesday 2026-09-29 10:00 local
const now = new Date(2026, 8, 29, 10, 0, 0).getTime()
const today = startOfLocalDay(now)
const day = (n: number) => new Date(2026, 8, 29 + n).getTime()

describe('quick entry (RU/EN natural language)', () => {
  it('parses завтра / послезавтра / через неделю', () => {
    expect(parseTaskEntry('Купить молоко завтра', now)).toMatchObject({ title: 'Купить молоко', when: 'date', startAt: day(1) })
    expect(parseTaskEntry('Позвонить послезавтра', now).startAt).toBe(day(2))
    expect(parseTaskEntry('Отчёт через неделю', now)).toMatchObject({ title: 'Отчёт', startAt: day(7) })
    expect(parseTaskEntry('Отчёт через 3 дня', now).startAt).toBe(day(3))
  })

  it('parses weekdays: в пт / во вторник / fri', () => {
    expect(parseTaskEntry('Созвон в пт', now)).toMatchObject({ title: 'Созвон', startAt: day(3) })
    expect(parseTaskEntry('Созвон во вторник', now).startAt).toBe(day(7))
    expect(parseTaskEntry('Call fri', now).startAt).toBe(day(3))
  })

  it('parses сегодня, вечером, когда-нибудь, в любое время', () => {
    expect(parseTaskEntry('Спортзал сегодня', now)).toMatchObject({ title: 'Спортзал', when: 'today', startAt: today })
    expect(parseTaskEntry('Кино вечером', now)).toMatchObject({ title: 'Кино', when: 'evening', evening: true })
    expect(parseTaskEntry('Выучить японский когда-нибудь', now)).toMatchObject({ title: 'Выучить японский', when: 'someday' })
    expect(parseTaskEntry('Почитать в любое время', now)).toMatchObject({ title: 'Почитать', when: 'anytime' })
    expect(parseTaskEntry('Ужин завтра вечером', now)).toMatchObject({ title: 'Ужин', startAt: day(1), evening: true })
  })

  it('parses tags, deadlines and reminder times', () => {
    const parsed = parseTaskEntry('Сдать отчёт #работа #q4 до 15 окт в 10:30', now)
    expect(parsed.title).toBe('Сдать отчёт')
    expect(parsed.tags).toEqual(['работа', 'q4'])
    expect(parsed.deadlineAt).toBe(new Date(2026, 9, 15).getTime())
    expect(new Date(parsed.reminderAt!).getHours()).toBe(10)
    expect(new Date(parsed.reminderAt!).getMinutes()).toBe(30)
  })

  it('parses repeat rules', () => {
    expect(parseTaskEntry('Планёрка каждый пн', now).recurrence).toEqual({ rule: 'weekly', interval: 1, weekdays: [1] })
    expect(parseTaskEntry('Витамины ежедневно', now).recurrence).toEqual({ rule: 'daily', interval: 1 })
    expect(parseTaskEntry('Счета каждый месяц', now).recurrence).toEqual({ rule: 'monthly', interval: 1 })
  })

  it('leaves plain titles untouched', () => {
    expect(parseTaskEntry('Проверить сборку', now)).toMatchObject({ title: 'Проверить сборку', tags: [] })
    expect(parseTaskEntry('Проверить сборку', now).when).toBeUndefined()
  })

  it('parses numeric dates', () => {
    expect(parseDateExpression('15.10', now)).toBe(new Date(2026, 9, 15).getTime())
    expect(parseDateExpression('2026-12-01', now)).toBe(new Date(2026, 11, 1).getTime())
    expect(parseDateExpression('1 января', now)).toBe(new Date(2027, 0, 1).getTime())
  })

  it('refuses impossible ISO calendar dates instead of silently changing the requested day', () => {
    for (const input of ['2026-02-31', '2026-13-01', '2026-02-00', '2026-04-31', '2026-02-29']) {
      expect(parseDateExpression(input, now)).toBeNull()
    }
  })

  it('retains the exact valid local day including leap days', () => {
    for (const [input, year, month, date] of [['2028-02-29', 2028, 1, 29], ['2026-12-31', 2026, 11, 31]] as const) {
      const at = parseDateExpression(input, now)
      expect(at).toBe(new Date(year, month, date).getTime())
      expect(new Date(at!).getHours()).toBe(0)
      expect(new Date(at!).getDate()).toBe(date)
    }
  })
})

describe('repeat rules', () => {
  it('computes the next fixed / after-completion date', () => {
    expect(nextRepeatDate({ rule: 'daily', interval: 1 }, today, now)).toBe(day(1))
    expect(nextRepeatDate({ rule: 'weekly', interval: 1, weekdays: [1, 4] }, today, now)).toBe(day(2))
    expect(nextRepeatDate({ rule: 'monthly', interval: 1 }, day(-40), now)).toBeGreaterThan(today)
    expect(nextRepeatDate({ rule: 'daily', interval: 3, mode: 'after' }, day(-10), now)).toBe(day(3))
    expect(nextRepeatDate({ rule: 'daily', interval: 1, until: today }, today, now)).toBeNull()
  })
  it('keeps the scheduled wall clock when a zoned weekly recurrence crosses DST', () => {
    const anchor = Date.UTC(2026, 2, 1, 14, 30)
    const completed = Date.UTC(2026, 2, 1, 15)
    const next = nextRepeatDate({ rule: 'weekly', interval: 1, timeZone: 'America/New_York' }, anchor, completed)
    expect(next).toBe(Date.UTC(2026, 2, 8, 13, 30))
  })

  it('returns the same persisted successor when completion is retried', () => {
    const store = new PersonalTaskStore()
    const task = store.create({ title: 'Recurring', list: 'today', recurrence: { rule: 'daily', interval: 1 }, now })
    const first = store.completeTask(task.id, now)
    const retry = store.completeTask(task.id, now + 10_000)
    expect(retry.next?.id).toBe(first.next?.id)
    expect(store.list().filter((item) => item.repeatOf === task.id)).toHaveLength(1)
  })


  it('completeTask spawns the next occurrence with a fresh checklist', () => {
    const store = new PersonalTaskStore()
    const task = store.create({ title: 'Отчёт', list: 'today', recurrence: { rule: 'weekly', interval: 1 }, now })
    store.addChecklistItem(task.id, 'Собрать цифры')
    store.updateChecklistItem(task.id, store.get(task.id)!.checklist![0]!.id, { done: true })
    const { next } = store.completeTask(task.id, now)
    expect(next).not.toBeNull()
    expect(next!.startAt).toBe(day(7))
    expect(next!.checklist![0]!.done).toBe(false)
    expect(next!.repeatOf).toBe(task.id)
    expect(store.get(task.id)!.completedAt).toBe(now)
  })
})

describe('Things lists', () => {
  it('trash / restore / emptyTrash', () => {
    const store = new PersonalTaskStore()
    const a = store.create({ title: 'A', list: 'anytime', now })
    store.trash(a.id, now)
    expect(matchesProjection(store.get(a.id)!, now, 'anytime')).toBe(false)
    expect(matchesProjection(store.get(a.id)!, now, 'trash')).toBe(true)
    store.restore(a.id)
    expect(matchesProjection(store.get(a.id)!, now, 'anytime')).toBe(true)
    store.trash(a.id, now)
    expect(store.emptyTrash()).toEqual([a.id])
    expect(store.list()).toHaveLength(0)
  })

  it('start dates: future → Планы, reached → Сегодня; deadline today pulls into Сегодня', () => {
    const store = new PersonalTaskStore()
    const later = store.create({ title: 'Later', now })
    store.setWhen(later.id, { kind: 'date', at: day(2) }, now)
    const t = store.get(later.id)!
    expect(matchesProjection(t, now, 'upcoming')).toBe(true)
    expect(matchesProjection(t, now, 'today')).toBe(false)
    expect(matchesProjection(t, day(2) + 3600000, 'today')).toBe(true)
    const dl = store.create({ title: 'Deadline', list: 'anytime', now })
    store.setDeadline(dl.id, now)
    expect(matchesProjection(store.get(dl.id)!, now, 'today')).toBe(true)
  })

  it('upcomingByDay keeps 7 calendar days and groups later by month', () => {
    const store = new PersonalTaskStore()
    const a = store.create({ title: 'A', now })
    store.setWhen(a.id, { kind: 'date', at: day(1) }, now)
    const b = store.create({ title: 'B', now })
    store.setWhen(b.id, { kind: 'date', at: day(40) }, now)
    const plan = upcomingByDay(store.list(), now, 7)
    expect(plan.days).toHaveLength(7)
    expect(plan.days[0]!.tasks.map((x) => x.title)).toEqual(['A'])
    expect(plan.later[0]!.tasks.map((x) => x.title)).toEqual(['B'])
  })

  it('setWhen classifies calendar dates against the supplied clock', () => {
    const wallClock = spyOn(Date, 'now').mockReturnValue(day(40))
    try {
      const store = new PersonalTaskStore()
      const a = store.create({ title: 'Today', now })
      const b = store.create({ title: 'Tomorrow', now })
      store.setWhen(a.id, { kind: 'date', at: now, evening: true }, now)
      store.setWhen(b.id, { kind: 'date', at: day(1) }, now)
      expect(store.get(a.id)).toMatchObject({ list: 'today', startAt: undefined, evening: true })
      expect(store.get(b.id)).toMatchObject({ list: 'upcoming', startAt: day(1), evening: false })
      expect(upcomingByDay(store.list(), now, 7).days[0]!.tasks.map((task) => task.title)).toEqual(['Tomorrow'])
    } finally {
      wallClock.mockRestore()
    }
  })

  it('setWhen preserves the wall clock default for existing callers', () => {
    const wallClock = spyOn(Date, 'now').mockReturnValue(now)
    try {
      const store = new PersonalTaskStore()
      const task = store.create({ title: 'Today', now })
      store.setWhen(task.id, { kind: 'date', at: now })
      expect(store.get(task.id)).toMatchObject({ list: 'today', startAt: undefined, evening: false })
    } finally {
      wallClock.mockRestore()
    }
  })

  it('projects with headings, move and progress', () => {
    const store = new PersonalTaskStore()
    const area = store.addArea('Работа')
    const project = store.addProject('Rox', area.id)
    const heading = store.addHeading('Этап 1', project.id)
    const t1 = store.create({ title: 'One', now })
    const t2 = store.create({ title: 'Two', now })
    store.moveTo(t1.id, { projectId: project.id, headingId: heading.id })
    store.moveTo(t2.id, { projectId: project.id })
    expect(store.get(t1.id)!.list).toBe('anytime')
    expect(store.get(t1.id)!.headingId).toBe(heading.id)
    store.completeTask(t1.id, now)
    expect(projectProgress(store.list(), project.id)).toEqual({ done: 1, total: 2, open: 1 })
    store.removeHeading(heading.id)
    expect(store.get(t1.id)!.headingId).toBeUndefined()
    expect(new Set([area.id, project.id, heading.id]).size).toBe(3)
  })

  it('create keeps a source link and inserts after an anchor', () => {
    const store = new PersonalTaskStore()
    const a = store.create({ title: 'A', list: 'inbox', now })
    const b = store.create({ title: 'B', list: 'inbox', now })
    const c = store.create({ title: 'C', list: 'inbox', afterId: a.id, source: { kind: 'meeting', id: 'm1', label: 'Планёрка' }, now })
    const order = store.list().sort((x, y) => x.order - y.order).map((x) => x.title)
    expect(order).toEqual(['A', 'C', 'B'])
    expect(store.get(c.id)!.links).toEqual([{ kind: 'meeting', id: 'm1', label: 'Планёрка' }])
    expect(b.id).not.toBe(c.id)
  })
})
