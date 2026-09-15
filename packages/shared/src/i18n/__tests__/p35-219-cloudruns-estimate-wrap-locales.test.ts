import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'cloudRuns.estimate'
const RU_VALUE = 'Обычный запуск ≈ {{tokens}} токенов'
const EN_VALUE = 'Typical run ≈ {{tokens}} tokens'
const LEFTOVER_CALQUE = /ран/
const localesDir = join(import.meta.dir, '../locales')

const en = JSON.parse(readFileSync(join(localesDir, 'en.json'), 'utf8')) as Record<string, string>
const ru = JSON.parse(readFileSync(join(localesDir, 'ru.json'), 'utf8')) as Record<string, string>

describe('P35-219 leftover Russian ран wrapping on cloudRuns.estimate', () => {
  it('keeps English catalog copy unchanged', () => {
    expect(en[KEY]).toBe(EN_VALUE)
    expect(en[KEY]).toContain('{{tokens}}')
    expect(en[KEY]).not.toContain('запуск')
  })

  it('wraps leftover ран as sibling запуск on cloudRuns.estimate only', () => {
    expect(ru[KEY]).toBe(RU_VALUE)
    expect(ru[KEY]).not.toMatch(LEFTOVER_CALQUE)
    expect(ru[KEY]).toContain('запуск')
    expect(ru[KEY]).toContain('{{tokens}}')
    expect(ru[KEY]).not.toBe(en[KEY])
    expect(ru[KEY]).not.toBe('Обычный ран ≈ {{tokens}} токенов')
  })

  it('resolves Russian through setupI18n without leftover calque ран', async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.t(KEY)).toBe(RU_VALUE)
    expect(i18n.t(KEY)).not.toMatch(LEFTOVER_CALQUE)
    expect(i18n.t(KEY)).toContain('запуск')
    expect(i18n.t(KEY)).toContain('{{tokens}}')
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
    expect(i18n.t(KEY)).toContain('Typical run')
    expect(i18n.t(KEY)).not.toContain('запуск')
    expect(i18n.t(KEY)).toContain('{{tokens}}')
  })
})
