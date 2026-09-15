import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'cli.command.export.useCase'
const RU_VALUE = 'Сохранить переносимый пакет сессии. Нативный контроль: меню сессии → Экспорт.'
const EN_VALUE = 'Save a portable session bundle. Native control: session menu → Export.'
const LEFTOVER_CALQUE = /бандл/i
const localesDir = join(import.meta.dir, '../locales')

const en = JSON.parse(readFileSync(join(localesDir, 'en.json'), 'utf8')) as Record<string, string>
const ru = JSON.parse(readFileSync(join(localesDir, 'ru.json'), 'utf8')) as Record<string, string>

describe('P35-230 leftover Russian бандл wrapping on cli.command.export.useCase', () => {
  it('keeps English catalog copy unchanged', () => {
    expect(en[KEY]).toBe(EN_VALUE)
    expect(en[KEY]).toContain('session bundle')
    expect(en[KEY]).not.toContain('пакет')
  })

  it('wraps leftover бандл as sibling пакет on cli.command.export.useCase only', () => {
    expect(ru[KEY]).toBe(RU_VALUE)
    expect(ru[KEY]).not.toMatch(LEFTOVER_CALQUE)
    expect(ru[KEY]).toContain('пакет')
    expect(ru[KEY]).not.toBe(en[KEY])
    expect(ru[KEY]).not.toBe('Сохранить переносимый бандл сессии. Нативный контроль: меню сессии → Экспорт.')
  })

  it('resolves Russian through setupI18n without leftover calque бандл', async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.t(KEY)).toBe(RU_VALUE)
    expect(i18n.t(KEY)).not.toMatch(LEFTOVER_CALQUE)
    expect(i18n.t(KEY)).toContain('пакет')
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
    expect(i18n.t(KEY)).toContain('session bundle')
    expect(i18n.t(KEY)).not.toContain('пакет')
    expect(i18n.t(KEY)).not.toContain('бандл')
  })
})
