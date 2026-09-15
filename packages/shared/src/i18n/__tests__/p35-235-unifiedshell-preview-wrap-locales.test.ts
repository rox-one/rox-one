import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'settings.unifiedShell.enable'
const LEFTOVER_CALQUE = 'превью'
const PREVIEW_FAMILY = 'предпросмотр'
const PRODUCT_CHROME = 'Единая оболочка'

describe('P35-235 leftover Russian превью wrapping on settings.unifiedShell.enable', () => {
  it('wraps leftover превью as sibling предпросмотр and keeps Единая оболочка', async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.t(KEY)).not.toContain(LEFTOVER_CALQUE)
    expect(i18n.t(KEY)).toContain(PREVIEW_FAMILY)
    expect(i18n.t(KEY)).toContain(PRODUCT_CHROME)
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe('Unified shell (preview)')
    expect(i18n.t(KEY)).toContain('preview')
    expect(i18n.t(KEY)).not.toContain(LEFTOVER_CALQUE)
    expect(i18n.t(KEY)).not.toContain(PREVIEW_FAMILY)
    expect(i18n.t(KEY)).not.toContain(PRODUCT_CHROME)
  })
})
