import { describe, expect, it } from 'bun:test'
import { setupI18n } from '../setupI18n'

const KEYS = [
  'security.acceptance.description',
  'security.confirm.currentWorkspace',
  'security.error.noWorkspace',
  'security.hostControls.description',
] as const

const RU: Record<(typeof KEYS)[number], string> = {
  'security.acceptance.description':
    'Объясните, почему этот риск приемлем для этого рабочего пространства.',
  'security.confirm.currentWorkspace': 'Текущее рабочее пространство',
  'security.error.noWorkspace': 'Рабочее пространство не выбрано',
  'security.hostControls.description':
    'Хост-управление OpenClaw для этого рабочего пространства.',
}

const EN: Record<(typeof KEYS)[number], string> = {
  'security.acceptance.description':
    'Explain why this risk is acceptable for this workspace.',
  'security.confirm.currentWorkspace': 'Current workspace',
  'security.error.noWorkspace': 'No workspace selected',
  'security.hostControls.description': 'OpenClaw host controls for this workspace.',
}

describe('P35-142 leftover workspace wrapping in security ru.json', () => {
  it('changeLanguage(en) keeps English workspace wrapping', async () => {
    const i18n = setupI18n()
    await i18n.changeLanguage('en')
    for (const key of KEYS) {
      expect(i18n.t(key)).toBe(EN[key])
      expect(i18n.t(key)).toMatch(/workspace/i)
    }
    expect(i18n.t('security.confirm.scope')).toBe('{{action}} in {{workspace}}')
  })

  it('changeLanguage(ru) drops leftover Воркспейс wrapping', async () => {
    const i18n = setupI18n()
    await i18n.changeLanguage('ru')
    for (const key of KEYS) {
      const ru = i18n.t(key)
      expect(ru).toBe(RU[key])
      expect(ru).toMatch(/рабоч/i)
      expect(ru).not.toMatch(/[Вв]оркспейс/)
      expect(ru).not.toMatch(/\bworkspace\b/i)
      expect(ru).not.toBe(EN[key])
    }
    expect(i18n.t('security.confirm.scope')).toBe('{{action}} в {{workspace}}')
    expect(i18n.t('security.confirm.copySetupCredential.detail')).toContain('{{workspaceId}}')
    expect(i18n.t('security.confirm.openControlUi.detail')).toContain('{{workspaceId}}')
  })
})
