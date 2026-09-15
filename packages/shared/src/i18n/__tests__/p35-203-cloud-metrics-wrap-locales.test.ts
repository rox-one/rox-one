import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'settings.knowledge.metrics.automationRuns' as const
const EN = 'Automation cloud runs'
const RU = 'Облачные запуски автоматизации'

const en = JSON.parse(readFileSync(join(import.meta.dir, '../locales/en.json'), 'utf8')) as Record<string, string>
const ru = JSON.parse(readFileSync(join(import.meta.dir, '../locales/ru.json'), 'utf8')) as Record<string, string>

describe('leftover English Cloud wrapping in ru knowledge metrics', () => {
  it('keeps English catalog copy unchanged', () => {
    expect(en[KEY]).toBe(EN)
    expect(en[KEY]).toContain('cloud runs')
  })

  it('wraps leftover Cloud as Russian common noun', () => {
    expect(ru[KEY]).toBe(RU)
    expect(ru[KEY]).not.toMatch(/\bCloud\b/)
    expect(ru[KEY]).not.toBe(en[KEY])
  })

  it("resolves Russian through setupI18n without leftover English Cloud", async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.t(KEY)).toBe(RU)
    expect(i18n.t(KEY)).not.toBe(EN)
    expect(i18n.t(KEY)).not.toMatch(/\bCloud\b/)
  })

  it('resolves English through setupI18n as the original leftover string', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN)
    expect(i18n.t(KEY)).toContain('cloud runs')
  })
})
