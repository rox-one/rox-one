import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { i18n, setupI18n } from '../setupI18n'

const KEYS = [
  'cli.command.compact.useCase',
  'cli.command.undo.useCase',
  'settings.cloudRuns.enableHint',
  'settings.cloudRuns.scheduleHelp',
] as const

const EN_VALUES: Record<(typeof KEYS)[number], string> = {
  'cli.command.compact.useCase':
    'Summarize the conversation to free token budget. Native control: composer slash menu.',
  'cli.command.undo.useCase': 'Revert the last user turn and restore it to the composer.',
  'settings.cloudRuns.enableHint':
    'Show the cloud chip in the composer and allow background cloud runs',
  'settings.cloudRuns.scheduleHelp':
    'Recurring cloud runs are managed from the Cloud chip dialog in the composer (Schedules section).',
}

const RU_VALUES: Record<(typeof KEYS)[number], string> = {
  'cli.command.compact.useCase':
    'Сжать историю, чтобы освободить бюджет токенов. Нативный контроль: слэш-меню поля чата.',
  'cli.command.undo.useCase': 'Вернуть последний ход пользователя в поле чата.',
  'settings.cloudRuns.enableHint':
    'Показывать чип «Облако» в поле чата и разрешать фоновые облачные запуски',
  'settings.cloudRuns.scheduleHelp':
    'Повторяющиеся облачные запуски настраиваются в диалоге чипа «Облако» в поле чата (секция «Расписания»).',
}

const LEFTOVER_CALQUE = /композер/i
const SIBLING_WRAP = /пол[ея] чата/

const en = JSON.parse(readFileSync(join(import.meta.dir, '../locales/en.json'), 'utf8')) as Record<string, string>
const ru = JSON.parse(readFileSync(join(import.meta.dir, '../locales/ru.json'), 'utf8')) as Record<string, string>

describe('leftover Russian композер wrapping in ru CLI/cloudRuns copy', () => {
  it('keeps English catalog copy unchanged', () => {
    for (const key of KEYS) {
      expect(en[key]).toBe(EN_VALUES[key])
      expect(en[key]).toMatch(/composer/i)
      expect(en[key]).not.toMatch(LEFTOVER_CALQUE)
    }
  })

  it('wraps leftover композер as sibling поле чата on the same family', () => {
    for (const key of KEYS) {
      expect(ru[key]).toBe(RU_VALUES[key])
      expect(ru[key]).not.toMatch(LEFTOVER_CALQUE)
      expect(ru[key]).toMatch(SIBLING_WRAP)
      expect(ru[key]).not.toBe(en[key])
    }
  })

  it("resolves Russian through setupI18n without leftover calque композер", async () => {
    await setupI18n().changeLanguage('ru')
    for (const key of KEYS) {
      expect(i18n.t(key)).toBe(RU_VALUES[key])
      expect(i18n.t(key)).not.toMatch(LEFTOVER_CALQUE)
      expect(i18n.t(key)).toMatch(SIBLING_WRAP)
    }
  })

  it('resolves English through setupI18n as the original leftover string', async () => {
    await setupI18n().changeLanguage('en')
    for (const key of KEYS) {
      expect(i18n.t(key)).toBe(EN_VALUES[key])
      expect(i18n.t(key)).toMatch(/composer/i)
      expect(i18n.t(key)).not.toMatch(LEFTOVER_CALQUE)
      expect(i18n.t(key)).not.toMatch(SIBLING_WRAP)
    }
  })
})
