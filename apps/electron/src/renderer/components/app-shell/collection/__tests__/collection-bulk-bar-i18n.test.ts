import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { setupI18n } from '@craft-agent/shared/i18n/setupI18n'
import i18n from 'i18next'

const bar = readFileSync(join(import.meta.dir, '../CollectionBulkBar.tsx'), 'utf8')
const localesDir = join(import.meta.dir, '../../../../../../../../packages/shared/src/i18n/locales')

const STATUS_COLUMN_KEYS = [
  'kanban.column.cancelled',
  'kanban.column.done',
  'kanban.column.in-progress',
  'kanban.column.needs-review',
  'kanban.column.todo',
] as const

describe('CollectionBulkBar leftover English chrome is i18n', () => {
  it('uses catalog keys and skips English defaultValue leftovers', () => {
    expect(bar).toContain('t(`kanban.column.${status}`)')
    expect(bar).toContain("t(`priority.${priority}`)")
    expect(bar).not.toContain('defaultValue: status')
    expect(bar).not.toContain("{ defaultValue: status }")
    expect(bar).not.toMatch(/defaultValue:\s*['"]/)
    expect(bar).not.toContain("t(`kanban.column.${status}`, { defaultValue: status })")
  })

  it('English locale keeps the existing column labels', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t('kanban.column.todo')).toBe('Task')
    expect(i18n.t('kanban.column.in-progress')).toBe('In progress')
    expect(i18n.t('kanban.column.needs-review')).toBe('Needs review')
    expect(i18n.t('kanban.column.done')).toBe('Done')
    expect(i18n.t('kanban.column.cancelled')).toBe('Cancelled')
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
