import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { setupI18n } from '@craft-agent/shared/i18n/setupI18n'
import i18n from 'i18next'
import { statusCatalogLabel } from '../status-catalog-label'

const appShell = readFileSync(join(import.meta.dir, '../AppShell.tsx'), 'utf8')
const helper = readFileSync(join(import.meta.dir, '../status-catalog-label.ts'), 'utf8')
const localesDir = join(import.meta.dir, '../../../../../../../packages/shared/src/i18n/locales')

const STATUS_KEYS = [
  'status.backlog',
  'status.cancelled',
  'status.done',
  'status.in-progress',
  'status.needs-review',
  'status.todo',
] as const

const LOCALE_FILES = [
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
] as const

describe('P35-63 AppShell status leftover chrome is i18n', () => {
  it('does not inject English string defaultValue leftovers', () => {
    expect(appShell).not.toContain('t(`status.${state.id}`, state.label)')
    expect(appShell).not.toContain("t(`status.${state.id}`, { defaultValue: state.label })")
    expect(helper).not.toMatch(/defaultValue:/)
    expect(helper).not.toContain('t(key,')
    expect(appShell).toContain('statusCatalogLabel((key) => t(key), state)')
    expect(appShell).toContain('title: statusCatalogLabel((key) => t(key), state)')
  })

  it('keeps t() callsites on the existing status catalog keys', () => {
    expect(helper).toContain('status.${state.id}')
    expect(helper).toContain('const translated = t(key)')
    expect(helper).toContain("typeof translated === 'string' && translated !== key")
    expect(helper).toContain('return state.id')
  })

  it('falls back to the user label, then the identifier, for custom ids', async () => {
    await setupI18n().changeLanguage('en')
    const translate = (key: string) => i18n.t(key)
    expect(statusCatalogLabel(translate, { id: 'todo', label: 'Inbox' })).toBe('Todo')
    expect(statusCatalogLabel(translate, { id: 'in-progress', label: 'Doing' })).toBe('In Progress')
    expect(i18n.t('status.waiting-on-legal')).toBe('status.waiting-on-legal')
    expect(
      statusCatalogLabel(translate, { id: 'waiting-on-legal', label: 'Waiting on legal' }),
    ).toBe('Waiting on legal')
    expect(
      statusCatalogLabel(translate, { id: 'waiting-on-legal', label: 'Waiting on legal' }),
    ).not.toBe('status.waiting-on-legal')
    expect(statusCatalogLabel(translate, { id: 'waiting-on-legal' })).toBe('waiting-on-legal')
    expect(statusCatalogLabel(translate, { id: 'waiting-on-legal', label: '' })).toBe(
      'waiting-on-legal',
    )
    expect(statusCatalogLabel(translate, { id: 'waiting-on-legal', label: '   ' })).toBe(
      'waiting-on-legal',
    )
    expect(statusCatalogLabel(() => ({ nested: true }), { id: 'custom', label: 'Legal review' })).toBe(
      'Legal review',
    )
    expect(statusCatalogLabel(() => 12, { id: 'custom' })).toBe('custom')
  })

  it('English locale matches the previous hardcoded leftovers', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t('status.todo')).toBe('Todo')
    expect(i18n.t('status.in-progress')).toBe('In Progress')
    expect(i18n.t('status.needs-review')).toBe('Needs Review')
    expect(i18n.t('status.done')).toBe('Done')
    expect(i18n.t('status.backlog')).toBe('Backlog')
    expect(i18n.t('status.cancelled')).toBe('Cancelled')
  })

  it('Russian copy is distinct from English', async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.t('status.todo')).toBe('К выполнению')
    expect(i18n.t('status.todo')).not.toBe('Todo')
    expect(i18n.t('status.in-progress')).toBe('В работе')
    expect(i18n.t('status.in-progress')).not.toBe('In Progress')
    expect(i18n.t('status.needs-review')).toBe('Требует проверки')
    expect(i18n.t('status.done')).toBe('Готово')
    const translate = (key: string) => i18n.t(key)
    expect(statusCatalogLabel(translate, { id: 'todo', label: 'Inbox' })).toBe('К выполнению')
    expect(statusCatalogLabel(translate, { id: 'todo', label: 'Inbox' })).not.toBe('Todo')
  })

  it('wires status catalog keys in all 12 locales', () => {
    const files = readdirSync(localesDir).filter((name) => name.endsWith('.json')).sort()
    expect(files).toEqual([...LOCALE_FILES])
    for (const file of files) {
      const locale = JSON.parse(readFileSync(join(localesDir, file), 'utf8')) as Record<string, string>
      for (const key of STATUS_KEYS) {
        expect(locale[key]?.length, `${file} ${key}`).toBeGreaterThan(0)
      }
    }
  })
})
