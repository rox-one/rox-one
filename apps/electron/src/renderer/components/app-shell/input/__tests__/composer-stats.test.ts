import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { computeComposerStats, formatCompactTokens } from '../composer-stats'

const msgs = (...roles: string[]) => roles.map(role => ({ role }))

describe('computeComposerStats', () => {
  it('counts user turns and tool steps only', () => {
    const s = computeComposerStats({ messages: msgs('user', 'assistant', 'tool', 'tool', 'user', 'tool', 'error') })
    expect(s.turns).toBe(2)
    expect(s.steps).toBe(3)
  })

  it('derives tokens, cache hit and context from real usage', () => {
    const s = computeComposerStats({
      messages: msgs('user'),
      tokenUsage: { inputTokens: 24_000, sessionTokens: 3_200_000, cacheReadTokens: 23_280, contextWindow: 200_000 },
    })
    expect(s.sessionTokens).toBe(3_200_000)
    expect(s.cacheHitPercent).toBe(97)
    expect(s.contextPercent).toBe(12)
  })

  it('omits metrics that have no source instead of faking zeros', () => {
    const s = computeComposerStats({ messages: msgs('user'), tokenUsage: { inputTokens: 0, sessionTokens: 0 } })
    expect(s.sessionTokens).toBeNull()
    expect(s.cacheHitPercent).toBeNull()
    expect(s.contextPercent).toBeNull()
    const noUsage = computeComposerStats({ messages: msgs('user'), tokenUsage: null })
    expect(noUsage.cacheHitPercent).toBeNull()
  })

  it('omits cache hit when the provider did not report cache reads', () => {
    const s = computeComposerStats({ messages: msgs('user'), tokenUsage: { inputTokens: 1000, sessionTokens: 1200 } })
    expect(s.cacheHitPercent).toBeNull()
  })

  it('falls back to the model catalog window and clamps to 100', () => {
    expect(computeComposerStats({ messages: [], tokenUsage: { inputTokens: 50_000 }, fallbackContextWindow: 100_000 }).contextPercent).toBe(50)
    expect(computeComposerStats({ messages: [], tokenUsage: { inputTokens: 500_000, contextWindow: 200_000 } }).contextPercent).toBe(100)
    expect(computeComposerStats({ messages: [], tokenUsage: { inputTokens: 500 } }).contextPercent).toBeNull()
  })
})

describe('session tokens', () => {
  it('hides the total for sessions without complete per-request data', () => {
    const s = computeComposerStats({ messages: msgs('user'), tokenUsage: { inputTokens: 10, sessionTokens: 999, sessionTokensIncomplete: true } })
    expect(s.sessionTokens).toBeNull()
    expect(computeComposerStats({ messages: msgs('user'), tokenUsage: { inputTokens: 10 } }).sessionTokens).toBeNull()
  })
})

describe('stats line i18n', () => {
  const locales = join(__dirname, '..', '..', '..', '..', '..', '..', '..', '..', 'packages', 'shared', 'src', 'i18n', 'locales')
  it('uses plural forms and translated strings in every locale', () => {
    const en = JSON.parse(readFileSync(join(locales, 'en.json'), 'utf8'))
    const ru = JSON.parse(readFileSync(join(locales, 'ru.json'), 'utf8'))
    expect(en['chat.stats.turns_one']).toBe('{{count}} turn')
    expect(en['chat.stats.turns_other']).toBe('{{count}} turns')
    expect([ru['chat.stats.steps_one'], ru['chat.stats.steps_few'], ru['chat.stats.steps_many']]).toEqual(['{{count}} шаг', '{{count}} шага', '{{count}} шагов'])
    for (const loc of ['de', 'fr', 'es', 'pl', 'hu', 'ja', 'ko', 'zh-Hans', 'zh-Hant', 'ar']) {
      const d = JSON.parse(readFileSync(join(locales, `${loc}.json`), 'utf8'))
      expect(d['chat.stats.sessionTokens'], loc).not.toBe(en['chat.stats.sessionTokens'])
      expect(d['chat.stats.contextAria'], loc).toContain('{{percent}}')
    }
  })
  it('the context ring has an accessible label', () => {
    const line = readFileSync(join(__dirname, '..', 'ComposerStatsLine.tsx'), 'utf8')
    expect(line).toContain("aria-label={t('chat.stats.contextAria'")
  })
})

describe('formatCompactTokens', () => {
  it('formats compactly', () => {
    expect(formatCompactTokens(319)).toBe('319')
    expect(formatCompactTokens(3_200)).toBe('3.2K')
    expect(formatCompactTokens(3_200_000)).toBe('3.2M')
    expect(formatCompactTokens(12_000)).toBe('12K')
    expect(formatCompactTokens(999_960)).toBe('1M')
    expect(formatCompactTokens(-1)).toBe('0')
  })
})

describe('composer stats wiring', () => {
  const dir = join(__dirname, '..')
  it('renders under the composer only outside compact mode', () => {
    const zone = readFileSync(join(dir, 'ChatInputZone.tsx'), 'utf8')
    expect(zone).toContain('{!compactMode && stats && <ComposerStatsLine stats={stats} />}')
  })
  it('ChatDisplay feeds session messages and tokenUsage', () => {
    const display = readFileSync(join(dir, '..', 'ChatDisplay.tsx'), 'utf8')
    expect(display).toContain('computeComposerStats({')
    expect(display).toContain('tokenUsage: session.tokenUsage')
    expect(display).toContain('stats={composerStats}')
  })
})
