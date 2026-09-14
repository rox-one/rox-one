import { describe, expect, it } from 'bun:test'
import { setupI18n } from '../setupI18n'

const KEYS = [
  'settings.cloudRuns.cheapModelHint',
  'settings.cloudRuns.everyHoursHelp',
] as const

describe('P35-124 leftover cloudRuns wrapping in settings ru.json', () => {
  it('changeLanguage(en) keeps English landscape / everyHours wrapping', async () => {
    const i18n = setupI18n()
    await i18n.changeLanguage('en')
    expect(i18n.t('settings.cloudRuns.cheapModelHint')).toBe(
      'Draft subtasks (landscape, alternatives) run on this model id; empty = all on main model',
    )
    expect(i18n.t('settings.cloudRuns.everyHoursHelp')).toBe(
      'everyHours means “every N hours” from the last fire (not cron). Example: 24 = once a day.',
    )
    expect(i18n.t('settings.cloudRuns.cheapModelHint')).toMatch(/landscape/)
    expect(i18n.t('settings.cloudRuns.everyHoursHelp')).toMatch(/everyHours/)
  })

  it('changeLanguage(ru) drops leftover English wrapping', async () => {
    const i18n = setupI18n()
    await i18n.changeLanguage('ru')
    expect(i18n.t('settings.cloudRuns.cheapModelHint')).toBe(
      'Черновые сабтаски (общая карта темы, альтернативы и сравнения) пойдут этой моделью; пусто = всё на основной',
    )
    expect(i18n.t('settings.cloudRuns.everyHoursHelp')).toBe(
      '«Каждые N часов» — от последнего срабатывания (не cron). Пример: 24 = раз в сутки.',
    )
    for (const key of KEYS) {
      const ru = i18n.t(key)
      expect(ru).not.toMatch(/\blandscape\b/)
      expect(ru).not.toMatch(/\balternatives\b/)
      expect(ru).not.toMatch(/\beveryHours\b/)
      expect(ru).not.toBe(i18n.t(key, { lng: 'en' }))
    }
  })
})
