import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import i18n from 'i18next'
import { setupI18n } from '../setupI18n'

const KEY = 'dialog.deleteAutomation.description'
const localesDir = join(import.meta.dir, '../locales')

const RU =
  'Вы уверены, что хотите удалить <strong>{{name}}</strong>? Автоматизация будет удалена из файла automations.json.'
const EN =
  'Are you sure you want to delete <strong>{{name}}</strong>? This will remove the automation from your automations.json configuration.'
const LEFTOVER_RU =
  'Вы уверены, что хотите удалить <strong>{{name}}</strong>? Автоматизация будет удалена из конфигурации automations.json.'

describe('P35-190 leftover filename wrapping in dialog.deleteAutomation.description', () => {
  it('wraps leftover English around the automations.json filename', () => {
    const ru = JSON.parse(readFileSync(join(localesDir, 'ru.json'), 'utf8')) as Record<string, string>
    expect(ru[KEY]).toBe(RU)
    expect(ru[KEY]).toContain('файла automations.json')
    expect(ru[KEY]).toContain('automations.json')
    expect(ru[KEY]).not.toContain('конфигурации automations.json')
    expect(ru[KEY]).not.toBe(LEFTOVER_RU)
  })

  it('keeps English copy and the Latin filename', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN)
    expect(i18n.t(KEY)).toContain('automations.json')
    expect(i18n.t(KEY)).not.toContain('файла')
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
      expect(locale[KEY], file).toContain('automations.json')
    }
  })
})
