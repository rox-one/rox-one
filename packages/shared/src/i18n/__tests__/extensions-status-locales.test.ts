import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { setupI18n } from '../setupI18n'
import i18n from 'i18next'

const en = JSON.parse(readFileSync(join(import.meta.dir, '../locales/en.json'), 'utf8')) as Record<string, string>
const ru = JSON.parse(readFileSync(join(import.meta.dir, '../locales/ru.json'), 'utf8')) as Record<string, string>

const keys = [
  'extensions.registries.active',
  'extensions.status.available',
  'extensions.status.degraded',
  'extensions.status.disabled',
  'extensions.status.enabled',
  'extensions.status.installed',
  'extensions.status.update-available',
] as const

describe('extensions status leftover chrome locales', () => {
  it('keeps Russian copy distinct from English', () => {
    for (const key of keys) {
      expect(en[key], key).toBeTruthy()
      expect(ru[key], key).toBeTruthy()
      expect(ru[key], key).not.toBe(en[key])
    }
    expect(ru['extensions.status.enabled']).toBe('Включено')
    expect(ru['extensions.status.disabled']).toBe('Отключено')
    expect(ru['extensions.status.available']).toBe('Доступно')
    expect(ru['extensions.status.degraded']).toBe('Ограничено')
    expect(ru['extensions.status.installed']).toBe('Установлено')
    expect(ru['extensions.status.update-available']).toBe('Обновление')
    expect(ru['extensions.registries.active']).toBe('Активный')
  })

  it('setupI18n ru is not English; en stays English', async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.t('extensions.status.enabled')).toBe('Включено')
    expect(i18n.t('extensions.status.disabled')).toBe('Отключено')
    expect(i18n.t('extensions.status.update-available')).toBe('Обновление')
    expect(i18n.t('extensions.registries.active')).toBe('Активный')
    expect(i18n.t('extensions.status.enabled')).not.toBe('enabled')

    await setupI18n().changeLanguage('en')
    expect(i18n.t('extensions.status.enabled')).toBe('enabled')
    expect(i18n.t('extensions.status.disabled')).toBe('disabled')
    expect(i18n.t('extensions.status.available')).toBe('available')
    expect(i18n.t('extensions.status.degraded')).toBe('degraded')
    expect(i18n.t('extensions.status.installed')).toBe('installed')
    expect(i18n.t('extensions.status.update-available')).toBe('update')
    expect(i18n.t('extensions.registries.active')).toBe('active')
  })
})
