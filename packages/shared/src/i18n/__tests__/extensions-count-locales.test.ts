import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { i18n, setupI18n } from '../setupI18n'

const en = JSON.parse(readFileSync(join(import.meta.dir, '../locales/en.json'), 'utf8')) as Record<string, string>
const ru = JSON.parse(readFileSync(join(import.meta.dir, '../locales/ru.json'), 'utf8')) as Record<string, string>

const keys = ['extensions.catalog.count', 'extensions.installed.count'] as const

describe('P35-115 leftover extensions count locales', () => {
  it('keeps Russian count copy distinct from English', () => {
    for (const key of keys) {
      expect(en[key], key).toBeTruthy()
      expect(ru[key], key).toBeTruthy()
      expect(ru[key], key).not.toBe(en[key])
    }
    expect(ru['extensions.catalog.count']).toBe('{{count}} записей каталога')
    expect(ru['extensions.installed.count']).toBe('{{count}} установлено')
    expect(ru['extensions.catalog.count']).toContain('{{count}}')
    expect(ru['extensions.installed.count']).toContain('{{count}}')
    expect(ru['extensions.catalog.count_one']).toBeUndefined()
    expect(ru['extensions.catalog.count_few']).toBeUndefined()
    expect(ru['extensions.catalog.count_many']).toBeUndefined()
    expect(ru['extensions.catalog.count_other']).toBeUndefined()
    expect(ru['extensions.installed.count_one']).toBeUndefined()
    expect(ru['extensions.installed.count_few']).toBeUndefined()
    expect(ru['extensions.installed.count_many']).toBeUndefined()
    expect(ru['extensions.installed.count_other']).toBeUndefined()
  })

  it('changeLanguage ru is not leftover English; en stays English', async () => {
    setupI18n()

    await i18n.changeLanguage('ru')
    expect(i18n.t('extensions.catalog.count', { count: 3 })).toBe('3 записей каталога')
    expect(i18n.t('extensions.installed.count', { count: 3 })).toBe('3 установлено')
    expect(i18n.t('extensions.catalog.count')).not.toBe(en['extensions.catalog.count'])
    expect(i18n.t('extensions.installed.count')).not.toBe(en['extensions.installed.count'])
    expect(i18n.t('extensions.catalog.count')).not.toContain('catalog entries')
    expect(i18n.t('extensions.installed.count')).not.toBe('{{count}} installed')

    await i18n.changeLanguage('en')
    expect(i18n.t('extensions.catalog.count', { count: 3 })).toBe('3 catalog entries')
    expect(i18n.t('extensions.installed.count', { count: 3 })).toBe('3 installed')
    expect(i18n.t('extensions.catalog.count')).toBe(en['extensions.catalog.count'])
    expect(i18n.t('extensions.installed.count')).toBe(en['extensions.installed.count'])
  })
})
