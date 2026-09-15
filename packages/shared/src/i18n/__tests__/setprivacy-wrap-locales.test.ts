import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import i18n from 'i18next'
import { setupI18n } from '../setupI18n'

const KEY = 'settings.messaging.telegram.supergroup.dialogDescription'
const localesDir = join(import.meta.dir, '../locales')

const RU =
  'Добавьте бота в свою супергруппу, затем введите команду в любой теме. У бота должен быть отключён режим приватности (BotFather → команда /setprivacy → пункт Disable) или права администратора, чтобы читать сообщения, не являющиеся командами.'
const EN =
  'Add the bot to your supergroup, then type the command in any topic. The bot needs privacy mode disabled (BotFather → /setprivacy → Disable) or admin rights to read non-command messages.'
const LEFTOVER_RU =
  'Добавьте бота в свою супергруппу, затем введите команду в любой теме. У бота должен быть отключён режим приватности (BotFather → /setprivacy → Disable) или права администратора, чтобы читать сообщения, не являющиеся командами.'

describe('P35-189 leftover BotFather wrapping in settings.messaging.telegram.supergroup.dialogDescription', () => {
  it('wraps leftover English around /setprivacy and Disable identifiers', () => {
    const ru = JSON.parse(readFileSync(join(localesDir, 'ru.json'), 'utf8')) as Record<string, string>
    expect(ru[KEY]).toBe(RU)
    expect(ru[KEY]).toContain('команда /setprivacy')
    expect(ru[KEY]).toContain('пункт Disable')
    expect(ru[KEY]).toContain('/setprivacy')
    expect(ru[KEY]).toContain('Disable')
    expect(ru[KEY]).not.toBe(LEFTOVER_RU)
  })

  it('keeps English BotFather identifiers as English', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN)
    expect(i18n.t(KEY)).toContain('/setprivacy')
    expect(i18n.t(KEY)).toContain('Disable')
    expect(i18n.t(KEY)).not.toContain('команда')
    expect(i18n.t(KEY)).not.toContain('пункт')
  })

  it('Russian runtime copy is distinct from leftover English', async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.t(KEY)).toBe(RU)
    expect(i18n.t(KEY)).not.toBe(LEFTOVER_RU)
    expect(i18n.t(KEY)).not.toBe(i18n.t(KEY, { lng: 'en' }))
    expect(i18n.t(KEY)).not.toBe(EN)

    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN)

    await setupI18n().changeLanguage('ru')
  })

  it('defines the key in all 12 locales', () => {
    const files = readdirSync(localesDir).filter((name) => name.endsWith('.json')).sort()
    expect(files).toHaveLength(12)
    for (const file of files) {
      const locale = JSON.parse(readFileSync(join(localesDir, file), 'utf8')) as Record<string, string>
      expect(locale[KEY]?.length, file).toBeGreaterThan(0)
    }
  })
})
