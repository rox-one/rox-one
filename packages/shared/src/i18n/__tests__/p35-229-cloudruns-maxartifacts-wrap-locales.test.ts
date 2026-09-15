import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'settings.cloudRuns.maxArtifactsHint'
const RU_VALUE = 'Максимум байт артефактов на завершённый запуск'
const EN_VALUE = 'Max total artifact bytes kept for a finished run'
const LEFTOVER_CALQUE = /ран|рана/i
const localesDir = join(import.meta.dir, '../locales')

const en = JSON.parse(readFileSync(join(localesDir, 'en.json'), 'utf8')) as Record<string, string>
const ru = JSON.parse(readFileSync(join(localesDir, 'ru.json'), 'utf8')) as Record<string, string>

describe('P35-229 leftover Russian ран wrapping on settings.cloudRuns.maxArtifactsHint', () => {
  it('keeps English catalog copy unchanged', () => {
    expect(en[KEY]).toBe(EN_VALUE)
    expect(en[KEY]).toContain('finished run')
    expect(en[KEY]).not.toContain('запуск')
  })

  it('wraps leftover ран as sibling запуск on settings.cloudRuns.maxArtifactsHint only', () => {
    expect(ru[KEY]).toBe(RU_VALUE)
    expect(ru[KEY]).not.toMatch(LEFTOVER_CALQUE)
    expect(ru[KEY]).toContain('запуск')
    expect(ru[KEY]).not.toBe(en[KEY])
    expect(ru[KEY]).not.toBe('Максимум байт артефактов на завершённый ран')
  })

  it('resolves Russian through setupI18n without leftover calque ран/рана', async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.t(KEY)).toBe(RU_VALUE)
    expect(i18n.t(KEY)).not.toMatch(LEFTOVER_CALQUE)
    expect(i18n.t(KEY)).toContain('запуск')
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
    expect(i18n.t(KEY)).toContain('finished run')
    expect(i18n.t(KEY)).not.toContain('запуск')
    expect(i18n.t(KEY)).not.toContain('ран')
  })
})
