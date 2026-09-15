import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'skills.exported' as const

const EN_VALUE = 'Skill "{{slug}}" exported to the project'
const RU_VALUE = 'Навык «{{slug}}» экспортирован в проект'
const SLUG = 'demo-skill'
const EN_RESOLVED = 'Skill "demo-skill" exported to the project'
const RU_RESOLVED = 'Навык «demo-skill» экспортирован в проект'

const LEFTOVER_SKILL = /скилл|Скилл/

const en = JSON.parse(readFileSync(join(import.meta.dir, '../locales/en.json'), 'utf8')) as Record<string, string>
const ru = JSON.parse(readFileSync(join(import.meta.dir, '../locales/ru.json'), 'utf8')) as Record<string, string>

describe('leftover Russian скилл wrapping in ru skills.exported', () => {
  it('keeps English catalog copy unchanged', () => {
    expect(en[KEY]).toBe(EN_VALUE)
    expect(en[KEY]).toContain('Skill')
    expect(en[KEY]).toContain('{{slug}}')
  })

  it('wraps leftover Скилл as sibling Навык on the same family', () => {
    expect(ru[KEY]).toBe(RU_VALUE)
    expect(ru[KEY]).not.toMatch(LEFTOVER_SKILL)
    expect(ru[KEY]).toContain('Навык')
    expect(ru[KEY]).toContain('{{slug}}')
    expect(ru[KEY]).not.toBe(en[KEY])
  })

  it("resolves Russian through setupI18n without leftover calque скилл/Скилл", async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.t(KEY)).toBe(RU_VALUE)
    expect(i18n.t(KEY, { slug: SLUG })).toBe(RU_RESOLVED)
    expect(i18n.t(KEY, { slug: SLUG })).not.toMatch(LEFTOVER_SKILL)
    expect(i18n.t(KEY, { slug: SLUG })).toContain('Навык')
    expect(i18n.t(KEY, { slug: SLUG })).toContain(SLUG)
  })

  it('resolves English through setupI18n as the original leftover string', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
    expect(i18n.t(KEY, { slug: SLUG })).toBe(EN_RESOLVED)
    expect(i18n.t(KEY, { slug: SLUG })).toContain('Skill')
    expect(i18n.t(KEY, { slug: SLUG })).not.toContain('Навык')
    expect(i18n.t(KEY, { slug: SLUG })).not.toMatch(LEFTOVER_SKILL)
  })
})
