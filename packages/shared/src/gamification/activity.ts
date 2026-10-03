import type { XpEventType } from './levels.ts'

const DAY_MS = 24 * 60 * 60 * 1000
export interface XpDay { day: number; xp: number }

/** Small durable daily totals retain activity after the recent-event list rolls over. */
export function recordXpDay(days: readonly XpDay[] | undefined, xp: number, now: number): XpDay[] {
  const today = Math.floor(now / DAY_MS)
  const byDay = new Map((days ?? []).filter(item => Number.isSafeInteger(item.day) && Number.isSafeInteger(item.xp) && item.xp >= 0 && item.day >= today - 89 && item.day <= today).map(item => [item.day, item.xp]))
  byDay.set(today, (byDay.get(today) ?? 0) + xp)
  return [...byDay].sort(([a], [b]) => b - a).map(([day, value]) => ({ day, xp: value }))
}

export function getWeeklyXp(
  state: { dailyXp?: readonly XpDay[]; recentEvents?: readonly { type: XpEventType; xp: number; at: number }[] },
  now: number = Date.now(),
): { current: number; previous: number } {
  const today = Math.floor(now / DAY_MS)
  const totals = { current: 0, previous: 0 }
  const days = state.dailyXp ?? (state.recentEvents ?? []).map(event => ({ day: Math.floor(event.at / DAY_MS), xp: event.xp }))
  for (const item of days) {
    if (!Number.isSafeInteger(item.day) || item.day > today || item.day < today - 13 || !Number.isFinite(item.xp) || item.xp < 0) continue
    totals[item.day >= today - 6 ? 'current' : 'previous'] += item.xp
  }
  return totals
}

export function seedXpDays(state: { dailyXp?: readonly XpDay[]; recentEvents?: readonly { xp: number; at: number }[] }, now: number): XpDay[] {
  if (state.dailyXp) return [...state.dailyXp]
  let days: XpDay[] = []
  for (const event of [...(state.recentEvents ?? [])].sort((a, b) => a.at - b.at)) {
    if (Number.isFinite(event.at) && Number.isSafeInteger(event.xp) && event.at <= now && event.at >= now - 89 * DAY_MS && event.xp >= 0) {
      days = recordXpDay(days, event.xp, event.at)
    }
  }
  return recordXpDay(days, 0, now)
}
