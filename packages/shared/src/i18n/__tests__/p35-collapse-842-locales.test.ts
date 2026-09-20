import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const localesDirectory = join(import.meta.dir, '../locales')
const en = JSON.parse(readFileSync(join(localesDirectory, 'en.json'), 'utf8')) as Record<string, string>
const ru = JSON.parse(readFileSync(join(localesDirectory, 'ru.json'), 'utf8')) as Record<string, string>

function interpolationVars(value: string): string[] {
  return (value.match(/\{\{(\w+)\}\}/g) ?? []).map((m) => m.replace(/[{}]/g, '')).sort()
}

/** Collapsed leftover wraps from open fix(i18n) drafts #842–#847. One assertion map, not 6 PRs. */
const WRAPPED_RU: Record<string, string> = {
  'projectInfo.detailsHelpText':
    'Произвольный текст, добавляемый в системный запрос агента, когда сессия привязана к этому проекту.',
  'projectsList.emptyDescription':
    'Группируйте сессии, ресурсы и контекст в проекты. Настройки каждого проекта — рабочая директория, детали и ресурсы — автоматически добавляются в системный запрос агента.',
  'settings.ai.extendedPromptCache': 'Расширенный кэш запросов (1 час)',
  'settings.ai.extendedPromptCacheDesc':
    'Кэшировать запросы на 1 час вместо 5 минут. Применяется только к моделям Claude через Anthropic API. Снижает стоимость длинных сессий, но увеличивает стоимость записи в кэш.',
  'settings.appearance.workbenchHarnessChatChromeDesc':
    'История запросов, прогресс хода и стоимость в статусе. По умолчанию включено.',
  'tasks.promptPlaceholder':
    'Запрос — что должен делать этот узел. Ссылайтесь на вывод вышестоящего узла через ${nodes.<id>.output}.',
}

describe('P35 leftover wrap collapse #842-#847', () => {
  it('applies every unique leftover wrap on current Russian catalog keys', () => {
    const keys = Object.keys(WRAPPED_RU)
    expect(keys).toHaveLength(6)
    expect(keys).toEqual([...keys].sort())

    for (const key of keys) {
      expect(en[key], key).toBeTruthy()
      expect(ru[key], key).toBe(WRAPPED_RU[key])
      expect(ru[key], key).not.toBe(en[key])
      expect(interpolationVars(ru[key]!), `${key} interpolation`).toEqual(interpolationVars(en[key]!))
      expect(ru[key]!.toLowerCase(), key).not.toContain('промпт')
    }
  })

  it('does not drop #840/#828/#827/#526 connection and settings loadConfig keys', () => {
    for (const key of [
      'connections.create',
      'connections.grant',
      'settings.cloudRuns.loadConfig',
      'settings.messaging.loadConfig',
      'settings.server.loadConfig',
    ]) {
      expect(ru[key], key).toBeTruthy()
      expect(en[key], key).toBeTruthy()
    }
  })
})
