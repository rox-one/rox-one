import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { setupI18n, i18n } from '../setupI18n'

const en = JSON.parse(readFileSync(join(import.meta.dir, '../locales/en.json'), 'utf8')) as Record<string, string>
const ru = JSON.parse(readFileSync(join(import.meta.dir, '../locales/ru.json'), 'utf8')) as Record<string, string>

const KEYS = [
  'extensions.catalog.empty',
  'extensions.disabled.empty',
  'extensions.installed.empty',
  'extensions.updates.empty',
  'extensions.permissions.summary',
  'extensions.permissions.empty',
] as const

const RUSSIAN: Record<(typeof KEYS)[number], string> = {
  'extensions.catalog.empty': 'Нет совпадающих записей каталога.',
  'extensions.disabled.empty': 'Нет отключённых расширений.',
  'extensions.installed.empty': 'В этой рабочей области пока нет установленных расширений.',
  'extensions.updates.empty': 'Нет доступных обновлений.',
  'extensions.permissions.summary': 'Выданные разрешения по расширениям',
  'extensions.permissions.empty': 'Нет установленных расширений.',
}

const ENGLISH: Record<(typeof KEYS)[number], string> = {
  'extensions.catalog.empty': 'No catalog entries match.',
  'extensions.disabled.empty': 'No disabled extensions.',
  'extensions.installed.empty': 'No installed extensions in this workspace yet.',
  'extensions.updates.empty': 'No updates available.',
  'extensions.permissions.summary': 'Granted permissions by extension',
  'extensions.permissions.empty': 'No extensions installed.',
}

describe('P35-114 extensions empty-state leftover chrome locales', () => {
  it('keeps Russian copy distinct from leftover English', () => {
    for (const key of KEYS) {
      expect(en[key], key).toBe(ENGLISH[key])
      expect(ru[key], key).toBe(RUSSIAN[key])
      expect(ru[key], key).not.toBe(en[key])
    }
  })

  it('changeLanguage ru is not leftover English', async () => {
    await setupI18n().changeLanguage('ru')
    for (const key of KEYS) {
      expect(i18n.t(key)).toBe(RUSSIAN[key])
      expect(i18n.t(key)).not.toBe(ENGLISH[key])
    }
  })

  it('changeLanguage en stays English', async () => {
    await setupI18n().changeLanguage('en')
    for (const key of KEYS) {
      expect(i18n.t(key)).toBe(ENGLISH[key])
    }
  })
})
