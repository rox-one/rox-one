import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'cloudRuns.personasHint'
const LEFTOVER_CALQUE = 'сабтаск'
const SIBLING_SUBTASK = 'подзадачу'

describe('P35-250 leftover Russian сабтаск wrapping on cloudRuns.personasHint', () => {
  it('wraps leftover каждый сабтаск as sibling каждую подзадачу', async () => {
    await setupI18n().changeLanguage('ru')
    const value = i18n.t(KEY)
    expect(value.toLowerCase()).not.toContain(LEFTOVER_CALQUE)
    expect(value).toContain(SIBLING_SUBTASK)
    expect(value).toContain('Аналитик')
    expect(value).toContain('дольше')
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(
      'Analyst · skeptic · optimist on every subtask (slower, deeper)',
    )
  })
})
