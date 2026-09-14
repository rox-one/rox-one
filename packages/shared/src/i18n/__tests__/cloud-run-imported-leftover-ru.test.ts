import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { setupI18n } from '../setupI18n'
import i18n from 'i18next'

const localesDir = join(import.meta.dir, '../locales')
const en = JSON.parse(readFileSync(join(localesDir, 'en.json'), 'utf8')) as Record<string, string>
const ru = JSON.parse(readFileSync(join(localesDir, 'ru.json'), 'utf8')) as Record<string, string>

const CLOUD_RUN_IMPORTED_KEYS = [
  'settings.account.event.cloudRunImported',
  'settings.account.source.cloudRunImported',
  'workbench.status.fallbackUnverified',
] as const

describe('P35-108 leftover cloud run imported copy', () => {
  it('English locale keeps Cloud run / Fallback live wording', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t('settings.account.event.cloudRunImported')).toBe('Cloud run imported')
    expect(i18n.t('settings.account.source.cloudRunImported')).toBe('Import a cloud run · +40')
    expect(i18n.t('workbench.status.fallbackUnverified')).toBe('Fallback live not verified')
    expect(en['settings.account.event.cloudRunImported']).toBe('Cloud run imported')
    expect(en['settings.account.source.cloudRunImported']).toBe('Import a cloud run · +40')
    expect(en['workbench.status.fallbackUnverified']).toBe('Fallback live not verified')
  })

  it('Russian copy uses ран / резерв and is not leftover English', async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.t('settings.account.event.cloudRunImported')).toBe('Облачный ран импортирован')
    expect(i18n.t('settings.account.source.cloudRunImported')).toBe('Импортировать облачный ран · +40')
    expect(i18n.t('workbench.status.fallbackUnverified')).toBe('Живой резерв не проверен')
    expect(i18n.t('cloudRuns.finished')).toContain('ран')

    for (const key of CLOUD_RUN_IMPORTED_KEYS) {
      expect(i18n.t(key), key).not.toMatch(/cloud run/i)
      expect(i18n.t(key), key).not.toMatch(/Fallback live/)
      expect(i18n.t(key), key).not.toBe(en[key])
      expect(ru[key], key).not.toMatch(/cloud run/i)
      expect(ru[key], key).not.toMatch(/Fallback live/)
    }
  })
})
