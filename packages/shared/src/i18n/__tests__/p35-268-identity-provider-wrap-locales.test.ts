import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'settings.identity.description'
const LEFTOVER_CALQUE = 'провайдер'
const KEPT_RUNTIME = 'рантайма'

describe('P35-268 leftover Russian провайдера wrapping on settings.identity.description', () => {
  it('wraps leftover и провайдера as и поставщика and keeps рантайма', async () => {
    await setupI18n().changeLanguage('ru')
    const value = i18n.t(KEY)
    expect(value.toLowerCase()).not.toContain(LEFTOVER_CALQUE)
    expect(value).toContain(KEPT_RUNTIME)
    expect(value).toBe(
      'Имя и персона, которые используются в новых сессиях. Имена рантайма и поставщика остаются в технических деталях.',
    )
    expect(value).not.toContain(KEY)
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(
      'Name and persona used on new sessions. Runtime and provider names stay in technical detail.',
    )
    expect(i18n.t(KEY).toLowerCase()).not.toContain(LEFTOVER_CALQUE)
  })
})
