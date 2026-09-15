import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'cloudRuns.resume'
const RU_VALUE = 'Продолжить запуск'
const EN_VALUE = 'Resume run'
const LEFTOVER_CALQUE = /ран/i
const localesDir = join(import.meta.dir, '../locales')

const en = JSON.parse(readFileSync(join(localesDir, 'en.json'), 'utf8')) as Record<string, string>
const ru = JSON.parse(readFileSync(join(localesDir, 'ru.json'), 'utf8')) as Record<string, string>

describe('P35-224 leftover Russian ран wrapping on cloudRuns.resume', () => {
  it('keeps English catalog copy unchanged', () => {
    expect(en[KEY]).toBe(EN_VALUE)
    expect(en[KEY]).toContain('Resume run')
    expect(en[KEY]).not.toContain('запуск')
  })

  it('wraps leftover ран as sibling запуск on cloudRuns.resume only', () => {
    expect(ru[KEY]).toBe(RU_VALUE)
    expect(ru[KEY]).not.toMatch(LEFTOVER_CALQUE)
    expect(ru[KEY]).toContain('запуск')
    expect(ru[KEY]).not.toBe(en[KEY])
    expect(ru[KEY]).not.toBe('Продолжить ран')
  })

  it('resolves Russian through setupI18n without leftover calque ран', async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.t(KEY)).toBe(RU_VALUE)
    expect(i18n.t(KEY)).not.toMatch(LEFTOVER_CALQUE)
    expect(i18n.t(KEY)).toContain('запуск')
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
    expect(i18n.t(KEY)).toContain('Resume run')
    expect(i18n.t(KEY)).not.toContain('запуск')
  })
})
