import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { i18n, setupI18n } from '../setupI18n'

const API_KEY_DESC = 'onboarding.apiSetup.apiKeyDesc' as const
const CHATGPT_DESC = 'onboarding.apiSetup.chatGPTPlusDesc' as const
const COPILOT_DESC = 'onboarding.apiSetup.githubCopilotDesc' as const
const PI_DESC = 'onboarding.apiSetup.piDesc' as const
const LABEL = 'onboarding.apiSetup.craftAgentsBackend' as const

const EN_API_KEY_DESC = 'Use provider presets (Anthropic, OpenAI, Google, etc.) via Rox Backend.'
const EN_CHATGPT_DESC = 'Use your ChatGPT subscription with Rox Backend.'
const EN_COPILOT_DESC = 'Use your GitHub Copilot subscription with Rox Backend.'
const EN_PI_DESC = 'Use Rox Backend as the main agent. Connect via ChatGPT, GitHub Copilot, or an API key.'
const EN_LABEL = 'Rox Backend'

const RU_API_KEY_DESC = 'Используйте пресеты провайдеров (Anthropic, OpenAI, Google и др.) через бэкенд Rox.'
const RU_CHATGPT_DESC = 'Используйте подписку ChatGPT с бэкендом Rox.'
const RU_COPILOT_DESC = 'Используйте подписку GitHub Copilot с бэкендом Rox.'
const RU_PI_DESC = 'Использовать бэкенд Rox в качестве основного агента. Подключение через ChatGPT, GitHub Copilot или ключ API.'

const KEYS = [API_KEY_DESC, CHATGPT_DESC, COPILOT_DESC, PI_DESC] as const
const EN_VALUES = [EN_API_KEY_DESC, EN_CHATGPT_DESC, EN_COPILOT_DESC, EN_PI_DESC] as const
const RU_VALUES = [RU_API_KEY_DESC, RU_CHATGPT_DESC, RU_COPILOT_DESC, RU_PI_DESC] as const

const en = JSON.parse(readFileSync(join(import.meta.dir, '../locales/en.json'), 'utf8')) as Record<string, string>
const ru = JSON.parse(readFileSync(join(import.meta.dir, '../locales/ru.json'), 'utf8')) as Record<string, string>

describe('leftover English Backend wrapping in ru onboarding apiSetup copy', () => {
  it('keeps English catalog copy unchanged', () => {
    for (const [i, key] of KEYS.entries()) {
      expect(en[key]).toBe(EN_VALUES[i])
      expect(en[key]).toContain('Rox Backend')
    }
    expect(en[LABEL]).toBe(EN_LABEL)
  })

  it('wraps leftover Backend as Russian common noun around Latin Rox', () => {
    for (const [i, key] of KEYS.entries()) {
      expect(ru[key]).toBe(RU_VALUES[i])
      expect(ru[key]).not.toMatch(/\bBackend\b/)
      expect(ru[key]).not.toBe(en[key])
    }
    expect(ru[API_KEY_DESC]).toContain('бэкенд Rox')
    expect(ru[CHATGPT_DESC]).toContain('бэкендом Rox')
    expect(ru[COPILOT_DESC]).toContain('бэкендом Rox')
    expect(ru[PI_DESC]).toContain('бэкенд Rox')
    expect(ru[LABEL]).toBe(EN_LABEL)
  })

  it("resolves Russian through setupI18n without leftover English Backend", async () => {
    await setupI18n().changeLanguage('ru')
    for (const [i, key] of KEYS.entries()) {
      expect(i18n.t(key)).toBe(RU_VALUES[i])
      expect(i18n.t(key)).not.toBe(EN_VALUES[i])
      expect(i18n.t(key)).not.toMatch(/\bBackend\b/)
    }
  })

  it('resolves English through setupI18n as the original leftover string', async () => {
    await setupI18n().changeLanguage('en')
    for (const [i, key] of KEYS.entries()) {
      expect(i18n.t(key)).toBe(EN_VALUES[i])
      expect(i18n.t(key)).toContain('Rox Backend')
    }
  })
})
