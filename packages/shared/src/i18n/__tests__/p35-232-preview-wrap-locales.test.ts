import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'pages.refreshPreview'
const RU_VALUE = 'Обновить предпросмотр'
const EN_VALUE = 'Refresh preview'
const LEFTOVER_CALQUE = /превью/i
const PREVIEW_FAMILY = /предпросмотр/
const localesDir = join(import.meta.dir, '../locales')

const en = JSON.parse(readFileSync(join(localesDir, 'en.json'), 'utf8')) as Record<string, string>
const ru = JSON.parse(readFileSync(join(localesDir, 'ru.json'), 'utf8')) as Record<string, string>

describe('P35-232 leftover Russian превью wrapping on pages.refreshPreview', () => {
  it('keeps English catalog copy unchanged', () => {
    expect(en[KEY]).toBe(EN_VALUE)
    expect(en[KEY]).toContain('preview')
    expect(en[KEY]).not.toMatch(PREVIEW_FAMILY)
  })

  it('wraps leftover превью as sibling предпросмотр on refreshPreview only', () => {
    expect(ru[KEY]).toBe(RU_VALUE)
    expect(ru[KEY]).not.toMatch(LEFTOVER_CALQUE)
    expect(ru[KEY]).not.toContain('превью')
    expect(ru[KEY]).toMatch(PREVIEW_FAMILY)
    expect(ru[KEY]).toContain('предпросмотр')
    expect(ru[KEY]).not.toBe(en[KEY])
    expect(ru[KEY]).not.toBe('Обновить превью')
  })

  it('resolves Russian through setupI18n without leftover calque превью', async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.t(KEY)).toBe(RU_VALUE)
    expect(i18n.t(KEY)).not.toMatch(LEFTOVER_CALQUE)
    expect(i18n.t(KEY)).not.toContain('превью')
    expect(i18n.t(KEY)).toMatch(PREVIEW_FAMILY)
    expect(i18n.t(KEY)).toContain('предпросмотр')
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
    expect(i18n.t(KEY)).toContain('preview')
    expect(i18n.t(KEY)).not.toMatch(PREVIEW_FAMILY)
    expect(i18n.t(KEY)).not.toContain('превью')
    expect(i18n.t(KEY)).not.toContain('предпросмотр')
  })
})
