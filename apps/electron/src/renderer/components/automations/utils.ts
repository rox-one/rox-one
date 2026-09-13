/**
 * Shared automation utilities.
 *
 * Cron helpers used by CronBuilder (visual editor) and AutomationInfoPage (info display).
 * Time formatting shared by AutomationsListPanel and AutomationEventTimeline.
 */

import { Cron } from 'croner'

export type TranslateFn = (key: string, options?: Record<string, unknown>) => string

/**
 * Format a timestamp as a compact relative time string (e.g. "3m", "2h", "5d").
 * Used by both AutomationsListPanel (trailing timestamp) and AutomationEventTimeline.
 */
export function formatShortRelativeTime(timestamp: number, t: TranslateFn): string {
  const diff = Date.now() - timestamp
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (seconds < 60) return t('common.justNow')
  if (minutes < 60) return t('common.minutesAgoShort', { count: minutes })
  if (hours < 24) return t('common.hoursAgoShort', { count: hours })
  return t('common.daysAgoShort', { count: days })
}

/**
 * Describe a cron expression in human-readable form.
 */
export function describeCron(cron: string, t: TranslateFn): string {
  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5) return t('automations.cronInvalid')

  const [minute, hour, dom, month, dow] = parts

  if (cron.trim() === '* * * * *') return t('automations.cronEveryMinute')
  if (minute.startsWith('*/')) return t('automations.cronEveryNMinutes', { count: minute.slice(2) })
  if (hour === '*' && minute !== '*') {
    return t('automations.cronEveryHourAt', { minute: minute.padStart(2, '0') })
  }
  if (dom === '*' && month === '*') {
    const time = `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`
    if (dow === '*') return t('automations.cronDailyAt', { time })
    if (dow === '1-5') return t('automations.cronWeekdaysAt', { time })
    if (dow === '0,6') return t('automations.cronWeekendsAt', { time })
    return t('automations.cronAtWeekday', { time, dow })
  }
  if (month === '*' && dow === '*') {
    const time = `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`
    return t('automations.cronMonthlyOn', { day: dom, time })
  }
  return cron
}

/**
 * Compute the next N run times for a cron expression using croner.
 */
export function computeNextRuns(cron: string, count: number = 3): Date[] {
  try {
    const job = new Cron(cron)
    return job.nextRuns(count)
  } catch {
    return []
  }
}
