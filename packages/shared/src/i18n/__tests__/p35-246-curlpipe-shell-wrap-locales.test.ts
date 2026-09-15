import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'pendingSkills.violation.curlPipeShell'
const LEFTOVER_CALQUE = 'шелл'

describe('P35-246 leftover Russian шелл wrapping on pendingSkills.violation.curlPipeShell', () => {
  it('wraps leftover в шелл as sibling в оболочку and keeps curl/wget', async () => {
    await setupI18n().changeLanguage('ru')
    const value = i18n.t(KEY)
    expect(value.toLowerCase()).not.toContain(LEFTOVER_CALQUE)
    expect(value).toContain('в оболочку')
    expect(value).toContain('curl/wget')
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe('curl/wget piped into a shell')
  })
})
