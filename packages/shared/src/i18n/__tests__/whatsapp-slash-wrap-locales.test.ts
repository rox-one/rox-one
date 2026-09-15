import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import i18n from 'i18next'
import { setupI18n } from '../setupI18n'

const KEY = 'dialog.whatsapp.selfChatHint'
const localesDir = join(import.meta.dir, '../locales')

const RU =
  'Поддерживается чат с собой: после подключения откройте свой чат с самим собой в WhatsApp и введите команду /new, чтобы начать сессию, или команду /pair <code>, чтобы привязать сессию из приложения.'
const EN =
  'Self-chat is supported: after connecting, open your own WhatsApp chat with yourself and type /new to start a session, or /pair <code> to link a session from the app.'
const LEFTOVER_RU =
  'Поддерживается чат с собой: после подключения откройте свой чат с самим собой в WhatsApp и введите /new, чтобы начать сессию, или /pair <code>, чтобы привязать сессию из приложения.'

describe('P35-191 leftover slash-command wrapping in dialog.whatsapp.selfChatHint', () => {
  it('wraps leftover English around the /new and /pair identifiers', () => {
    const ru = JSON.parse(readFileSync(join(localesDir, 'ru.json'), 'utf8')) as Record<string, string>
    expect(ru[KEY]).toBe(RU)
    expect(ru[KEY]).toContain('команду /new')
    expect(ru[KEY]).toContain('команду /pair')
    expect(ru[KEY]).toContain('/new')
    expect(ru[KEY]).toContain('/pair')
    expect(ru[KEY]).toContain('WhatsApp')
    expect(ru[KEY]).not.toContain('и введите /new')
    expect(ru[KEY]).not.toContain('или /pair <code>')
    expect(ru[KEY]).not.toBe(LEFTOVER_RU)
  })

  it('keeps English copy and the Latin slash commands', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN)
    expect(i18n.t(KEY)).toContain('/new')
    expect(i18n.t(KEY)).toContain('/pair')
    expect(i18n.t(KEY)).toContain('WhatsApp')
    expect(i18n.t(KEY)).not.toContain('команду')
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
      expect(locale[KEY], file).toContain('/new')
      expect(locale[KEY], file).toContain('/pair')
      expect(locale[KEY], file).toContain('WhatsApp')
    }
  })
})
