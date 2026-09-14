import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { setupI18n } from '@craft-agent/shared/i18n/setupI18n'
import i18n from 'i18next'

const source = readFileSync(join(import.meta.dir, '..', 'CredentialMigrationCard.tsx'), 'utf8')
const localesDir = join(import.meta.dir, '../../../../../../../packages/shared/src/i18n/locales')

const ERROR_CODES = [
  'not_ready',
  'operation_failed',
  'rollback_stale',
  'rollback_unavailable',
  'stale_source',
  'unavailable',
] as const

const STATIC_KEYS = [
  'settings.accounts.migration.apply',
  'settings.accounts.migration.applyConfirm',
  'settings.accounts.migration.applyConfirmTitle',
  'settings.accounts.migration.applied',
  'settings.accounts.migration.check',
  'settings.accounts.migration.counts',
  'settings.accounts.migration.description',
  'settings.accounts.migration.idle',
  'settings.accounts.migration.nothingToMigrate',
  'settings.accounts.migration.previewEmptyAttention',
  'settings.accounts.migration.previewEmptyCurrent',
  'settings.accounts.migration.rollback',
  'settings.accounts.migration.rollbackConfirm',
  'settings.accounts.migration.rollbackConfirmTitle',
  'settings.accounts.migration.rolledBack',
  'settings.accounts.migration.statusLabel',
  'settings.accounts.migration.title',
] as const

const ERROR_KEYS = ERROR_CODES.map((code) => `settings.accounts.migration.error.${code}`)

describe('P35-73 CredentialMigrationCard leftover chrome is i18n', () => {
  it('wires catalog t() keys and does not inject English defaultValue leftovers', () => {
    expect(source).not.toMatch(/defaultValue:\s*['"]/)
    expect(source).toContain("t('settings.accounts.migration.title')")
    expect(source).toContain("t('settings.accounts.migration.description')")
    expect(source).toContain("t('settings.accounts.migration.check')")
    expect(source).toContain("t('settings.accounts.migration.statusLabel')")
    expect(source).toContain("t('settings.accounts.migration.apply')")
    expect(source).toContain("t('settings.accounts.migration.rollback')")
    expect(source).toContain("t('settings.accounts.migration.applyConfirmTitle')")
    expect(source).toContain("t('settings.accounts.migration.applyConfirm'")
    expect(source).toContain("t('settings.accounts.migration.rollbackConfirmTitle')")
    expect(source).toContain("t('settings.accounts.migration.rollbackConfirm')")
    expect(source).toContain("t('settings.accounts.migration.idle')")
    expect(source).toContain("t('settings.accounts.migration.applied'")
    expect(source).toContain("t('settings.accounts.migration.rolledBack')")
    expect(source).toContain("t('settings.accounts.migration.counts'")
    expect(source).toContain("t('settings.accounts.migration.previewEmptyAttention'")
    expect(source).toContain("t('settings.accounts.migration.previewEmptyCurrent'")
    expect(source).toContain("t('settings.accounts.migration.nothingToMigrate')")
    expect(source).toContain('t(`settings.accounts.migration.error.${code}`)')
    expect(source).toContain('t(`settings.accounts.migration.error.${errorCode}`)')
    expect(source).toContain("t('common.cancel')")
  })

  it('English locale matches the leftover chrome labels', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t('settings.accounts.migration.title')).toBe('Credential storage migration')
    expect(i18n.t('settings.accounts.migration.check')).toBe('Check')
    expect(i18n.t('settings.accounts.migration.apply')).toBe('Apply')
    expect(i18n.t('settings.accounts.migration.rollback')).toBe('Roll back')
    expect(i18n.t('settings.accounts.migration.statusLabel')).toBe('Status')
    expect(i18n.t('settings.accounts.migration.idle')).toBe(
      'Run Check to preview eligible credentials.',
    )
    expect(i18n.t('settings.accounts.migration.nothingToMigrate')).toBe('Nothing to migrate.')
    expect(i18n.t('settings.accounts.migration.applyConfirm', { count: 3 })).toBe(
      'Migrate 3 eligible credentials. An encrypted rollback snapshot is created first.',
    )
    expect(
      i18n.t('settings.accounts.migration.applied', {
        ready: 2,
        alreadyEnvelope: 1,
        skipped: 0,
        invalid: 0,
      }),
    ).toBe('Migrated 2. Already current: 1. Skipped: 0. Need attention: 0.')
    expect(i18n.t('settings.accounts.migration.error.stale_source')).toBe(
      'Storage changed. Run Check again.',
    )
    expect(i18n.t('settings.accounts.migration.error.operation_failed')).toBe(
      'Operation did not complete. Storage was left unchanged.',
    )
  })

  it('Russian copy is distinct from English', async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.t('settings.accounts.migration.title')).toBe('Миграция хранилища учётных данных')
    expect(i18n.t('settings.accounts.migration.check')).toBe('Проверить')
    expect(i18n.t('settings.accounts.migration.apply')).toBe('Применить')
    expect(i18n.t('settings.accounts.migration.rollback')).toBe('Откатить')
    expect(i18n.t('settings.accounts.migration.nothingToMigrate')).toBe('Мигрировать нечего.')
    expect(i18n.t('settings.accounts.migration.title')).not.toBe('Credential storage migration')
    expect(i18n.t('settings.accounts.migration.check')).not.toBe('Check')
    expect(i18n.t('settings.accounts.migration.apply')).not.toBe('Apply')
  })

  it('wires static and error keys in all 12 locales', () => {
    const files = readdirSync(localesDir).filter((name) => name.endsWith('.json')).sort()
    expect(files).toEqual([
      'ar.json',
      'de.json',
      'en.json',
      'es.json',
      'fr.json',
      'hu.json',
      'ja.json',
      'ko.json',
      'pl.json',
      'ru.json',
      'zh-Hans.json',
      'zh-Hant.json',
    ])
    for (const file of files) {
      const locale = JSON.parse(readFileSync(join(localesDir, file), 'utf8')) as Record<string, string>
      for (const key of [...STATIC_KEYS, ...ERROR_KEYS]) {
        expect(locale[key]?.length, `${file} ${key}`).toBeGreaterThan(0)
      }
    }
  })
})
