import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const credentials = readFileSync(join(import.meta.dir, '../CredentialsStep.tsx'), 'utf8')
const localModel = readFileSync(join(import.meta.dir, '../LocalModelStep.tsx'), 'utf8')
const primitives = readFileSync(join(import.meta.dir, '../primitives.tsx'), 'utf8')
const fields = readFileSync(join(import.meta.dir, '../EnvironmentFields.tsx'), 'utf8')

describe('onboarding i18n and empty states', () => {
  it('uses translated API-key hints instead of English literals', () => {
    expect(credentials).toContain("t(\"onboarding.credentials.piApiKeyHint\")")
    expect(credentials).toContain("t(\"onboarding.credentials.anthropicApiKeyHint\")")
    expect(credentials).not.toContain('Select a provider preset and enter the API key')
    expect(credentials).not.toContain('Enter your API key. Optionally configure')
  })

  it('uses common connecting/loading/back/continue keys on onboarding buttons', () => {
    expect(localModel).toContain("t(\"common.connecting\")")
    expect(localModel).not.toContain('Connecting...')
    expect(primitives).toContain("t('common.back')")
    expect(primitives).toContain("t('common.continue')")
    expect(primitives).toContain("t('common.loading')")
    expect(primitives).not.toContain("children = 'Back'")
    expect(primitives).not.toContain("loadingText = 'Loading...'")
    expect(primitives).not.toContain("children = 'Continue'")
  })

  it('uses PremiumMenuSelect for agent-rule labels', () => {
    expect(fields).toContain('PremiumMenuSelect')
    expect(fields).not.toContain('<select')
  })
})
