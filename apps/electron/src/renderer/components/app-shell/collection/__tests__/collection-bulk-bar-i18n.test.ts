import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { setupI18n } from '@craft-agent/shared/i18n/setupI18n'
import i18n from 'i18next'
import { bulkStatusColumnLabel } from '../bulk-status-label'

const bar = readFileSync(join(import.meta.dir, '../CollectionBulkBar.tsx'), 'utf8')
const helper = readFileSync(join(import.meta.dir, '../bulk-status-label.ts'), 'utf8')
const localesDir = join(import.meta.dir, '../../../../../../../../packages/shared/src/i18n/locales')

const STATUS_COLUMN_KEYS = [
  'kanban.column.cancelled',
  'kanban.column.done',
  'kanban.column.in-progress',
  'kanban.column.needs-review',
  'kanban.column.todo',
] as const

function catalogLabel(status: string): string {
  return bulkStatusColumnLabel(status, (key) => i18n.t(key), (key) => i18n.exists(key))
}

describe('CollectionBulkBar leftover English chrome is i18n', () => {
  it('uses catalog keys and skips English defaultValue leftovers', () => {
    expect(bar).toContain('bulkStatusColumnLabel(status, (key) => t(key), (key) => i18n.exists(key))')
    expect(bar).toContain("t(`priority.${priority}`)")
    expect(bar).not.toContain('defaultValue: status')
    expect(bar).not.toContain("{ defaultValue: status }")
    expect(bar).not.toMatch(/defaultValue:\s*['"]/)
    expect(helper).not.toMatch(/defaultValue:\s*['"]/)
    expect(bar).not.toContain("t(`kanban.column.${status}`, { defaultValue: status })")
    expect(helper).toContain('value !== key')
    expect(helper).toContain('kanban.column.${status}')
  })

  it('English locale keeps the existing column labels', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t('kanban.column.todo')).toBe('Task')
    expect(i18n.t('kanban.column.in-progress')).toBe('In progress')
    expect(i18n.t('kanban.column.needs-review')).toBe('Needs review')
    expect(i18n.t('kanban.column.done')).toBe('Done')
    expect(i18n.t('kanban.column.cancelled')).toBe('Cancelled')
  })

  it('known kebab statuses still hit the catalog', async () => {
    await setupI18n().changeLanguage('en')
    expect(catalogLabel('todo')).toBe('Task')
    expect(catalogLabel('in-progress')).toBe('In progress')
    expect(catalogLabel('needs-review')).toBe('Needs review')
    expect(catalogLabel('done')).toBe('Done')
    expect(catalogLabel('cancelled')).toBe('Cancelled')
    await setupI18n().changeLanguage('ru')
    expect(catalogLabel('in-progress')).toBe('В работе')
    expect(catalogLabel('needs-review')).toBe('Требует проверки')
    expect(catalogLabel('cancelled')).toBe('Отменено')
  })

  it('custom status ids fall back to the identifier, not the raw i18n key', async () => {
    await setupI18n().changeLanguage('en')
    const status = 'my-custom-status'
    const key = `kanban.column.${status}`
    expect(i18n.exists(key)).toBe(false)
    expect(i18n.t(key)).toBe(key)
    expect(catalogLabel(status)).toBe(status)
    expect(catalogLabel(status)).not.toBe(key)
    expect(catalogLabel(status)).not.toContain('kanban.column.')
    expect(bulkStatusColumnLabel(status, () => key, () => true)).toBe(status)
    expect(bulkStatusColumnLabel(status, () => ({ nested: true }), () => true)).toBe(status)
  })

  it('Russian copy is distinct from English', async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.t('kanban.column.todo')).toBe('Задача')
    expect(i18n.t('kanban.column.in-progress')).toBe('В работе')
    expect(i18n.t('kanban.column.needs-review')).toBe('Требует проверки')
    expect(i18n.t('kanban.column.done')).toBe('Готово')
    expect(i18n.t('kanban.column.cancelled')).toBe('Отменено')
    expect(i18n.t('kanban.column.todo')).not.toBe('Task')
    expect(i18n.t('kanban.column.in-progress')).not.toBe('In progress')
    expect(i18n.t('kanban.column.cancelled')).not.toBe('Cancelled')
  })

  it('all 12 locales define the wired bulk-status column keys', () => {
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
      for (const key of STATUS_COLUMN_KEYS) {
        expect(locale[key]?.length, `${file} ${key}`).toBeGreaterThan(0)
      }
    }
  })
})
