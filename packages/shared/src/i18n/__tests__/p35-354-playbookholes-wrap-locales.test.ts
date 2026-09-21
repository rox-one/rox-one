import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'entityView.playbookHoles'
const RU_WRAPPED = 'Дыры сценария'
const EN_VALUE = 'Playbook holes'

describe('P35-354 leftover Russian плейбук wrapping on entityView.playbookHoles', () => {
  it('wraps leftover плейбука as sibling сценария, then English stays English', async () => {
    await setupI18n().changeLanguage('ru')
    const ru = i18n.t(KEY)
    expect(ru).toBe(RU_WRAPPED)
    expect(ru.toLowerCase()).toContain('сценария')
    expect(ru.toLowerCase()).not.toContain('плейбук')

    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
    expect(i18n.t(KEY).toLowerCase()).not.toContain('плейбук')
    expect(i18n.t(KEY).toLowerCase()).not.toContain('сценария')
  })
})
