/**
 * Meeting follow-up schedules on the existing SchedulerTick path (I018).
 * Cron config is not a running process — AutomationSystem + the durable
 * executor in server-core actually tick. The workflow simulator is not
 * the production executor.
 */

import { Cron } from 'croner'
import type { AutomationMatcher, MeetingFollowupAction, MeetingFollowupKind } from './types.ts'

export type MeetingFollowupScheduleSpec = {
  id: string
  timezone: string
  cron?: string
  kind: MeetingFollowupKind
  optOut?: boolean
}

export function meetingFollowupOccurrenceKey(scheduleId: string, instant: number, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(instant))
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  const day = parts.find((part) => part.type === 'day')?.value
  return `${scheduleId}:${year}-${month}-${day}`
}

/**
 * Same minute-window rule as matchesCron, with an injectable instant so DST
 * and missed-run tests can use a fake clock.
 */
export function cronMatchesAt(cronExpr: string, instant: number, timezone?: string): boolean {
  try {
    const job = new Cron(cronExpr, timezone ? { timezone } : {})
    const now = new Date(instant)
    const startOfMinute = new Date(now)
    startOfMinute.setUTCSeconds(0, 0)
    const checkFrom = new Date(startOfMinute.getTime() - 1000)
    const nextRun = job.nextRun(checkFrom)
    if (!nextRun) return false
    return nextRun.getTime() >= startOfMinute.getTime()
      && nextRun.getTime() < startOfMinute.getTime() + 60_000
  } catch {
    return false
  }
}

export function compileMeetingFollowupMatcher(schedule: MeetingFollowupScheduleSpec): AutomationMatcher {
  const action: MeetingFollowupAction = {
    type: 'meeting.followup',
    scheduleId: schedule.id,
    kind: schedule.kind,
  }
  return {
    id: `mtgfu-${schedule.id}`.slice(0, 32),
    name: `Meeting follow-up (${schedule.kind})`,
    cron: schedule.cron ?? '0 9 * * 1-5',
    timezone: schedule.timezone,
    enabled: schedule.optOut !== true,
    permissionMode: 'ask',
    actions: [action],
  }
}
