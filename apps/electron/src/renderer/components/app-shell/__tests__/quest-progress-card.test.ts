import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('quest progress card', () => {
  it('is not mounted on Home (no promo carousel) and never blocks core chrome', () => {
    const shell = readFileSync(join(import.meta.dir, '../AppShell.tsx'), 'utf8')
    const home = readFileSync(join(import.meta.dir, '../../../platform/HomeFrontPage.tsx'), 'utf8')
    const card = readFileSync(join(import.meta.dir, '../QuestProgressCard.tsx'), 'utf8')
    expect(home).not.toContain('QuestProgressCard')
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

  it('rates sessions with 👍/👎 from the session menu, not a composer scale', () => {
    const zone = readFileSync(join(import.meta.dir, '../input/ChatInputZone.tsx'), 'utf8')
    const menu = readFileSync(join(import.meta.dir, '../SessionMenu.tsx'), 'utf8')
    expect(zone).not.toContain('SessionRatingPill')
    expect(menu).toContain('rateGamificationSession')
    expect(menu).toContain('quests.rateSession')
  })
})
