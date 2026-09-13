import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const source = readFileSync(join(import.meta.dir, '../AuthRequestCard.tsx'), 'utf8')

describe('AuthRequestCard i18n', () => {
  it('translates chrome, oauth actions, and encrypted-at-rest hint', () => {
    expect(source).toContain("t('auth.authenticationRequired')")
    expect(source).toContain("t('auth.signInWith'")
    expect(source).toContain("t('auth.sourceConnected'")
    expect(source).toContain("t('auth.sourceCancelled'")
    expect(source).toContain("t('auth.sourceFailed'")
    expect(source).toContain("t('auth.signedInAs'")
    expect(source).toContain("t('auth.authenticating'")
    expect(source).toContain("t('auth.completeInBrowser')")
    expect(source).toContain("t('chat.credentialsEncrypted')")
    expect(source).toContain("t('common.save')")
    expect(source).toContain("t('common.saving')")
    expect(source).toContain("t('common.cancel')")
    expect(source).not.toContain('`${authSourceName} Authentication`')
    expect(source).not.toContain('`${authSourceName} Connected`')
    expect(source).not.toContain('Sign in with ${')
    expect(source).not.toContain('Credentials are encrypted at rest')
    expect(source).not.toContain("'Saving...'")
    expect(source).not.toContain("label: 'Cancel'")
    expect(source).not.toContain('Complete authentication in your browser')
  })
})
