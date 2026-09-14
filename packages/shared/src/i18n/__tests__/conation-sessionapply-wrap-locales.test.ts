import { describe, expect, it } from 'bun:test'
import { setupI18n, i18n } from '../setupI18n'

const KEYS = [
  'settings.appearance.conationSessionApply',
  'settings.appearance.conationSessionApplyDesc',
] as const

const CYRILLIC = /[А-Яа-яЁё]/
const INVENTED_SESSIONAPPLY_NOUN = /сессиопримен|применение сессии|сессия-примен/i

describe('P35-132 leftover SessionApply wrapping in ru appearance copy', () => {
  it("changeLanguage('ru') wraps in Russian and keeps SessionApply/Conation identifiers", async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.t('settings.appearance.conationSessionApply')).toBe(
      'Заглушка SessionApply (Conation)',
    )
    expect(i18n.t('settings.appearance.conationSessionApplyDesc')).toBe(
      'Заглушка SessionApply, связанная с AgentTeamsStore (workbench.conation.sessionApply). По умолчанию выкл. Не Cordis.',
    )
    for (const key of KEYS) {
      const value = String(i18n.t(key))
      expect(value, key).toMatch(CYRILLIC)
      expect(value, key).toContain('SessionApply')
      expect(value, key).not.toMatch(INVENTED_SESSIONAPPLY_NOUN)
    }
    expect(i18n.t('settings.appearance.conationSessionApply')).toContain('Conation')
    expect(i18n.t('settings.appearance.conationSessionApplyDesc')).toContain(
      'workbench.conation.sessionApply',
    )
  })

  it("changeLanguage('en') still uses English SessionApply wrapping", async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t('settings.appearance.conationSessionApply')).toBe('SessionApply (Conation)')
    expect(i18n.t('settings.appearance.conationSessionApplyDesc')).toBe(
      'SessionApply consumer stub linked to AgentTeamsStore (workbench.conation.sessionApply). Default off. Not Cordis.',
    )
    for (const key of KEYS) {
      const value = String(i18n.t(key))
      expect(value, key).toContain('SessionApply')
      expect(value, key).not.toMatch(CYRILLIC)
    }
  })
})
