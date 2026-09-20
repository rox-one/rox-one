import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'settings.runtime.llmConnectionsDesc'
const RU_WRAPPED = 'Подключения, модели и поставщики настраиваются в настройках ИИ.'
const EN_VALUE = 'Connections, models, and providers are configured in AI settings.'

describe('P35-314 leftover Russian провайдер wrapping on settings.runtime.llmConnectionsDesc', () => {
  it('wraps leftover провайдеры as sibling поставщики, then English stays English', async () => {
    await setupI18n().changeLanguage('ru')
    const ru = i18n.t(KEY)
    expect(ru).toBe(RU_WRAPPED)
    expect(ru.toLowerCase()).not.toContain('провайдер')

    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })
})
