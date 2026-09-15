import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'cloudRuns.preset'
const RU_VALUE = 'Шаблон запуска'
const EN_VALUE = 'Run preset'
const LEFTOVER_CALQUE = /ран|рана/i
const localesDir = join(import.meta.dir, '../locales')

const en = JSON.parse(readFileSync(join(localesDir, 'en.json'), 'utf8')) as Record<string, string>
const ru = JSON.parse(readFileSync(join(localesDir, 'ru.json'), 'utf8')) as Record<string, string>

describe('P35-227 leftover Russian рана wrapping on cloudRuns.preset', () => {
  it('keeps English catalog copy unchanged', () => {
    expect(en[KEY]).toBe(EN_VALUE)
    expect(en[KEY]).toContain('Run preset')
    expect(en[KEY]).not.toContain('запуска')
  })

  it('wraps leftover рана as sibling запуска on cloudRuns.preset only', () => {
    expect(ru[KEY]).toBe(RU_VALUE)
    expect(ru[KEY]).not.toMatch(LEFTOVER_CALQUE)
    expect(ru[KEY]).toContain('запуска')
    expect(ru[KEY]).not.toBe(en[KEY])
    expect(ru[KEY]).not.toBe('Шаблон рана')
  })

  it('resolves Russian through setupI18n without leftover calque ран/рана', async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.t(KEY)).toBe(RU_VALUE)
    expect(i18n.t(KEY)).not.toMatch(LEFTOVER_CALQUE)
    expect(i18n.t(KEY)).toContain('запуска')
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
    expect(i18n.t(KEY)).toContain('Run preset')
    expect(i18n.t(KEY)).not.toContain('запуска')
    expect(i18n.t(KEY)).not.toContain('рана')
  })
})
