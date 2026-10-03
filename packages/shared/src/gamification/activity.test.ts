import { describe, expect, it } from 'bun:test'
import { getWeeklyXp, recordXpDay, seedXpDays } from './activity'
import { awardXp, loadGamificationState } from './storage'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const day = 86400000

describe('real XP activity comparison', () => {
  it('compares 7 UTC days with the previous 7 without future awards or invented peers', () => {
    expect(getWeeklyXp({ dailyXp: [{ day: 30, xp: 25 }, { day: 24, xp: 15 }, { day: 23, xp: 10 }, { day: 17, xp: 20 }, { day: 16, xp: 100 }, { day: 31, xp: 999 }] }, 30 * day)).toEqual({ current: 40, previous: 30 })
  })
  it('migrates recorded events and retains both periods regardless of input order', () => {
    const current = { recentEvents: [{ xp: 25, at: 30 * day }, { xp: 15, at: 20 * day }] }
    expect(seedXpDays(current, 30 * day)).toEqual([{ day: 30, xp: 25 }, { day: 20, xp: 15 }])
    expect(recordXpDay([{ day: 0, xp: 999 }], 10, 100 * day)).toEqual([{ day: 100, xp: 10 }])
  })
  it('preserves earned daily XP after the recent event buffer rolls over and after reload', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rox-weekly-xp-'))
    try {
      for (let i = 0; i < 60; i++) awardXp('session_completed', dir)
      const state = loadGamificationState(dir)
      expect(state.recentEvents).toHaveLength(50)
      expect(getWeeklyXp(state)).toEqual({ current: 1500, previous: 0 })
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
