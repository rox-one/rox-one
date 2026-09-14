import { describe, expect, it } from 'bun:test'
import { setupI18n } from '../setupI18n'
import i18n from 'i18next'

const KEYS = [
  'cloudRuns.fork',
  'settings.cloudRuns.maxWallClockHint',
] as const

const ENGLISH = {
  'cloudRuns.fork': 'Fork (deeper dive)',
  'settings.cloudRuns.maxWallClockHint': 'Wall-clock budget per run; watchdog kills the run past it',
} as const

const RUSSIAN = {
  'cloudRuns.fork': 'Форк (углубление)',
  'settings.cloudRuns.maxWallClockHint': 'Бюджет реального времени рана; watchdog убьёт ран по превышении',
} as const

describe('cloudRuns leftover fork/wall-clock chrome', () => {
  it('Russian copy drops leftover English; English stays English', async () => {
    await setupI18n().changeLanguage('ru')
    for (const key of KEYS) {
      expect(i18n.t(key)).toBe(RUSSIAN[key])
      expect(i18n.t(key)).not.toBe(ENGLISH[key])
    }
    expect(i18n.t('cloudRuns.fork')).not.toMatch(/\bFork\b/)
    expect(i18n.t('settings.cloudRuns.maxWallClockHint')).not.toMatch(/Wall-clock/)

    await setupI18n().changeLanguage('en')
    for (const key of KEYS) {
      expect(i18n.t(key)).toBe(ENGLISH[key])
    }

    await setupI18n().changeLanguage('ru')
  })
})
