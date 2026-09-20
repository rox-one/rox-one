import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'cloudRuns.topicHelp'
const RU_WRAPPED = 'Тема — бриф исследования, который уходит в облачный запуск.'
const EN_VALUE = 'Topic is the research brief sent to the cloud runner.'

describe('P35-329 leftover Russian ран wrapping on cloudRuns.topicHelp', () => {
  it('wraps leftover раннер as sibling запуск, then English stays English', async () => {
    await setupI18n().changeLanguage('ru')
    const ru = i18n.t(KEY)
    expect(ru).toBe(RU_WRAPPED)
    expect(ru).toContain('запуск')
    expect(ru).not.toContain('раннер')
    expect(ru.toLowerCase()).not.toContain('раннер')

    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })
})
