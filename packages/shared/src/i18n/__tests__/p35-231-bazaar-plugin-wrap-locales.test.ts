import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'extensions.registries.bazaarEmpty'
const RU_VALUE = 'Лента Bazaar пуста без расширений ядра'
const EN_VALUE = 'Bazaar feed is empty without kernel plugins'
const LEFTOVER_CALQUE = /плагин/i
const EXTENSION_FAMILY = /расширен/
const localesDir = join(import.meta.dir, '../locales')

const en = JSON.parse(readFileSync(join(localesDir, 'en.json'), 'utf8')) as Record<string, string>
const ru = JSON.parse(readFileSync(join(localesDir, 'ru.json'), 'utf8')) as Record<string, string>

describe('P35-231 leftover Russian плагин wrapping on extensions.registries.bazaarEmpty', () => {
  it('keeps English catalog copy unchanged', () => {
    expect(en[KEY]).toBe(EN_VALUE)
    expect(en[KEY]).toContain('kernel plugins')
    expect(en[KEY]).not.toMatch(EXTENSION_FAMILY)
  })

  it('wraps leftover плагинов as sibling расширений on bazaarEmpty only', () => {
    expect(ru[KEY]).toBe(RU_VALUE)
    expect(ru[KEY]).not.toMatch(LEFTOVER_CALQUE)
    expect(ru[KEY]).not.toContain('плагинов')
    expect(ru[KEY]).toMatch(EXTENSION_FAMILY)
    expect(ru[KEY]).toContain('расширений')
    expect(ru[KEY]).not.toBe(en[KEY])
    expect(ru[KEY]).not.toBe('Лента Bazaar пуста без плагинов ядра')
  })

  it('resolves Russian through setupI18n without leftover calque плагин', async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.t(KEY)).toBe(RU_VALUE)
    expect(i18n.t(KEY)).not.toMatch(LEFTOVER_CALQUE)
    expect(i18n.t(KEY)).not.toContain('плагинов')
    expect(i18n.t(KEY)).toMatch(EXTENSION_FAMILY)
    expect(i18n.t(KEY)).toContain('расширений')
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
    expect(i18n.t(KEY)).toContain('kernel plugins')
    expect(i18n.t(KEY)).not.toMatch(EXTENSION_FAMILY)
    expect(i18n.t(KEY)).not.toContain('плагин')
    expect(i18n.t(KEY)).not.toContain('плагинов')
    expect(i18n.t(KEY)).not.toContain('расширений')
  })
})
