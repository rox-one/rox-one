import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const source = readFileSync(join(import.meta.dir, '../ReauthScreen.tsx'), 'utf8')

describe('ReauthScreen i18n', () => {
  it('uses the loginFailed key instead of hardcoded English', () => {
    expect(source).toContain("t('onboarding.reauth.loginFailed')")
    expect(source).not.toContain("'Login failed'")
    expect(source).not.toContain('CraftAgentsSymbol')
  })
})
