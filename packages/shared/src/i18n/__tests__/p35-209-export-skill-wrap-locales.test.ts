import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'toast.failedToExportSkill' as const

const EN_VALUE = 'Failed to export skill'
const RU_VALUE = 'Не удалось экспортировать навык'

const LEFTOVER_SKILL = /(^|[^а-яёА-ЯЁ])скилл(?![а-яёА-ЯЁ])/

const en = JSON.parse(readFileSync(join(import.meta.dir, '../locales/en.json'), 'utf8')) as Record<string, string>
const ru = JSON.parse(readFileSync(join(import.meta.dir, '../locales/ru.json'), 'utf8')) as Record<string, string>

describe('leftover Russian скилл wrapping in ru toast.failedToExportSkill', () => {
  it('keeps English catalog copy unchanged', () => {
    expect(en[KEY]).toBe(EN_VALUE)
    expect(en[KEY]).toContain('skill')
  })

  it('wraps leftover скилл as sibling навык on the same family', () => {
    expect(ru[KEY]).toBe(RU_VALUE)
    expect(ru[KEY]).not.toMatch(LEFTOVER_SKILL)
    expect(ru[KEY]).toContain('навык')
    expect(ru[KEY]).not.toBe(en[KEY])
    expect(ru['skillsList.ompExportFailed']).toBe(RU_VALUE)
  })

  it("resolves Russian through setupI18n without leftover calque скилл", async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.t(KEY)).toBe(RU_VALUE)
    expect(i18n.t(KEY)).not.toBe(EN_VALUE)
    expect(i18n.t(KEY)).not.toMatch(LEFTOVER_SKILL)
    expect(i18n.t(KEY)).toContain('навык')
  })

  it('resolves English through setupI18n as the original leftover string', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
    expect(i18n.t(KEY)).toContain('skill')
    expect(i18n.t(KEY)).not.toContain('навык')
  })
})
