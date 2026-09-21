import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'workspace.connectRemotePageDesc'
const RU_WRAPPED = 'Подключиться к удалённому серверу Rox для этой рабочей области.'
const EN_VALUE = 'Connect to a remote Rox server for this workspace.'

describe('P35-383 leftover Russian Server wrapping on workspace.connectRemotePageDesc', () => {
  it('wraps leftover Rox Server as sibling сервер Rox, then English stays English', async () => {
    await setupI18n().changeLanguage('ru')
    const ru = i18n.t(KEY)
    expect(ru).toBe(RU_WRAPPED)
    expect(ru).toContain('сервер Rox')
    expect(ru).toContain('Rox')
    expect(ru).toContain('рабочей области')
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
