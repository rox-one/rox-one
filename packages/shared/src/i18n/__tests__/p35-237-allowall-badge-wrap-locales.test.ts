import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'cli.command.allowAll.useCase'
const LEFTOVER_CALQUE = 'бейдж'
const SIBLING_CHROME = 'значок'
const NATIVE_KEEP = 'Нативный контроль'

describe('P35-237 leftover Russian бейдж wrapping on cli.command.allowAll.useCase', () => {
  it('wraps leftover бейдж as sibling значок and keeps Нативный контроль', async () => {
    await setupI18n().changeLanguage('ru')
    const value = i18n.t(KEY)
    expect(value).not.toContain(LEFTOVER_CALQUE)
    expect(value).toContain(SIBLING_CHROME)
    expect(value).toContain(NATIVE_KEEP)
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe('Run tools without asking. Native control: permission badge.')
    expect(i18n.t(KEY)).not.toContain(LEFTOVER_CALQUE)
    expect(i18n.t(KEY)).not.toContain(SIBLING_CHROME)
  })
})
