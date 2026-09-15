import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { i18n, setupI18n } from '../setupI18n'

const KEYS = [
  'apiSetup.defaultModelRequired',
  'model.roxExploreDesc',
  'model.roxFastDesc',
  'model.roxMaxDesc',
  'model.roxStandardDesc',
  'model.roxVisionDesc',
  'sourceInfo.apiEndpointsAllowed',
] as const

const EN_VALUES: Record<(typeof KEYS)[number], string> = {
  'apiSetup.defaultModelRequired': 'Default model is required for custom endpoints.',
  'model.roxExploreDesc': 'Cheap exploration endpoint',
  'model.roxFastDesc': 'Lower-tier endpoint for subagents and cheap turns',
  'model.roxMaxDesc': '1M-context endpoint; no silent context downgrade',
  'model.roxStandardDesc': 'Default coding endpoint',
  'model.roxVisionDesc': 'Multimodal endpoint',
  'sourceInfo.apiEndpointsAllowed': 'API endpoints allowed in Explore mode.',
}

const RU_VALUES: Record<(typeof KEYS)[number], string> = {
  'apiSetup.defaultModelRequired': 'Для пользовательских конечных точек требуется модель по умолчанию.',
  'model.roxExploreDesc': 'Дешёвая конечная точка для исследования',
  'model.roxFastDesc': 'Более дешёвая конечная точка для субагентов и коротких ходов',
  'model.roxMaxDesc': 'Конечная точка с контекстом 1M; без тихого понижения контекста',
  'model.roxStandardDesc': 'Конечная точка по умолчанию для кода',
  'model.roxVisionDesc': 'Мультимодальная конечная точка',
  'sourceInfo.apiEndpointsAllowed': 'Конечные точки API, разрешённые в режиме исследования.',
}

const LEFTOVER_CALQUE = /эндпоинт/i

const en = JSON.parse(readFileSync(join(import.meta.dir, '../locales/en.json'), 'utf8')) as Record<string, string>
const ru = JSON.parse(readFileSync(join(import.meta.dir, '../locales/ru.json'), 'utf8')) as Record<string, string>

describe('leftover Russian эндпоинт wrapping in ru endpoint copy', () => {
  it('keeps English catalog copy unchanged', () => {
    for (const key of KEYS) {
      expect(en[key]).toBe(EN_VALUES[key])
      expect(en[key]).toMatch(/endpoint/i)
      expect(en[key]).not.toMatch(LEFTOVER_CALQUE)
    }
  })

  it('wraps leftover эндпоинт as sibling конечная точка on the same family', () => {
    for (const key of KEYS) {
      expect(ru[key]).toBe(RU_VALUES[key])
      expect(ru[key]).not.toMatch(LEFTOVER_CALQUE)
      expect(ru[key]).toContain('конечн')
      expect(ru[key]).not.toBe(en[key])
    }
  })

  it("resolves Russian through setupI18n without leftover calque эндпоинт", async () => {
    await setupI18n().changeLanguage('ru')
    for (const key of KEYS) {
      expect(i18n.t(key)).toBe(RU_VALUES[key])
      expect(i18n.t(key)).not.toMatch(LEFTOVER_CALQUE)
      expect(i18n.t(key)).toContain('конечн')
    }
  })

  it('resolves English through setupI18n as the original leftover string', async () => {
    await setupI18n().changeLanguage('en')
    for (const key of KEYS) {
      expect(i18n.t(key)).toBe(EN_VALUES[key])
      expect(i18n.t(key)).toMatch(/endpoint/i)
      expect(i18n.t(key)).not.toMatch(LEFTOVER_CALQUE)
      expect(i18n.t(key)).not.toContain('конечн')
    }
  })
})
