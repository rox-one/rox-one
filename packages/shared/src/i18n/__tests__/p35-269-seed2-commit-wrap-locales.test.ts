import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'memory.seed2'
const LEFTOVER_CALQUE = 'коммить'

describe('P35-269 leftover Russian коммить wrapping on memory.seed2', () => {
  it('wraps leftover коммить as фиксируй from sibling Зафиксировать', async () => {
    await setupI18n().changeLanguage('ru')
    const value = i18n.t(KEY)
    expect(value.toLowerCase()).not.toContain(LEFTOVER_CALQUE)
    expect(value).toBe('Не фиксируй секреты в код')
    expect(value).not.toContain(KEY)
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe('Never commit secrets into code')
    expect(i18n.t(KEY).toLowerCase()).not.toContain(LEFTOVER_CALQUE)
  })
})
