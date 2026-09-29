import { describe, expect, it } from 'bun:test'
import { buildCron, isPlausibleCron, parseSchedule } from '../schedule-model'

describe('schedule model', () => {
  it('round-trips the builder shapes', () => {
    for (const cron of ['0 9 * * *', '30 10 * * 1-5', '0 17 * * 5', '0 9 * * 1,3,5', '15 8 1 * *', '30 * * * *', '*/15 * * * *']) {
      const model = parseSchedule(cron)
      expect(model.kind).not.toBe('custom')
      expect(buildCron(model)).toBe(cron)
    }
  })

  it('falls back to custom for expressions the builder cannot show', () => {
    const model = parseSchedule('0 9-17/2 * * 1-5')
    expect(model.kind).toBe('custom')
    expect(buildCron(model)).toBe('0 9-17/2 * * 1-5')
  })

  it('maps kinds to cron', () => {
    expect(buildCron({ ...parseSchedule('0 9 * * *'), kind: 'weekdays', time: '07:05' })).toBe('5 7 * * 1-5')
    expect(buildCron({ ...parseSchedule('0 9 * * *'), kind: 'weekly', days: [] })).toBe('0 9 * * 1')
    expect(isPlausibleCron('0 9 * * *')).toBe(true)
    expect(isPlausibleCron('every day')).toBe(false)
  })
})
