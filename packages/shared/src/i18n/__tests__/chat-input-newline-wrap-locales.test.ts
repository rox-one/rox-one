import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { setupI18n } from '../setupI18n'
import i18n from 'i18next'

const KEY = 'chatInput.placeholder.newLine'
const localesDir = join(import.meta.dir, '../locales')

describe('P35-176 leftover Return wrapping in chatInput.placeholder.newLine', () => {
  it('wraps leftover Return as Enter in Russian, matching sibling key names', () => {
    const ru = JSON.parse(readFileSync(join(localesDir, 'ru.json'), 'utf8')) as Record<string, string>
    expect(ru[KEY]).toBe('Нажмите Shift + Enter, чтобы добавить новую строку')
    expect(ru[KEY]).not.toMatch(/\bReturn\b/)
    expect(ru['settings.input.enterKey']).toBe('Enter')
    expect(ru['settings.input.enterKeyDesc']).toBe('Shift+Enter переводит строку')
    expect(ru['inspector.terminalHint']).toBe('Введите команду и нажмите Enter.')
  })

  it('keeps English Return as English', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe('Press Shift + Return to add a new line')
  })

  it('Russian runtime copy is distinct from leftover English', async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.t(KEY)).toBe('Нажмите Shift + Enter, чтобы добавить новую строку')
    expect(i18n.t(KEY)).not.toBe('Press Shift + Return to add a new line')
    expect(i18n.t(KEY)).not.toMatch(/\bReturn\b/)
    expect(i18n.t(KEY)).toMatch(/\bEnter\b/)
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
