import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { visibleError } from '../onboarding-visible-error'

const source = readFileSync(join(import.meta.dir, '../useOnboarding.ts'), 'utf8')

const ERROR_KEYS = [
  'onboarding.errors.apiKeyRequired',
  'onboarding.errors.authCodeRequired',
  'onboarding.errors.chatgptAuthFailed',
  'onboarding.errors.connectFailed',
  'onboarding.errors.connectionTestFailed',
  'onboarding.errors.exchangeFailed',
  'onboarding.errors.githubAuthFailed',
  'onboarding.errors.invalidPath',
  'onboarding.errors.oauthFailed',
  'onboarding.errors.oauthNotSupported',
  'onboarding.errors.oauthStartFailed',
  'onboarding.errors.roxConnectFailed',
  'onboarding.errors.roxConnectIncomplete',
  'onboarding.errors.saveConfigFailed',
  'onboarding.errors.saveKeyFailed',
  'onboarding.errors.selectAuthMethod',
  'onboarding.errors.validationFailed',
] as const

describe('onboarding error copy is i18n', () => {
  it('uses onboarding.errors keys instead of hardcoded English fallbacks', () => {
    for (const key of ERROR_KEYS) {
      expect(source).toContain(`t('${key}')`)
    }
    expect(source).not.toContain("'Failed to save configuration'")
    expect(source).not.toContain("'Please enter a valid API key'")
    expect(source).not.toContain("'Connection test failed'")
    expect(source).not.toContain("'Validation failed'")
    expect(source).not.toContain("'Select an authentication method first.'")
    expect(source).not.toContain("'ChatGPT authentication failed'")
    expect(source).not.toContain("'GitHub authentication failed'")
    expect(source).not.toContain("'This connection uses API keys, not OAuth.'")
    expect(source).not.toContain("'Failed to start OAuth'")
    expect(source).not.toContain("'OAuth failed'")
    expect(source).not.toContain("'Please enter the authorization code'")
    expect(source).not.toContain("'Failed to exchange code'")
    expect(source).not.toContain("'Failed to save Rox API key'")
    expect(source).not.toContain("'Invalid path'")
    expect(source).not.toContain("'Failed to start Rox Connect'")
    expect(source).not.toContain("'Rox Connect returned an incomplete device payload'")
    expect(source).not.toContain("'Connect failed'")
  })
})

describe('visibleError', () => {
  it('keeps non-leaking backend messages', () => {
    expect(visibleError('timeout after 5s', 'fallback')).toBe('timeout after 5s')
  })

  it('replaces empty, whitespace, and OMP/Craft leaks', () => {
    expect(visibleError(undefined, 'fallback')).toBe('fallback')
    expect(visibleError('', 'fallback')).toBe('fallback')
    expect(visibleError('   ', 'fallback')).toBe('fallback')
    expect(visibleError('Failed to create OMP connection', 'fallback')).toBe('fallback')
    expect(visibleError('check oh-my-pi CLI', 'fallback')).toBe('fallback')
    expect(visibleError('Craft Agents token expired', 'fallback')).toBe('fallback')
  })
})
