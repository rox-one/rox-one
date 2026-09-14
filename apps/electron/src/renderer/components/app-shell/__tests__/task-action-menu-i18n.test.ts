import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { setupI18n } from '@craft-agent/shared/i18n/setupI18n'
import i18n from 'i18next'

const source = readFileSync(join(import.meta.dir, '../TaskActionMenu.tsx'), 'utf8')
const localesDir = join(import.meta.dir, '../../../../../../../packages/shared/src/i18n/locales')

const STATIC_KEYS = [
  'chat.taskOrphanedHint',
  'chat.taskStatusDone',
  'chat.taskStatusFailed',
  'chat.taskStatusOrphaned',
  'chat.taskStatusStopped',
  'toast.taskOutputCopied',
] as const

describe('P35-68 TaskActionMenu leftover chrome is i18n', () => {
  it('keeps t() callsites on the existing task keys and skips English second-args', () => {
    expect(source).toContain("t('toast.taskOutputCopied')")
    expect(source).toContain("t('chat.taskStatusDone')")
    expect(source).toContain("t('chat.taskStatusFailed')")
    expect(source).toContain("t('chat.taskStatusStopped')")
    expect(source).toContain("t('chat.taskStatusOrphaned')")
    expect(source).toContain("t('chat.taskOrphanedHint')")
    expect(source).not.toContain("t('toast.taskOutputCopied', 'Task output copied to clipboard')")
    expect(source).not.toContain("t('chat.taskStatusDone', 'done')")
    expect(source).not.toContain("t('chat.taskStatusFailed', 'failed')")
    expect(source).not.toContain("t('chat.taskStatusStopped', 'stopped')")
    expect(source).not.toContain("t('chat.taskStatusOrphaned', 'orphaned')")
    expect(source).not.toContain(
      "t('chat.taskOrphanedHint', 'This background task was terminated when its turn ended.')",
    )
    expect(source).not.toMatch(/t\('toast\.taskOutputCopied',\s*'[^']+'\)/)
    expect(source).not.toMatch(/t\('chat\.taskStatus(?:Done|Failed|Stopped|Orphaned)',\s*'[^']+'\)/)
    expect(source).not.toMatch(/t\('chat\.taskOrphanedHint',\s*'[^']+'\)/)
  })

  it('English locale matches the previous hardcoded leftovers', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t('toast.taskOutputCopied')).toBe('Task output copied to clipboard')
    expect(i18n.t('chat.taskStatusDone')).toBe('done')
    expect(i18n.t('chat.taskStatusFailed')).toBe('failed')
    expect(i18n.t('chat.taskStatusStopped')).toBe('stopped')
    expect(i18n.t('chat.taskStatusOrphaned')).toBe('orphaned')
    expect(i18n.t('chat.taskOrphanedHint')).toBe(
      'This background task was terminated when its turn ended.',
    )
  })

  it('Russian copy is distinct from English', async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.t('toast.taskOutputCopied')).toBe('Вывод задачи скопирован в буфер обмена')
    expect(i18n.t('chat.taskStatusDone')).toBe('готово')
    expect(i18n.t('chat.taskStatusFailed')).toBe('сбой')
    expect(i18n.t('chat.taskStatusStopped')).toBe('остановлена')
    expect(i18n.t('chat.taskStatusOrphaned')).toBe('потеряна')
    expect(i18n.t('chat.taskOrphanedHint')).toBe(
      'Эта фоновая задача была завершена при окончании её хода.',
    )
    expect(i18n.t('toast.taskOutputCopied')).not.toBe('Task output copied to clipboard')
    expect(i18n.t('chat.taskOrphanedHint')).not.toBe(
      'This background task was terminated when its turn ended.',
    )
  })

  it('wires static keys in all 12 locales', () => {
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
