import { describe, expect, it } from 'bun:test'
import { setupI18n, i18n } from '../setupI18n'

const KEYS = [
  'conation.notes.off',
  'settings.appearance.conationNotesBridge',
  'settings.appearance.conationNotesBridgeDesc',
] as const

const ENGLISH_NOTES_WRAP = /\bNotes\b/

describe('P35-131 leftover Notes wrapping in ru conation notes copy', () => {
  it("changeLanguage('ru') uses Заметки and drops leftover English Notes wrapping", async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.t('conation.notes.off')).toBe('Conation Заметки отключены.')
    expect(i18n.t('settings.appearance.conationNotesBridge')).toBe('Мост Заметки')
    expect(i18n.t('settings.appearance.conationNotesBridgeDesc')).toBe(
      'Мост Conation Заметки только для чтения (workbench.conation.notesBridge). По умолчанию выкл.',
    )
    for (const key of KEYS) {
      const value = String(i18n.t(key))
      expect(value, key).toContain('Заметки')
      expect(value, key).not.toMatch(ENGLISH_NOTES_WRAP)
    }
  })

  it("changeLanguage('en') still uses English Notes wrapping", async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t('conation.notes.off')).toBe('Conation Notes is off.')
    expect(i18n.t('settings.appearance.conationNotesBridge')).toBe('Notes bridge')
    expect(i18n.t('settings.appearance.conationNotesBridgeDesc')).toBe(
      'Read-only Conation Notes bridge (workbench.conation.notesBridge). Default off.',
    )
    for (const key of KEYS) {
      expect(String(i18n.t(key)), key).toMatch(ENGLISH_NOTES_WRAP)
    }
  })
})
