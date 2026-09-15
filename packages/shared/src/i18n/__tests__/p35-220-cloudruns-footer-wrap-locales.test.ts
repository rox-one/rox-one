import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'cloudRuns.footer'
const RU_VALUE = 'Запуски продолжаются, даже если приложение закрыто.'
const EN_VALUE = 'Runs continue even when the app is closed.'
const LEFTOVER_CALQUE = /ран(?:ы)?/i
const localesDir = join(import.meta.dir, '../locales')

const en = JSON.parse(readFileSync(join(localesDir, 'en.json'), 'utf8')) as Record<string, string>
const ru = JSON.parse(readFileSync(join(localesDir, 'ru.json'), 'utf8')) as Record<string, string>

describe('P35-220 leftover Russian Раны wrapping on cloudRuns.footer', () => {
  it('keeps English catalog copy unchanged', () => {
    expect(en[KEY]).toBe(EN_VALUE)
    expect(en[KEY]).toContain('Runs continue')
    expect(en[KEY]).not.toContain('Запуски')
  })

  it('wraps leftover Раны as sibling Запуски on cloudRuns.footer only', () => {
    expect(ru[KEY]).toBe(RU_VALUE)
    expect(ru[KEY]).not.toMatch(LEFTOVER_CALQUE)
    expect(ru[KEY]).toContain('Запуски')
    expect(ru[KEY]).not.toBe(en[KEY])
    expect(ru[KEY]).not.toBe('Раны продолжаются, даже если приложение закрыто.')
  })

  it('resolves Russian through setupI18n without leftover calque ран/Раны', async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.t(KEY)).toBe(RU_VALUE)
    expect(i18n.t(KEY)).not.toMatch(LEFTOVER_CALQUE)
    expect(i18n.t(KEY)).toContain('Запуски')
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
    expect(i18n.t(KEY)).toContain('Runs continue')
    expect(i18n.t(KEY)).not.toContain('Запуски')
  })
})
