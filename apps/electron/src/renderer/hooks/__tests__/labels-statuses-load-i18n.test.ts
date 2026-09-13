import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { setupI18n } from '@craft-agent/shared/i18n/setupI18n'
import i18n from 'i18next'

const labels = readFileSync(join(import.meta.dir, '../useLabels.ts'), 'utf8')
const statuses = readFileSync(join(import.meta.dir, '../useStatuses.ts'), 'utf8')

describe('labels/statuses load fallback is i18n', () => {
  it('uses t() keys and skips the English fallbacks', () => {
    expect(labels).toContain("i18n.t('settings.labels.loadFailed')")
    expect(statuses).toContain("i18n.t('status.loadFailed')")
    expect(labels).toContain("console.error('[useLabels] Failed to load labels:', err)")
    expect(statuses).toContain("console.error('[useStatuses] Failed to load statuses:', err)")
    expect(labels).not.toContain("'Failed to load labels'")
    expect(statuses).not.toContain("'Failed to load statuses'")
  })

  it('English locale matches the previous hardcoded fallbacks', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t('settings.labels.loadFailed')).toBe('Failed to load labels')
    expect(i18n.t('status.loadFailed')).toBe('Failed to load statuses')
  })

  it('Russian copy is distinct from English', async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.t('settings.labels.loadFailed')).toBe('Не удалось загрузить метки')
    expect(i18n.t('status.loadFailed')).toBe('Не удалось загрузить статусы')
  })
})
