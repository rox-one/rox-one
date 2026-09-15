import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { i18n, setupI18n } from '../setupI18n'

const HINT_KEY = 'hints.reviewGitHubPRs' as const
const SKILL_KEY = 'editPopover.example.addSkill' as const

const HINT_EN = 'Review {source:GitHub} PRs, then summarize changes in {source:Craft}'
const HINT_RU = 'Проверь запросы на слияние в {source:GitHub} и опиши изменения в {source:Craft}'
const SKILL_EN = 'Review PRs following our code standards'
const SKILL_RU = 'Проверять запросы на слияние по нашим стандартам кода'

const en = JSON.parse(readFileSync(join(import.meta.dir, '../locales/en.json'), 'utf8')) as Record<string, string>
const ru = JSON.parse(readFileSync(join(import.meta.dir, '../locales/ru.json'), 'utf8')) as Record<string, string>

describe('leftover English PR wrapping in ru GitHub hint and add-skill copy', () => {
  it('keeps English catalog copy unchanged', () => {
    expect(en[HINT_KEY]).toBe(HINT_EN)
    expect(en[SKILL_KEY]).toBe(SKILL_EN)
    expect(en[HINT_KEY]).toContain('PRs')
    expect(en[SKILL_KEY]).toContain('PRs')
    expect(en[HINT_KEY]).toContain('{source:GitHub}')
    expect(en[HINT_KEY]).toContain('{source:Craft}')
  })

  it('wraps leftover PR as Russian around Latin GitHub/Craft identifiers', () => {
    expect(ru[HINT_KEY]).toBe(HINT_RU)
    expect(ru[SKILL_KEY]).toBe(SKILL_RU)
    expect(ru[HINT_KEY]).not.toMatch(/\bPR\b/)
    expect(ru[SKILL_KEY]).not.toMatch(/\bPR\b/)
    expect(ru[HINT_KEY]).toContain('запросы на слияние')
    expect(ru[SKILL_KEY]).toContain('запросы на слияние')
    expect(ru[HINT_KEY]).toContain('{source:GitHub}')
    expect(ru[HINT_KEY]).toContain('{source:Craft}')
    expect(ru[HINT_KEY]).not.toBe(en[HINT_KEY])
    expect(ru[SKILL_KEY]).not.toBe(en[SKILL_KEY])
  })

  it('resolves Russian through setupI18n without leftover English PR', async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.t(HINT_KEY)).toBe(HINT_RU)
    expect(i18n.t(SKILL_KEY)).toBe(SKILL_RU)
    expect(i18n.t(HINT_KEY)).not.toBe(HINT_EN)
    expect(i18n.t(SKILL_KEY)).not.toBe(SKILL_EN)
    expect(i18n.t(HINT_KEY)).not.toMatch(/\bPR\b/)
    expect(i18n.t(SKILL_KEY)).not.toMatch(/\bPR\b/)
    expect(i18n.t(HINT_KEY)).toContain('GitHub')
    expect(i18n.t(HINT_KEY)).toContain('Craft')
  })

  it('resolves English through setupI18n as the original leftover string', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(HINT_KEY)).toBe(HINT_EN)
    expect(i18n.t(SKILL_KEY)).toBe(SKILL_EN)
    expect(i18n.t(HINT_KEY)).toContain('PRs')
    expect(i18n.t(SKILL_KEY)).toContain('Review PRs')
  })
})
