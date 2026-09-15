import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'cli.command.vibe.useCase'
const LEFTOVER_CALQUE = 'слэш'
const SIBLING_SLASH = 'косая черта'

describe('P35-254 leftover Russian слэш wrapping on cli.command.vibe.useCase', () => {
  it('wraps leftover слэш as sibling косая черта', async () => {
    await setupI18n().changeLanguage('ru')
    const value = i18n.t(KEY)
    expect(value.toLowerCase()).not.toContain(LEFTOVER_CALQUE)
    expect(value.toLowerCase()).toContain(SIBLING_SLASH)
    expect(value).toBe(
      'Творческий сценарий Rox CLI. Нативный контроль: Настройки → Расширения; косая черта вторична.',
    )
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(
      'Creative Rox CLI workflow. Native control: Settings → Extensions; slash is secondary.',
    )
    expect(i18n.t(KEY).toLowerCase()).not.toContain(LEFTOVER_CALQUE)
    expect(i18n.t(KEY).toLowerCase()).not.toContain(SIBLING_SLASH)
  })
})
