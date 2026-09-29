/**
 * Schedule builder model ⇄ 5-field cron.
 *
 * The editor shows a friendly builder (каждый день / по будням / по дням недели
 * / каждый месяц / каждый час / каждые N минут) and only falls back to a raw
 * cron field for expressions the builder can't represent.
 */

export type ScheduleKind = 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'hourly' | 'minutes' | 'custom'

export interface ScheduleModel {
  kind: ScheduleKind
  /** HH:MM (24h) for daily/weekdays/weekly/monthly */
  time: string
  /** cron day-of-week numbers (0 = Sunday … 6 = Saturday) for weekly */
  days: number[]
  /** 1–31 for monthly */
  dayOfMonth: number
  /** 0–59 for hourly */
  minute: number
  /** step for "every N minutes" */
  every: number
  /** raw expression for custom */
  cron: string
}

export const DEFAULT_SCHEDULE: ScheduleModel = {
  kind: 'daily',
  time: '09:00',
  days: [1],
  dayOfMonth: 1,
  minute: 0,
  every: 15,
  cron: '0 9 * * *',
}

const INT = /^\d+$/

function hhmm(hour: string, minute: string): string {
  return `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`
}

export function parseSchedule(cron: string | undefined): ScheduleModel {
  const raw = (cron ?? '').trim()
  const base: ScheduleModel = { ...DEFAULT_SCHEDULE, cron: raw || DEFAULT_SCHEDULE.cron }
  const parts = raw.split(/\s+/)
  if (parts.length !== 5) return raw ? { ...base, kind: 'custom' } : base
  const [minute, hour, dom, month, dow] = parts as [string, string, string, string, string]

  if (/^\*\/\d+$/.test(minute) && hour === '*' && dom === '*' && month === '*' && dow === '*') {
    return { ...base, kind: 'minutes', every: Number(minute.slice(2)) }
  }
  if (INT.test(minute) && hour === '*' && dom === '*' && month === '*' && dow === '*') {
    return { ...base, kind: 'hourly', minute: Number(minute) }
  }
  if (INT.test(minute) && INT.test(hour) && month === '*') {
    const time = hhmm(hour, minute)
    if (dom === '*' && dow === '*') return { ...base, kind: 'daily', time }
    if (dom === '*' && dow === '1-5') return { ...base, kind: 'weekdays', time }
    if (dom === '*' && /^[0-7](,[0-7])*$/.test(dow)) {
      const days = [...new Set(dow.split(',').map((d) => Number(d) % 7))].sort((a, b) => a - b)
      return { ...base, kind: 'weekly', time, days }
    }
    if (INT.test(dom) && dow === '*') return { ...base, kind: 'monthly', time, dayOfMonth: Number(dom) }
  }
  return { ...base, kind: 'custom' }
}

function splitTime(time: string): [number, number] {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time)
  if (!m) return [9, 0]
  return [Math.min(23, Number(m[1])), Math.min(59, Number(m[2]))]
}

export function buildCron(model: ScheduleModel): string {
  const [h, m] = splitTime(model.time)
  switch (model.kind) {
    case 'daily': return `${m} ${h} * * *`
    case 'weekdays': return `${m} ${h} * * 1-5`
    case 'weekly': {
      const days = model.days.length ? [...new Set(model.days)].sort((a, b) => a - b) : [1]
      return `${m} ${h} * * ${days.join(',')}`
    }
    case 'monthly': return `${m} ${h} ${Math.max(1, Math.min(31, model.dayOfMonth || 1))} * *`
    case 'hourly': return `${Math.max(0, Math.min(59, model.minute || 0))} * * * *`
    case 'minutes': return `*/${Math.max(1, Math.min(59, model.every || 15))} * * * *`
    case 'custom': return model.cron.trim()
  }
}

/** Minimal structural check (croner does the real parse for next-run preview). */
export function isPlausibleCron(cron: string): boolean {
  const parts = cron.trim().split(/\s+/)
  return parts.length === 5 && parts.every((p) => /^[\d*,\-/]+$/.test(p))
}
