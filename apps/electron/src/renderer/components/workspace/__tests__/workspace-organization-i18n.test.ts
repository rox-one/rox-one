import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { setupI18n } from '@craft-agent/shared/i18n/setupI18n'
import i18n from 'i18next'

const source = readFileSync(join(import.meta.dir, '../AddWorkspaceStep_CreateNew.tsx'), 'utf8')
const localesDir = join(import.meta.dir, '../../../../../../../packages/shared/src/i18n/locales')

const STATIC_KEYS = [
  'workspace.organization',
  'workspace.organizationEmpty',
  'workspace.organizationRequired',
  'workspace.organizationSelect',
] as const

describe('P35-75 workspace.organization leftover chrome is i18n', () => {
  it('wires catalog t() keys and does not inject English defaultValue leftovers', () => {
    expect(source).not.toMatch(/defaultValue:\s*['"]/)
    expect(source).toContain('t("workspace.organization")')
    expect(source).toContain('t("workspace.organizationRequired")')
    expect(source).toContain('t("workspace.organizationSelect")')
    expect(source).toContain('t("workspace.organizationEmpty")')
    expect(source).not.toContain('Organization is required')
    expect(source).not.toContain('Select an organization')
    expect(source).not.toContain('No organizations yet')
  })

  it('English locale matches the leftover chrome labels', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t('workspace.organization')).toBe('Organization')
    expect(i18n.t('workspace.organizationRequired')).toBe(
      'A workspace must belong to an organization.',
    )
    expect(i18n.t('workspace.organizationSelect')).toBe('Select an organization')
    expect(i18n.t('workspace.organizationEmpty')).toBe(
      'No organizations yet. Create one to continue.',
    )
  })

  it('Russian copy is distinct from English', async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.t('workspace.organization')).toBe('Организация')
    expect(i18n.t('workspace.organizationEmpty')).toBe(
      'Организаций пока нет. Создайте одну, чтобы продолжить.',
    )
    expect(i18n.t('workspace.organizationRequired')).toBe(
      'Workspace должен принадлежать организации.',
    )
    expect(i18n.t('workspace.organizationSelect')).toBe('Выберите организацию')
    expect(i18n.t('workspace.organization')).not.toBe('Organization')
    expect(i18n.t('workspace.organizationSelect')).not.toBe('Select an organization')
    expect(i18n.t('workspace.organizationEmpty')).not.toBe(
      'No organizations yet. Create one to continue.',
    )
  })

  it('wires leftover keys in all 12 locales', () => {
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
      for (const key of STATIC_KEYS) {
        expect(locale[key]?.length, `${file} ${key}`).toBeGreaterThan(0)
      }
    }
  })
})
