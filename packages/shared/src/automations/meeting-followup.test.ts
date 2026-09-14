import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ActionDefinitionSchema } from './schemas.ts'
import { validateAutomationsConfig } from './validation.ts'
import { compileMeetingFollowupMatcher, cronMatchesAt, meetingFollowupOccurrenceKey } from './meeting-followup.ts'

describe('meeting follow-up automations (I018)', () => {
  test('DST occurrence keys stay on the same local calendar day', () => {
    const before = meetingFollowupOccurrenceKey('sched-1', Date.UTC(2026, 2, 8, 6, 0), 'America/New_York')
    const after = meetingFollowupOccurrenceKey('sched-1', Date.UTC(2026, 2, 8, 7, 0), 'America/New_York')
    expect(before).toBe(after)
    expect(before).toBe('sched-1:2026-03-08')
  })

  test('accepts meeting.followup actions and does not treat a prompt as the executor', () => {
    expect(ActionDefinitionSchema.safeParse({
      type: 'meeting.followup',
      scheduleId: 'sched-1',
      kind: 'prepare',
    }).success).toBe(true)
    const compiled = compileMeetingFollowupMatcher({
      id: 'sched-1',
      timezone: 'Europe/Moscow',
      kind: 'prepare',
      cron: '0 9 * * 1-5',
    })
    expect(compiled.actions[0]?.type).toBe('meeting.followup')
    const validated = validateAutomationsConfig({
      automations: {
        SchedulerTick: [compiled],
      },
    })
    expect(validated.valid).toBe(true)
    const source = readFileSync(join(import.meta.dir, 'meeting-followup.ts'), 'utf8')
    expect(source).not.toMatch(/from ['"][^'"]*workflows\/run/)
  })

  test('cronMatchesAt uses the injected instant instead of Date.now', () => {
    const instant = Date.UTC(2026, 5, 1, 6, 0)
    expect(cronMatchesAt('0 9 * * 1', instant, 'Europe/Moscow')).toBe(true)
  })
})
