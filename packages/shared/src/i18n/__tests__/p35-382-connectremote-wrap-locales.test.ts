import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'workspace.connectRemoteDesc'
const RU_WRAPPED = 'Использовать удалённый сервер Rox.'
const EN_VALUE = 'Use a remote Rox server.'

describe('P35-382 leftover Russian Server wrapping on workspace.connectRemoteDesc', () => {
  it('wraps leftover Rox Server as sibling сервер Rox, then English stays English', async () => {
    await setupI18n().changeLanguage('ru')
    const ru = i18n.t(KEY)
    expect(ru).toBe(RU_WRAPPED)
    expect(ru).toContain('сервер Rox')
    expect(ru).toContain('Rox')
    expect(ru).not.toContain('Rox Server')
    expect(ru).not.toMatch(/\bServer\b/)

    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
    expect(i18n.t(KEY)).toContain('Rox server')
    expect(i18n.t(KEY)).not.toContain('сервер Rox')
  })
})
