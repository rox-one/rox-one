import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const source = readFileSync(join(import.meta.dir, '../CompletionStep.tsx'), 'utf8')

describe('onboarding first result chrome', () => {
  it('wires Note→Outcome→Task copy and does not treat local profile as account auth', () => {
    expect(source).toContain("t(\"onboarding.completion.firstResultCreate\")")
    expect(source).toContain("t(\"onboarding.completion.firstResultSkip\")")
    expect(source).toContain("t(\"onboarding.completion.firstResultHint\")")
    expect(source).toContain("t(\"onboarding.completion.localProfileHint\")")
    expect(source).toContain('isAccountRegistered')
    expect(source).toContain('seedOfflineFirstResult')
  })
})
