import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { setupI18n } from '../setupI18n'
import i18n from 'i18next'

const localesDir = join(import.meta.dir, '../locales')
const en = JSON.parse(readFileSync(join(localesDir, 'en.json'), 'utf8')) as Record<string, string>
const ru = JSON.parse(readFileSync(join(localesDir, 'ru.json'), 'utf8')) as Record<string, string>

const KEY = 'extensions.card.installTarget'

describe('P35-110 leftover extensions.card.installTarget copy', () => {
  it('English locale keeps Install to wording', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe('Install to')
    expect(en[KEY]).toBe('Install to')
  })

  it('Russian copy uses Установить в and is not leftover English', async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.t(KEY)).toBe('Установить в')
    expect(i18n.t(KEY)).not.toBe('Install to')
    expect(ru[KEY]).toBe('Установить в')
    expect(ru[KEY]).not.toBe(en[KEY])
    expect(ru[KEY]).not.toMatch(/Install to/)
  })
})
