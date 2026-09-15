import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'automations.connectorsOptional'
const SIBLING = 'calendar.provider.appleReminders'
const EN_VALUE = 'Apple Reminders, Mail.ru, Yandex, Outlook, and Google are optional.'
const RU_VALUE = 'Напоминания Apple, Mail.ru, Яндекс, Outlook и Google необязательны.'
const RU_PROVIDER = 'Напоминания Apple'

const en = JSON.parse(readFileSync(join(import.meta.dir, '../locales/en.json'), 'utf8')) as Record<string, string>
const ru = JSON.parse(readFileSync(join(import.meta.dir, '../locales/ru.json'), 'utf8')) as Record<string, string>

describe('automations.connectorsOptional leftover Apple Reminders wrapping', () => {
  it('keeps English catalog copy unchanged', () => {
    expect(en[KEY]).toBe(EN_VALUE)
    expect(en[SIBLING]).toBe('Apple Reminders')
  })

  it('matches sibling Apple Reminders wrapping in Russian', () => {
    expect(ru[KEY]).toBe(RU_VALUE)
    expect(ru[SIBLING]).toBe(RU_PROVIDER)
    expect(ru[KEY]).toContain(RU_PROVIDER)
    expect(ru[KEY]).not.toContain('Apple Reminders')
    expect(ru[KEY]).toContain('Mail.ru')
    expect(ru[KEY]).toContain('Outlook')
    expect(ru[KEY]).toContain('Google')
    expect(ru[KEY]).not.toBe(en[KEY])
  })

  it('resolves Russian through setupI18n without leftover English', async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.t(KEY)).toBe(RU_VALUE)
    expect(i18n.t(KEY)).not.toBe(EN_VALUE)
    expect(i18n.t(KEY)).not.toContain('Apple Reminders')
    expect(i18n.t(SIBLING)).toBe(RU_PROVIDER)
  })

  it('resolves English through setupI18n as the original leftover string', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
    expect(i18n.t(SIBLING)).toBe('Apple Reminders')
  })
})
