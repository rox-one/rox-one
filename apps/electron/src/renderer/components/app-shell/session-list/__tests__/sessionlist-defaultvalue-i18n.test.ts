import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { setupI18n } from '@craft-agent/shared/i18n/setupI18n'
import i18n from 'i18next'
import { catalogLabelOrId } from '../list-grouping'

const sessionList = readFileSync(join(import.meta.dir, '../../SessionList.tsx'), 'utf8')
const grouping = readFileSync(join(import.meta.dir, '../list-grouping.ts'), 'utf8')
const localesDir = join(import.meta.dir, '../../../../../../../../packages/shared/src/i18n/locales')

const STATIC_KEYS = [
  'collection.display.labelNone',
  'sidebar.noProject',
  'sidebar.unknownProject',
] as const

const DYNAMIC_KEYS = [
  'collection.display.dueBucket.later',
  'collection.display.dueBucket.none',
  'collection.display.dueBucket.overdue',
  'collection.display.dueBucket.this_week',
  'collection.display.dueBucket.today',
  'priority.high',
  'priority.low',
  'priority.medium',
  'priority.none',
  'priority.urgent',
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

describe('P35-61 SessionList / list-grouping leftover chrome is i18n', () => {
  it('does not inject English string defaultValue leftovers', () => {
    expect(sessionList).not.toMatch(/defaultValue:/)
    expect(grouping).not.toMatch(/defaultValue:/)
    expect(sessionList).not.toContain("defaultValue: 'Unknown project'")
    expect(sessionList).not.toContain("defaultValue: 'No project'")
    expect(sessionList).not.toContain("defaultValue: 'No label'")
    expect(grouping).not.toContain("defaultValue: 'No project'")
    expect(grouping).not.toContain("defaultValue: 'No label'")
    expect(sessionList).not.toContain('defaultValue: priority')
    expect(sessionList).not.toContain('defaultValue: bucket')
    expect(grouping).not.toContain('defaultValue: status.label')
    expect(grouping).not.toContain('defaultValue: priority')
    expect(grouping).not.toContain('defaultValue: bucket')
    expect(sessionList).not.toContain('t(`status.${state.id}`, state.label)')
  })

  it('keeps t() callsites on the existing grouping keys', () => {
    expect(sessionList).toContain("t('sidebar.unknownProject')")
    expect(sessionList).toContain("t('sidebar.noProject')")
    expect(sessionList).toContain("t('collection.display.labelNone')")
    expect(grouping).toContain("t('sidebar.noProject')")
    expect(grouping).toContain("t('collection.display.labelNone')")
    expect(grouping).toContain('catalogLabelOrId(t, `status.${status.id}`, status.id, status.label)')
    expect(sessionList).toContain('catalogLabelOrId(t, `status.${state.id}`, state.id, state.label)')
    expect(sessionList).toContain('catalogLabelOrId(t, `priority.${priority}`, priority)')
    expect(grouping).toContain('catalogLabelOrId(t, `priority.${priority}`, priority)')
    expect(sessionList).toContain('catalogLabelOrId(t, `collection.display.dueBucket.${bucket}`, bucket)')
    expect(grouping).toContain('catalogLabelOrId(t, `collection.display.dueBucket.${bucket}`, bucket)')
  })

  it('falls back to the user label, then the identifier, for custom ids', async () => {
    await setupI18n().changeLanguage('en')
    const translate = (key: string) => i18n.t(key)
    expect(catalogLabelOrId(translate, 'status.todo', 'todo', 'Inbox')).toBe('Todo')
    expect(catalogLabelOrId(translate, 'priority.urgent', 'urgent')).toBe('Urgent')
    expect(catalogLabelOrId(translate, 'collection.display.dueBucket.overdue', 'overdue')).toBe('Overdue')
    expect(i18n.t('status.waiting-on-legal')).toBe('status.waiting-on-legal')
    expect(
      catalogLabelOrId(translate, 'status.waiting-on-legal', 'waiting-on-legal', 'Waiting on legal'),
    ).toBe('Waiting on legal')
    expect(
      catalogLabelOrId(translate, 'status.waiting-on-legal', 'waiting-on-legal', 'Waiting on legal'),
    ).not.toBe('status.waiting-on-legal')
    expect(catalogLabelOrId(translate, 'status.waiting-on-legal', 'waiting-on-legal')).toBe('waiting-on-legal')
    expect(catalogLabelOrId(translate, 'priority.custom-sla', 'custom-sla')).toBe('custom-sla')
    expect(catalogLabelOrId(translate, 'collection.display.dueBucket.someday', 'someday')).toBe('someday')
  })

  it('English locale matches the previous hardcoded leftovers', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t('sidebar.unknownProject')).toBe('Unknown project')
    expect(i18n.t('sidebar.noProject')).toBe('No project')
    expect(i18n.t('collection.display.labelNone')).toBe('No label')
    expect(i18n.t('priority.urgent')).toBe('Urgent')
    expect(i18n.t('priority.high')).toBe('High')
    expect(i18n.t('priority.medium')).toBe('Medium')
    expect(i18n.t('priority.low')).toBe('Low')
    expect(i18n.t('priority.none')).toBe('None')
    expect(i18n.t('collection.display.dueBucket.overdue')).toBe('Overdue')
    expect(i18n.t('collection.display.dueBucket.today')).toBe('Today')
    expect(i18n.t('collection.display.dueBucket.this_week')).toBe('This week')
    expect(i18n.t('collection.display.dueBucket.later')).toBe('Later')
    expect(i18n.t('collection.display.dueBucket.none')).toBe('No date')
    expect(i18n.t('status.todo')).toBe('Todo')
    expect(i18n.t('status.in-progress')).toBe('In Progress')
    expect(i18n.t('status.needs-review')).toBe('Needs Review')
    expect(i18n.t('status.done')).toBe('Done')
    expect(i18n.t('status.backlog')).toBe('Backlog')
    expect(i18n.t('status.cancelled')).toBe('Cancelled')
  })

  it('Russian copy is distinct from English', async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.t('sidebar.unknownProject')).toBe('Неизвестный проект')
    expect(i18n.t('sidebar.noProject')).toBe('Без проекта')
    expect(i18n.t('collection.display.labelNone')).toBe('Без метки')
    expect(i18n.t('sidebar.unknownProject')).not.toBe('Unknown project')
    expect(i18n.t('sidebar.noProject')).not.toBe('No project')
    expect(i18n.t('collection.display.labelNone')).not.toBe('No label')
    expect(i18n.t('priority.urgent')).toBe('Срочный')
    expect(i18n.t('priority.urgent')).not.toBe('Urgent')
    expect(i18n.t('collection.display.dueBucket.overdue')).toBe('Просрочено')
    expect(i18n.t('collection.display.dueBucket.overdue')).not.toBe('Overdue')
    expect(i18n.t('status.todo')).toBe('К выполнению')
    expect(i18n.t('status.todo')).not.toBe('Todo')
    expect(i18n.t('status.in-progress')).toBe('В работе')
    expect(i18n.t('status.in-progress')).not.toBe('In Progress')
  })

  it('wires static and dynamic grouping keys in all 12 locales', () => {
    const files = readdirSync(localesDir).filter((name) => name.endsWith('.json')).sort()
    expect(files).toEqual([...LOCALE_FILES])
    for (const file of files) {
      const locale = JSON.parse(readFileSync(join(localesDir, file), 'utf8')) as Record<string, string>
      for (const key of STATIC_KEYS) {
        expect(locale[key]?.length, `${file} ${key}`).toBeGreaterThan(0)
      }
      for (const key of DYNAMIC_KEYS) {
        expect(locale[key]?.length, `${file} ${key}`).toBeGreaterThan(0)
      }
    }
  })
})
