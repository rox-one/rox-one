import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { setupI18n } from '@craft-agent/shared/i18n/setupI18n'
import i18n from 'i18next'

const renderer = join(import.meta.dir, '../../..')
const localesDir = join(import.meta.dir, '../../../../../../../packages/shared/src/i18n/locales')

const UPDATED_KEYS = [
  'knowledge.publish.action.adopt',
  'knowledge.publish.action.apply',
  'knowledge.publish.action.close',
  'knowledge.publish.action.distill',
  'knowledge.publish.action.editDraft',
  'knowledge.publish.action.finalize',
  'knowledge.publish.action.prepare',
  'knowledge.publish.action.redistill',
  'knowledge.publish.error.generic',
  'knowledge.publish.excludedCount',
  'knowledge.publish.menu',
  'knowledge.publish.mode.adoptRequired',
  'knowledge.publish.mode.create',
  'knowledge.publish.mode.update',
  'knowledge.publish.publishedTo',
  'knowledge.publish.step.distill',
  'knowledge.publish.step.done',
  'knowledge.publish.step.review',
  'knowledge.publish.step.target',
  'knowledge.publish.title',
] as const

const EN: Record<(typeof UPDATED_KEYS)[number], string> = {
  'knowledge.publish.action.adopt': 'Adopt existing',
  'knowledge.publish.action.apply': 'Create proposal',
  'knowledge.publish.action.close': 'Close',
  'knowledge.publish.action.distill': 'Distill',
  'knowledge.publish.action.editDraft': 'Edit draft',
  'knowledge.publish.action.finalize': 'Finalize publication',
  'knowledge.publish.action.prepare': 'Continue',
  'knowledge.publish.action.redistill': 'Re-distill',
  'knowledge.publish.error.generic': 'Could not complete the publish step. Try again.',
  'knowledge.publish.excludedCount': '{{count}} fragments excluded',
  'knowledge.publish.menu': 'Publish to Knowledge…',
  'knowledge.publish.mode.adoptRequired':
    'A document already exists at this path without Craft provenance. Adopt it or choose another path.',
  'knowledge.publish.mode.create': 'Will create a new document',
  'knowledge.publish.mode.update': 'Will update the existing published document',
  'knowledge.publish.publishedTo': 'Published to: {{target}}',
  'knowledge.publish.step.distill': 'Distill',
  'knowledge.publish.step.done': 'Done',
  'knowledge.publish.step.review': 'Review',
  'knowledge.publish.step.target': 'Target',
  'knowledge.publish.title': 'Publish to Knowledge',
}

const RU: Record<(typeof UPDATED_KEYS)[number], string> = {
  'knowledge.publish.action.adopt': 'Принять существующий',
  'knowledge.publish.action.apply': 'Создать предложение',
  'knowledge.publish.action.close': 'Закрыть',
  'knowledge.publish.action.distill': 'Извлечь',
  'knowledge.publish.action.editDraft': 'Править черновик',
  'knowledge.publish.action.finalize': 'Завершить публикацию',
  'knowledge.publish.action.prepare': 'Продолжить',
  'knowledge.publish.action.redistill': 'Извлечь заново',
  'knowledge.publish.error.generic': 'Не удалось выполнить шаг публикации. Попробуйте ещё раз.',
  'knowledge.publish.excludedCount': 'Исключено фрагментов: {{count}}',
  'knowledge.publish.menu': 'Опубликовать в базу знаний…',
  'knowledge.publish.mode.adoptRequired':
    'По этому пути уже есть документ без метки происхождения. Примите его или выберите другой путь.',
  'knowledge.publish.mode.create': 'Будет создан новый документ',
  'knowledge.publish.mode.update': 'Будет обновлён уже опубликованный документ',
  'knowledge.publish.publishedTo': 'Опубликовано в: {{target}}',
  'knowledge.publish.step.distill': 'Извлечение',
  'knowledge.publish.step.done': 'Готово',
  'knowledge.publish.step.review': 'Проверка',
  'knowledge.publish.step.target': 'Цель',
  'knowledge.publish.title': 'Публикация в базу знаний',
}

function read(rel: string): string {
  return readFileSync(join(renderer, rel), 'utf8')
}

describe('P35-83 knowledge.publish leftover English is i18n', () => {
  it('keeps t() callsites on the publish keys', () => {
    const dialog = read('components/knowledge/PublishSessionDialog.tsx')
    const menu = read('components/app-shell/SessionMenu.tsx')
    const compact = read('components/app-shell/CompactSessionMenu.tsx')

    expect(dialog).toContain("t('knowledge.publish.title')")
    expect(dialog).toContain("t('knowledge.publish.action.adopt')")
    expect(dialog).toContain("t('knowledge.publish.action.apply')")
    expect(dialog).toContain("t('knowledge.publish.action.close')")
    expect(dialog).toContain("t('knowledge.publish.action.distill')")
    expect(dialog).toContain("t('knowledge.publish.action.editDraft')")
    expect(dialog).toContain("t('knowledge.publish.action.finalize')")
    expect(dialog).toContain("t('knowledge.publish.action.prepare')")
    expect(dialog).toContain("t('knowledge.publish.action.redistill')")
    expect(dialog).toContain("t('knowledge.publish.error.generic')")
    expect(dialog).toContain("t('knowledge.publish.excludedCount'")
    expect(dialog).toContain("t('knowledge.publish.mode.adoptRequired')")
    expect(dialog).toContain("t('knowledge.publish.publishedTo'")
    expect(dialog).not.toContain('defaultValue:')
    expect(menu).toContain("t('knowledge.publish.menu')")
    expect(compact).toContain("t('knowledge.publish.menu')")
  })

  it('English locale keeps the leftover publish copy', async () => {
    await setupI18n().changeLanguage('en')
    for (const key of UPDATED_KEYS) {
      expect(i18n.t(key)).toBe(EN[key])
    }
    expect(i18n.t('knowledge.publish.excludedCount', { count: 3 })).toBe('3 fragments excluded')
    expect(i18n.t('knowledge.publish.publishedTo', { target: 'document/abc' })).toBe(
      'Published to: document/abc',
    )
  })

  it('Russian copy is distinct from English', async () => {
    await setupI18n().changeLanguage('ru')
    for (const key of UPDATED_KEYS) {
      expect(i18n.t(key)).toBe(RU[key])
      expect(i18n.t(key)).not.toBe(EN[key])
    }
    expect(i18n.t('knowledge.publish.excludedCount', { count: 3 })).toBe('Исключено фрагментов: 3')
    expect(i18n.t('knowledge.publish.publishedTo', { target: 'document/abc' })).toBe(
      'Опубликовано в: document/abc',
    )
    expect(i18n.t('knowledge.publish.mode.adoptRequired')).not.toContain('Craft Agents')
    expect(i18n.t('knowledge.publish.title')).not.toContain('OMP')
  })

  it('wires publish keys in all 12 locales', () => {
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
      for (const key of UPDATED_KEYS) {
        expect(locale[key]?.length, `${file} ${key}`).toBeGreaterThan(0)
      }
    }
  })
})
