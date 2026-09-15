import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { i18n, setupI18n } from '../setupI18n'

const KEYS = ['extensions.center.skills', 'inspector.context.skills'] as const

const EN_VALUE = 'Skills'
const RU_VALUE = 'Навыки'
const RU_LEFTOVER = 'Скиллы'

const en = JSON.parse(readFileSync(join(import.meta.dir, '../locales/en.json'), 'utf8')) as Record<string, string>
const ru = JSON.parse(readFileSync(join(import.meta.dir, '../locales/ru.json'), 'utf8')) as Record<string, string>

describe('leftover Russian Скиллы wrapping in ru heading keys', () => {
  it('keeps English catalog copy unchanged', () => {
    for (const key of KEYS) {
      expect(en[key]).toBe(EN_VALUE)
    }
  })

  it('wraps leftover Скиллы as sibling Навыки on the same heading family', () => {
    for (const key of KEYS) {
      expect(ru[key]).toBe(RU_VALUE)
      expect(ru[key]).not.toBe(RU_LEFTOVER)
      expect(ru[key]).not.toMatch(/Скилл|скилл/)
      expect(ru[key]).toBe('Навыки')
      expect(ru[key]).not.toBe(en[key])
    }
  })

  it("resolves Russian through setupI18n without leftover calque Скилл/скилл", async () => {
    await setupI18n().changeLanguage('ru')
    for (const key of KEYS) {
      expect(i18n.t(key)).toBe(RU_VALUE)
      expect(i18n.t(key)).not.toMatch(/Скилл|скилл/)
      expect(i18n.t(key)).toBe('Навыки')
    }
  })

  it('resolves English through setupI18n as the original leftover string', async () => {
    await setupI18n().changeLanguage('en')
    for (const key of KEYS) {
      expect(i18n.t(key)).toBe(EN_VALUE)
      expect(i18n.t(key)).toBe('Skills')
      expect(i18n.t(key)).not.toBe('Навыки')
      expect(i18n.t(key)).not.toMatch(/Скилл|скилл/)
    }
  })
})
