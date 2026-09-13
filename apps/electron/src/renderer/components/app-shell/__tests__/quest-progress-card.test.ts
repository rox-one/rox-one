import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('quest progress card', () => {
  it('is mounted on Home and never blocks core chrome', () => {
    const shell = readFileSync(join(import.meta.dir, '../AppShell.tsx'), 'utf8')
    const home = readFileSync(join(import.meta.dir, '../../../platform/HomeFrontPage.tsx'), 'utf8')
    const card = readFileSync(join(import.meta.dir, '../QuestProgressCard.tsx'), 'utf8')
    expect(home).toContain('QuestProgressCard')
    expect(shell).not.toContain('QuestProgressCard')
    expect(card).toContain('quests.dismiss')
    expect(card).toContain('quests.snooze')
    expect(card).toContain('quests.next')
    expect(card).toContain('quests.empty')
    expect(card).toContain('quests.emptyHint')
    expect(card).toContain('quest-progress-card-empty')
    expect(card).not.toContain('if (quests.length === 0) return null')
    expect(card).not.toContain('rateGamificationSession')
    expect(card).not.toContain('[1, 2, 3, 4, 5]')
  })

  it('mounts session rating pills on the composer, not the quest slider', () => {
    const zone = readFileSync(join(import.meta.dir, '../input/ChatInputZone.tsx'), 'utf8')
    const pill = readFileSync(join(import.meta.dir, '../SessionRatingPill.tsx'), 'utf8')
    expect(zone).toContain('SessionRatingPill')
    expect(pill).toContain('SESSION_RATING_PILLS')
    expect(pill).toContain('session-composer')
  })
})
