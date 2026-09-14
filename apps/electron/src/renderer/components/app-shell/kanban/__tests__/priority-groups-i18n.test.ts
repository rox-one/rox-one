import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { setupI18n } from '@craft-agent/shared/i18n/setupI18n'
import i18n from 'i18next'
import type { SessionPriority } from '@craft-agent/shared/protocol/dto'
import type { KanbanTask } from '../types'
import { buildPriorityGroups } from '../priority-groups'

const source = readFileSync(join(import.meta.dir, '../priority-groups.ts'), 'utf8')
const localesDir = join(import.meta.dir, '../../../../../../../../packages/shared/src/i18n/locales')

const PRIORITY_KEYS = [
  'priority.high',
  'priority.low',
  'priority.medium',
  'priority.none',
  'priority.urgent',
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

function task(id: string, priority?: SessionPriority): KanbanTask {
  return {
    id,
    title: id,
    column: 'todo',
    statusId: 'todo',
    model: 'm',
    subtasks: [],
    priority,
  }
}

describe('P35-62 priority-groups leftover chrome is i18n', () => {
  it('does not inject identifier or English defaultValue leftovers', () => {
    expect(source).not.toMatch(/defaultValue/)
    expect(source).not.toContain("defaultValue: prio")
    expect(source).not.toContain("defaultValue: 'Urgent'")
    expect(source).not.toContain("t(`priority.${prio}`, { defaultValue: prio })")
    expect(source).toContain('t(`priority.${prio}`)')
    expect(source).toContain('translated === `priority.${prio}` ? prio : translated')
  })

  it('English locale matches the previous hardcoded leftovers', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t('priority.urgent')).toBe('Urgent')
    expect(i18n.t('priority.high')).toBe('High')
    expect(i18n.t('priority.medium')).toBe('Medium')
    expect(i18n.t('priority.low')).toBe('Low')
    expect(i18n.t('priority.none')).toBe('None')
  })

  it('labels known groups from the English catalog, not the identifier', async () => {
    await setupI18n().changeLanguage('en')
    const groups = buildPriorityGroups(
      [task('a', 'urgent'), task('b', 'high'), task('c', 'none')],
      (key) => i18n.t(key),
    )
    expect(groups.map((g) => g.name)).toEqual(['Urgent', 'High', 'None'])
    expect(groups[0]!.name).not.toBe('urgent')
    expect(groups[0]!.name).not.toBe('priority.urgent')
  })

  it('Russian copy is distinct from English', async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.t('priority.urgent')).toBe('Срочный')
    expect(i18n.t('priority.urgent')).not.toBe('Urgent')
    expect(i18n.t('priority.high')).toBe('Высокий')
    expect(i18n.t('priority.none')).toBe('Нет')
    expect(i18n.t('priority.none')).not.toBe('None')
    const groups = buildPriorityGroups([task('a', 'urgent')], (key) => i18n.t(key))
    expect(groups[0]!.name).toBe('Срочный')
    expect(groups[0]!.name).not.toBe('Urgent')
    expect(groups[0]!.name).not.toBe('urgent')
  })

  it('falls back to the priority identifier when the catalog misses', async () => {
    await setupI18n().changeLanguage('en')
    const miss = (key: string) => key
    const groups = buildPriorityGroups([task('a', 'urgent'), task('b', 'low')], miss)
    expect(groups.map((g) => g.name)).toEqual(['urgent', 'low'])
    expect(groups[0]!.name).not.toBe('priority.urgent')
    expect(groups[1]!.name).not.toBe('priority.low')
    expect(i18n.t('priority.missing_custom')).toBe('priority.missing_custom')
  })

  it('wires priority keys in all 12 locales', () => {
    const files = readdirSync(localesDir).filter((name) => name.endsWith('.json')).sort()
    expect(files).toEqual([...LOCALE_FILES])
    for (const file of files) {
      const locale = JSON.parse(readFileSync(join(localesDir, file), 'utf8')) as Record<string, string>
      for (const key of PRIORITY_KEYS) {
        expect(locale[key]?.length, `${file} ${key}`).toBeGreaterThan(0)
      }
    }
  })
})
