import { describe, expect, it } from 'bun:test'
import { describeCron, formatShortRelativeTime } from '../utils'

const en: Record<string, string> = {
  'automations.cronEveryMinute': 'Every minute',
  'automations.cronDailyAt': 'Daily at {{time}}',
  'automations.cronWeekdaysAt': 'Weekdays at {{time}}',
  'automations.cronInvalid': 'Invalid schedule',
  'common.justNow': 'Just now',
  'common.minutesAgoShort': '{{count}}m ago',
}

const ru: Record<string, string> = {
  'automations.cronEveryMinute': 'Каждую минуту',
  'automations.cronDailyAt': 'Ежедневно в {{time}}',
  'automations.cronWeekdaysAt': 'Будни в {{time}}',
  'automations.cronInvalid': 'Неверное расписание',
  'common.justNow': 'Только что',
  'common.minutesAgoShort': '{{count}} мин назад',
}

function tFrom(locale: Record<string, string>) {
  return (key: string, options?: Record<string, unknown>) => {
    const template = locale[key] ?? key
    if (!options) return template
    return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options[name] ?? ''))
  }
}

describe('automation cron and relative-time i18n', () => {
  it('describes common crons in Russian', () => {
    const t = tFrom(ru)
    expect(describeCron('* * * * *', t)).toBe('Каждую минуту')
    expect(describeCron('0 9 * * 1-5', t)).toBe('Будни в 09:00')
    expect(describeCron('bogus', t)).toBe('Неверное расписание')
  })

  it('keeps English descriptions distinct from Russian', () => {
    expect(describeCron('0 9 * * *', tFrom(en))).toBe('Daily at 09:00')
    expect(describeCron('0 9 * * *', tFrom(ru))).not.toBe(describeCron('0 9 * * *', tFrom(en)))
  })

  it('formats compact relative times through t()', () => {
    const now = Date.now()
    expect(formatShortRelativeTime(now - 5_000, tFrom(ru))).toBe('Только что')
    expect(formatShortRelativeTime(now - 3 * 60_000, tFrom(ru))).toBe('3 мин назад')
    expect(formatShortRelativeTime(now - 3 * 60_000, tFrom(en))).toBe('3m ago')
  })
})
