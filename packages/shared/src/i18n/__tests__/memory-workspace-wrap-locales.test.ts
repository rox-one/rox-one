import { describe, expect, it } from 'bun:test'
import { setupI18n } from '../setupI18n'

const KEYS = ['memory.promotionBanner', 'memory.promotionWorkspaces'] as const

const RU: Record<(typeof KEYS)[number], string> = {
  'memory.promotionBanner':
    'Правила используются в нескольких рабочих пространствах ({{count}})',
  'memory.promotionWorkspaces': 'рабочих пространств: {{count}}',
}

const EN: Record<(typeof KEYS)[number], string> = {
  'memory.promotionBanner': 'Rules used in multiple workspaces ({{count}})',
  'memory.promotionWorkspaces': 'workspaces: {{count}}',
}

describe('P35-143 leftover workspace wrapping in memory ru.json', () => {
  it('changeLanguage(en) keeps English workspace wrapping', async () => {
    const i18n = setupI18n()
    await i18n.changeLanguage('en')
    for (const key of KEYS) {
      expect(i18n.t(key)).toBe(EN[key])
      expect(i18n.t(key)).toMatch(/workspace/i)
      expect(i18n.t(key)).toContain('{{count}}')
    }
  })

  it('changeLanguage(ru) drops leftover Воркспейс wrapping', async () => {
    const i18n = setupI18n()
    await i18n.changeLanguage('ru')
    for (const key of KEYS) {
      const ru = i18n.t(key)
      expect(ru).toBe(RU[key])
      expect(ru).toMatch(/рабоч/i)
      expect(ru).toContain('{{count}}')
      expect(ru).not.toMatch(/[Вв]оркспейс/)
      expect(ru).not.toMatch(/\bworkspace\b/i)
      expect(ru).not.toBe(EN[key])
    }
  })
})
