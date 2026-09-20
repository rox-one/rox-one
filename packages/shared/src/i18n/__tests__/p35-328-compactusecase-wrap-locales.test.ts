import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'cli.command.compact.useCase'
const RU_WRAPPED =
  'Сжать историю, чтобы освободить бюджет токенов. Нативный контроль: меню косой черты в поле чата.'
const EN_VALUE =
  'Summarize the conversation to free token budget. Native control: composer slash menu.'

describe('P35-328 leftover Russian слэш wrapping on cli.command.compact.useCase', () => {
  it('wraps leftover слэш-меню as sibling косая черта, then English stays English', async () => {
    await setupI18n().changeLanguage('ru')
    const ru = i18n.t(KEY)
    expect(ru).toBe(RU_WRAPPED)
    expect(ru).toContain('косой черты')
    expect(ru.toLowerCase()).not.toContain('слэш')

    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })
})
