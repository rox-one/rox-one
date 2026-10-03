import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyQuestAction, loadGamificationState, saveSessionRating, setAnalyticsConsent } from './storage.ts'
import { planProductAnalytics, visibleQuests } from './quests.ts'

describe('onboarding quests', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })
  function tmp() {
    const dir = mkdtempSync(join(tmpdir(), 'rox-quest-'))
    dirs.push(dir)
    return dir
  }

  it('completes the link quest locally and dismisses it from the board', () => {
    const dir = tmp()
    const before = loadGamificationState(dir)
    expect(visibleQuests(before.quests).some((quest) => quest.id === 'first_link')).toBe(true)
    const { state, analytics } = applyQuestAction('complete', 'first_link', {}, dir)
    expect(state.quests.first_link.status).toBe('completed')
    expect(state.xp).toBeGreaterThan(before.xp)
    expect(visibleQuests(state.quests).some((quest) => quest.id === 'first_link')).toBe(false)
    expect(analytics.sent).toBe(false)
    expect(analytics.localOnly).toBe(true)
  })

  it('does not send a cloud analytics event without consent', () => {
    expect(planProductAnalytics('quest.complete.first_link', false)).toEqual({
      event: 'quest.complete.first_link',
      sent: false,
      localOnly: true,
    })
    expect(planProductAnalytics('quest.complete.first_link', true)).toEqual({
      event: 'quest.complete.first_link',
      sent: true,
      localOnly: false,
    })
  })

  it('never punishes disabled cloud features', () => {
    const dir = tmp()
    const before = loadGamificationState(dir)
    const { state } = applyQuestAction('complete', 'first_browser', { cloudFeaturesEnabled: false }, dir)
    expect(state.xp).toBe(before.xp)
    expect(state.quests.first_browser.status).toBe('skipped_cloud')
  })

  it('stores session ratings locally and keeps consent off by default', () => {
    const dir = tmp()
    const rated = saveSessionRating({
      sessionId: 'sess-1',
      score: 5,
      feedback: 'clear',
      provenance: 'user',
    }, dir)
    expect(rated.state.ratings[0]?.score).toBe(5)
    expect(rated.analytics.sent).toBe(false)
    const hundred = saveSessionRating({
      sessionId: 'sess-1',
      score: 100,
      provenance: 'session-composer',
    }, dir)
    expect(hundred.state.ratings[0]?.score).toBe(100)
    const consented = setAnalyticsConsent(true, dir)
    expect(consented.analyticsConsent).toBe(true)
  })
})

describe('quest award replay and persistence', () => {
  it('never reopens a completed quest or awards completion twice after reload', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rox-quest-replay-'))
    try {
      const completed = applyQuestAction('complete', 'first_task', {}, dir)
      expect(completed.state.xp).toBe(15)
      applyQuestAction('snooze', 'first_task', {}, dir)
      applyQuestAction('dismiss', 'first_task', {}, dir)
      expect(applyQuestAction('complete', 'first_task', {}, dir).state.xp).toBe(15)
      expect(loadGamificationState(dir).quests.first_task.status).toBe('completed')
      expect(loadGamificationState(dir).recentEvents).toHaveLength(1)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('keeps dismiss terminal and snooze hidden until its durable deadline', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rox-quest-status-'))
    try {
      const now = Date.now()
      const snoozed = applyQuestAction('snooze', 'first_note', { now }, dir)
      expect(visibleQuests(snoozed.state.quests, now).some(quest => quest.id === 'first_note')).toBe(false)
      expect(visibleQuests(loadGamificationState(dir).quests, now + 72 * 3600000).some(quest => quest.id === 'first_note')).toBe(true)
      applyQuestAction('dismiss', 'first_link', {}, dir)
      expect(applyQuestAction('complete', 'first_link', {}, dir).state.xp).toBe(0)
      expect(loadGamificationState(dir).quests.first_link.status).toBe('dismissed')
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
