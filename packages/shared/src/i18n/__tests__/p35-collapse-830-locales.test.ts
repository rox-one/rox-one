import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const localesDirectory = join(import.meta.dir, '../locales')
const en = JSON.parse(readFileSync(join(localesDirectory, 'en.json'), 'utf8')) as Record<string, string>
const ru = JSON.parse(readFileSync(join(localesDirectory, 'ru.json'), 'utf8')) as Record<string, string>

function interpolationVars(value: string): string[] {
  return (value.match(/\{\{(\w+)\}\}/g) ?? []).map((m) => m.replace(/[{}]/g, '')).sort()
}

/** Collapsed leftover wraps from open fix(i18n) drafts #830–#839. One assertion map, not 10 PRs. */
const WRAPPED_RU: Record<string, string> = {
  'automations.emptyDescription':
    'Автоматизации выполняют действия при наступлении событий — запускают команды по расписанию, реагируют на изменения меток или автоматически вызывают запросы.',
  'entityView.mapComposeLabel': 'Запрос',
  'entityView.workbenchPrompt': 'Запрос',
  'kanban.column.autoPrompt': 'Авто-запрос',
  'kanban.column.autoPromptPlaceholder': 'Запрос при переносе карточки сюда…',
  'knowledge.local.aiPrompts': 'Запросы ИИ для заметок',
  'knowledge.local.promptsSaved': 'Запросы сохранены',
  'knowledge.local.savePrompts': 'Сохранить запросы',
  'notes.sideSession.hint': 'Проверьте запрос и отправьте, когда будете готовы. Заметка остаётся открытой.',
  'notes.sideSession.promptPlaceholder': 'Запрос для агента…',
}

describe('P35 leftover wrap collapse #830-#839', () => {
  it('applies every unique leftover wrap on current Russian catalog keys', () => {
    const keys = Object.keys(WRAPPED_RU)
    expect(keys).toHaveLength(10)
    expect(keys).toEqual([...keys].sort())

    for (const key of keys) {
      expect(en[key], key).toBeTruthy()
      expect(ru[key], key).toBe(WRAPPED_RU[key])
      expect(ru[key], key).not.toBe(en[key])
      expect(interpolationVars(ru[key]!), `${key} interpolation`).toEqual(interpolationVars(en[key]!))
      expect(ru[key]!.toLowerCase(), key).not.toContain('промпт')
    }
  })

  it('does not drop #828/#827/#526 connection and settings loadConfig keys', () => {
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
