import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { setupI18n } from '@craft-agent/shared/i18n/setupI18n'
import i18n from 'i18next'

const menu = readFileSync(join(import.meta.dir, '../TaskActionMenu.tsx'), 'utf8')
const localesDir = join(import.meta.dir, '../../../../../../../packages/shared/src/i18n/locales')

const TASK_TYPE_KEYS = [
  'chat.taskTypeAgent',
  'chat.taskTypeShell',
  'chat.taskTypeWorkflow',
] as const

describe('P35-94 chat.taskType leftovers are i18n', () => {
  it('TaskActionMenu type badge uses chat.taskType* keys', () => {
    expect(menu).toContain("t('chat.taskTypeWorkflow')")
    expect(menu).toContain("t('chat.taskTypeAgent')")
    expect(menu).toContain("t('chat.taskTypeShell')")
    expect(menu).not.toContain("'Workflow'")
    expect(menu).not.toContain("'Shell'")
  })

  it('English locale keeps the previous type labels', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t('chat.taskTypeAgent')).toBe('Task')
    expect(i18n.t('chat.taskTypeShell')).toBe('Shell')
    expect(i18n.t('chat.taskTypeWorkflow')).toBe('Workflow')
  })

  it('Russian copy is distinct from English', async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.t('chat.taskTypeAgent')).toBe('Задача')
    expect(i18n.t('chat.taskTypeShell')).toBe('Оболочка')
    expect(i18n.t('chat.taskTypeWorkflow')).toBe('Сценарий')
    expect(i18n.t('chat.taskTypeShell')).not.toBe('Shell')
    expect(i18n.t('chat.taskTypeWorkflow')).not.toBe('Workflow')
    expect(i18n.t('chat.taskTypeAgent')).not.toBe('Task')
  })

  it('all 12 locales already define the wired task-type keys', () => {
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
      for (const key of TASK_TYPE_KEYS) {
        expect(locale[key]?.length, `${file} ${key}`).toBeGreaterThan(0)
      }
    }
  })
})
