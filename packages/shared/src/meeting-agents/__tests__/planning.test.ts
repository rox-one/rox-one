import { describe, expect, it } from 'bun:test'
import { bindRecipeJobs, invokeMeetingSlash, planMeetingActions, type FollowupPlanningInput } from '../planning.ts'
import { MEETING_PROFILE_IDS } from '../recipes.ts'
const now = Date.UTC(2026, 9, 3, 9, 0)
const schedule: FollowupPlanningInput = { id: 'schedule-a', kind: 'prepare', timezone: 'UTC', cron: '0 9 * * *',
  expiresAt: now + 10000, budgetRemaining: 3, missedRunPolicy: 'catch-up-once', maxRetries: 3, scope: 'device' }
function followup(patch: Partial<FollowupPlanningInput> = {}) {
  return planMeetingActions({ meetingId: 'm-a', followup: { ...schedule, ...patch } }, 4, now).followup!
}
describe('retained Meeting profile/slash plans', () => {
  it('binds every profile to current packaged roles and its actual playbook/schema', () => {
    for (const recipeId of MEETING_PROFILE_IDS) {
      const plan = planMeetingActions({ meetingId: 'm-a', recipeId }, 4, now)
      expect(plan.jobs.length).toBeGreaterThan(0)
      expect(plan.outputSchemaId).toBe(`meeting.${recipeId}.v1`)
      expect(plan.jobs.every(job => job.outputSchemaId === plan.outputSchemaId && job.playbook === plan.playbook)).toBe(true)
      expect(plan.jobs.every(job => job.status === 'planned' && job.skillIds.length > 0)).toBe(true)
      expect(plan.execution).toEqual({ allowed: false, verified: false, reason: 'meeting-backend-delegation-unavailable' })
    }
  })
  it('routes explicit profile and permitted packaged skill slash commands', () => {
    expect(invokeMeetingSlash('/design-review inspect', 'standup')).toBe('design-review')
    expect(invokeMeetingSlash('/meeting-scribe', 'standup')).toBe('standup')
    expect(invokeMeetingSlash('/meeting.standup', 'standup')).toBe('standup')
    expect(() => invokeMeetingSlash('/meeting-assist', 'standup')).toThrow('skill-not-permitted')
    expect(() => invokeMeetingSlash('/unknown-tool', 'standup')).toThrow('unknown-skill')
    expect(() => invokeMeetingSlash('ordinary chat', 'standup')).toThrow('not-slash')
  })
  it('rejects disabled/foreign overrides and additional privileges', () => {
    expect(() => bindRecipeJobs('standup', { recipeId: 'standup', disabled: true })).toThrow('recipe-disabled')
    expect(() => bindRecipeJobs('standup', { recipeId: 'client' })).toThrow('override-recipe-mismatch')
    expect(() => bindRecipeJobs('standup', { recipeId: 'standup', extraActions: ['crm.update'] })).toThrow('clone-privilege-escalation')
    expect(() => bindRecipeJobs('standup', { recipeId: 'standup', skillId: 'shell' })).toThrow('skill-not-permitted')
  })
})
describe('read-only followup scheduling policies', () => {
  it('projects cron/occurrence but always refuses production execution', () => {
    const plan = followup()
    expect(plan.due).toBe(true)
    expect(plan.matcher.enabled).toBe(false)
    expect(plan.occurrenceKey).toBe('schedule-a:2026-10-03')
    expect(plan.matcher.actions).toEqual([{ type: 'meeting.followup', scheduleId: 'schedule-a', kind: 'prepare' }])
    expect(plan.execution).toEqual({ allowed: false, verified: false, reason: 'followup-principal-executor-unavailable' })
  })
  it('preserves cancellation, missed-run, retry, budget, device and send boundaries', () => {
    for (const [input, reason] of [
      [{ optOut: true }, 'opt-out'], [{ calendarCanceled: true }, 'calendar-canceled'],
      [{ expiresAt: now }, 'expired'], [{ budgetRemaining: 0 }, 'budget-exhausted'],
      [{ retryCount: 3 }, 'max-retries'], [{ missed: true, missedRunPolicy: 'skip' }, 'missed-skip'],
      [{ missed: true, missedRunPolicy: 'hold' }, 'missed-hold'], [{ deviceAvailable: false }, 'waiting_device'],
      [{ kind: 'send' }, 'send-requires-fresh-grant'], [{ cron: '0 10 * * *' }, 'not-due'],
    ] as Array<[Partial<FollowupPlanningInput>, string]>) {
      expect(followup(input).policy).toBe(reason)
      expect(followup(input).execution.allowed).toBe(false)
    }
    expect(followup({ kind: 'finalize', calendarCanceled: true }).policy).toBe('planned')
    expect(followup({ scope: 'server', deviceAvailable: false }).policy).toBe('planned')
  })
  it('refuses invalid policy values and impossible timezone', () => {
    expect(() => followup({ timezone: 'unknown-zone' })).toThrow('invalid-timezone')
    expect(() => followup({ cron: 'impossible schedule' })).toThrow('invalid-cron')
    expect(() => followup({ maxRetries: Infinity })).toThrow('invalid-followup')
    expect(() => followup({ id: '../unsafe' })).toThrow('invalid-followup')
    expect(() => followup({ budgetRemaining: -1 })).toThrow('invalid-followup')
  })
})
