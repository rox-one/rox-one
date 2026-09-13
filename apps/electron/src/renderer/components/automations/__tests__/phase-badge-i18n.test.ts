import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { setupI18n } from '@craft-agent/shared/i18n/setupI18n'
import i18n from 'i18next'

const localesDir = join(import.meta.dir, '../../../../../../../packages/shared/src/i18n/locales')
const source = readFileSync(join(import.meta.dir, '../PhaseBadge.tsx'), 'utf8')

const PHASE_KEYS = [
  'sidebar.scheduled',
  'automations.labelEvent',
  'automations.phaseBefore',
  'automations.phaseAfter',
  'automations.phaseOnError',
] as const

describe('PhaseBadge leftover labels are i18n', () => {
  it('reuses existing Scheduled/Event keys and skips English leftover labels', () => {
    expect(source).toContain("labelKey: 'sidebar.scheduled'")
    expect(source).toContain("labelKey: 'automations.labelEvent'")
    expect(source).toContain("labelKey: 'automations.phaseBefore'")
    expect(source).toContain("labelKey: 'automations.phaseAfter'")
    expect(source).toContain("labelKey: 'automations.phaseOnError'")
    expect(source).toContain('t(badge.labelKey)')
    expect(source).not.toContain("label: 'Scheduled'")
    expect(source).not.toContain("label: 'Before'")
    expect(source).not.toContain("label: 'After'")
    expect(source).not.toContain("label: 'On Error'")
    expect(source).not.toContain("label: 'Event'")
  })

  it('English locale keeps the existing badge labels', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t('sidebar.scheduled')).toBe('Scheduled')
    expect(i18n.t('automations.labelEvent')).toBe('Event')
    expect(i18n.t('automations.phaseBefore')).toBe('Before')
    expect(i18n.t('automations.phaseAfter')).toBe('After')
    expect(i18n.t('automations.phaseOnError')).toBe('On Error')
  })

  it('Russian copy is distinct from English', async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.t('sidebar.scheduled')).toBe('Запланированные')
    expect(i18n.t('automations.labelEvent')).toBe('Событие')
    expect(i18n.t('automations.phaseBefore')).toBe('Перед')
    expect(i18n.t('automations.phaseAfter')).toBe('После')
    expect(i18n.t('automations.phaseOnError')).toBe('При ошибке')
    expect(i18n.t('automations.phaseBefore')).not.toBe('Before')
    expect(i18n.t('automations.phaseOnError')).not.toBe('On Error')
  })

  it('all 12 locales define the wired phase keys', () => {
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
      for (const key of PHASE_KEYS) {
        expect(locale[key]?.length, `${file} ${key}`).toBeGreaterThan(0)
      }
    }
  })
})
