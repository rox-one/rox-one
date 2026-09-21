import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'onboarding.credentials.piApiKeyHint'
const RU_WRAPPED =
  'Выберите пресет провайдера и введите API-ключ. Для произвольных Anthropic-совместимых конечных точек используйте режим «Ключ Anthropic API».'
const EN_VALUE =
  'Select a provider preset and enter the API key. For arbitrary Anthropic-compatible endpoints, use Anthropic API Key mode.'

describe('P35-391 leftover Russian API Key wrapping on onboarding.credentials.piApiKeyHint', () => {
  it('wraps leftover API Key as sibling Ключ Anthropic API, then English stays English', async () => {
    await setupI18n().changeLanguage('ru')
    const ru = i18n.t(KEY)
    expect(ru).toBe(RU_WRAPPED)
    expect(ru).toContain('Ключ Anthropic API')
    expect(ru).not.toContain('Anthropic API Key')
    expect(ru).not.toContain('API Key')

    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
    expect(i18n.t(KEY)).toContain('Anthropic API Key')
    expect(i18n.t(KEY)).not.toContain('Ключ Anthropic API')
  })
})
