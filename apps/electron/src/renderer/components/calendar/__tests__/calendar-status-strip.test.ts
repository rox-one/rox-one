import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const strip = readFileSync(join(__dirname, '../CalendarStatusStrip.tsx'), 'utf8')
const chips = readFileSync(join(__dirname, '../CalendarConnectorChips.tsx'), 'utf8')
const page = readFileSync(join(__dirname, '../../../pages/TasksPage.tsx'), 'utf8')

describe('Issue 18 calendar strip', () => {
  it('exposes connector states and never stores secrets', () => {
    expect(strip).toContain("t(`calendar.status.${status}`)")
    expect(strip).toContain('calendar.revoke')
    expect(strip).toContain('acceptProposal')
    expect(strip).toContain('proposeReminder')
    expect(strip).toContain('addLocalReminder')
    expect(strip.toLowerCase()).not.toContain('client_secret')
    expect(strip.toLowerCase()).not.toContain('refresh_token')
    expect(strip).not.toMatch(/<select\b/)
  })

  it('merges events onto Today/Upcoming without converting them into tasks', () => {
    expect(strip).toContain('mergeTodayUpcoming')
    expect(page).toContain('CalendarStatusStrip')
    expect(page).toContain("filter === 'today' || filter === 'upcoming'")
  })

  it('disables unwired optional connectors with a tooltip', () => {
    expect(chips).toContain('isCalendarConnectorWired')
    expect(chips).toContain('calendar.connectorUnavailable')
    expect(chips).toContain('disabled={!wired}')
    expect(chips).toContain('appleReminders')
    expect(chips).toContain('mailru')
    expect(chips).toContain('yandex')
    expect(chips).toContain('outlook')
    expect(chips).toContain('google')
    expect(chips).not.toContain('ROX_APPLE_REMINDERS_HELPER')
    expect(chips).not.toContain('appleRemindersAvailable')
  })
})
