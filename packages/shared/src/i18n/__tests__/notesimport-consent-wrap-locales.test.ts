import { describe, expect, it } from 'bun:test'
import { setupI18n } from '../setupI18n'

const KEY = 'settings.notesImport.consentLabel'
const RU =
  'Согласен на копирование этих файлов в рабочее пространство (с манифестом происхождения).'
const EN =
  'I consent to copying these files into this workspace (with provenance manifest).'

describe('P35-148 leftover workspace wrapping in settings.notesImport.consentLabel', () => {
  it('changeLanguage(en) keeps English workspace wrapping', async () => {
    const i18n = setupI18n()
    await i18n.changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN)
    expect(i18n.t(KEY)).toMatch(/workspace/i)
  })

  it('changeLanguage(ru) drops leftover воркспейс wrapping', async () => {
    const i18n = setupI18n()
    await i18n.changeLanguage('ru')
    const ru = i18n.t(KEY)
    expect(ru).toBe(RU)
    expect(ru).toMatch(/рабоч/i)
    expect(ru).not.toMatch(/[Вв]оркспейс/)
    expect(ru).not.toMatch(/\bworkspace\b/i)
    expect(ru).not.toBe(EN)
  })
})
