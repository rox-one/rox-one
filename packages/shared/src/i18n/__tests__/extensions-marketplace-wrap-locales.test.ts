import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { setupI18n } from '../setupI18n'
import i18n from 'i18next'

const KEY = 'settings.extensions.description'
const localesDir = join(import.meta.dir, '../locales')

describe('P35-175 leftover marketplace wrapping in extensions description', () => {
  it('wraps leftover marketplace as a common noun in Russian, matching sibling copy', () => {
    const ru = JSON.parse(readFileSync(join(localesDir, 'ru.json'), 'utf8')) as Record<string, string>
    expect(ru[KEY]).toBe('Управление навыками, источниками, автоматизациями и пакетами маркетплейса в одном месте')
    expect(ru[KEY]).not.toMatch(/\bmarketplace\b/i)
    expect(ru['extensions.center.marketplace']).toBe('Маркетплейс')
    expect(ru['settings.marketplace.title']).toBe('Маркетплейс')
    expect(ru['marketplace.removeConfirm']).toBe('Удалить эту запись маркетплейса?')
  })

  it('keeps English marketplace as English', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe('Manage skills, sources, automations, and marketplace packs in one place')
  })

  it('Russian runtime copy is distinct from leftover English', async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.t(KEY)).toBe('Управление навыками, источниками, автоматизациями и пакетами маркетплейса в одном месте')
    expect(i18n.t(KEY)).not.toBe('Manage skills, sources, automations, and marketplace packs in one place')
    expect(i18n.t(KEY)).not.toMatch(/\bmarketplace\b/i)
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
