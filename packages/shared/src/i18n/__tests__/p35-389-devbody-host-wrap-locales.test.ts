import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'extensions.developer.body'
const RU_WRAPPED =
  'Для каждой рабочей области хост расширений запускает модули craft-sandbox в изолированном процессе. Здесь задаётся список разрешённых URL для network.request. Плагины SiYuan в этом хосте расширений не выполняются.'
const EN_VALUE =
  'Per-workspace Extension Hosts run craft-sandbox modules in a utilityProcess. Configure network.request URL allowlists here. SiYuan plugins are never executed in the host.'

describe('P35-389 leftover Russian хост wrapping on extensions.developer.body', () => {
  it('wraps leftover в этом хосте as sibling в этом хосте расширений, then English stays English', async () => {
    await setupI18n().changeLanguage('ru')
    const ru = i18n.t(KEY)
    expect(ru).toBe(RU_WRAPPED)
    expect(ru).toContain('в этом хосте расширений')
    expect(ru).not.toContain('в этом хосте не')
    expect(ru).toContain('хост расширений')

    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
    expect(i18n.t(KEY)).toContain('Extension Hosts')
    expect(i18n.t(KEY)).not.toContain('в этом хосте расширений')
  })
})
