import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('quest progress card', () => {
  it('is mounted in the sidebar and never blocks core chrome', () => {
    const shell = readFileSync(join(import.meta.dir, '../AppShell.tsx'), 'utf8')
    const card = readFileSync(join(import.meta.dir, '../QuestProgressCard.tsx'), 'utf8')
    expect(shell).toContain('QuestProgressCard')
    expect(card).toContain('quests.dismiss')
    expect(card).toContain('quests.snooze')
    expect(card).toContain('rateGamificationSession')
  })
})
