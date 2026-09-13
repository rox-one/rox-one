import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const cron = readFileSync(join(import.meta.dir, '../CronBuilder.tsx'), 'utf8')
const info = readFileSync(join(import.meta.dir, '../AutomationInfoPage.tsx'), 'utf8')
const list = readFileSync(join(import.meta.dir, '../AutomationsListPanel.tsx'), 'utf8')
const timeline = readFileSync(join(import.meta.dir, '../AutomationEventTimeline.tsx'), 'utf8')

describe('automation chrome leftover English', () => {
  it('routes CronBuilder headings and presets through t()', () => {
    expect(cron).toContain("t('automations.cronCommonSchedules')")
    expect(cron).toContain("t('automations.cronCustomSchedule')")
    expect(cron).toContain("t('automations.cronAdvanced')")
    expect(cron).toContain('PRESET_KEYS')
    expect(cron).not.toContain('Common Schedules')
    expect(cron).not.toContain('Every minute')
  })

  it('does not hardcode en-US for automation next-run dates', () => {
    expect(info).toContain('i18n.language')
    expect(info).not.toContain("toLocaleDateString('en-US'")
    expect(info).toContain('describeCron(automation.cron, t)')
  })

  it('passes t into compact relative-time helpers', () => {
    expect(list).toContain('formatShortRelativeTime(automation.lastExecutedAt, t)')
    expect(timeline).toContain('formatShortRelativeTime(entry.timestamp, t)')
  })
})
