import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const source = readFileSync(join(import.meta.dir, '../CredentialRequest.tsx'), 'utf8')

describe('composer CredentialRequest i18n', () => {
  it('translates placeholders, actions, and the encrypted-at-rest hint', () => {
    expect(source).toContain("t('common.enterField'")
    expect(source).toContain("t('common.save')")
    expect(source).toContain("t('common.cancel')")
    expect(source).toContain("t('chat.credentialsEncrypted')")
    expect(source).toContain("t('auth.bearerToken')")
    expect(source).toContain("t('auth.apiKey')")
    expect(source).toContain("t('auth.username')")
    expect(source).toContain("t('auth.password')")
    expect(source).toContain("t('auth.optionalLeaveBlank')")
    expect(source).not.toContain('Credentials are encrypted at rest')
    expect(source).not.toContain('>Save<')
    expect(source).not.toContain('>Cancel<')
    expect(source).not.toContain('Enter ${')
  })
})
