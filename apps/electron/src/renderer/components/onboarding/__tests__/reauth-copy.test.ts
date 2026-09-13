import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const source = readFileSync(join(import.meta.dir, '../ReauthScreen.tsx'), 'utf8')

describe('reauth copy hides Craft', () => {
  it('uses i18n fallbacks instead of hardcoded Craft or English login errors', () => {
    expect(source).toContain("t('onboarding.reauth.loginFailed')")
    expect(source).not.toContain("'Login failed'")
    expect(source).not.toContain('"Login failed"')
    expect(source).not.toMatch(/Craft token/)
    expect(source).toContain("t(\"onboarding.reauth.loginWithCraft\")")
  })
})
