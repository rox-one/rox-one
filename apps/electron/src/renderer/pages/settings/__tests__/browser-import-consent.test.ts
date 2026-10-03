import { describe, expect, it } from 'bun:test'
import { browserImportConsent, browserImportProfileSelection } from '../browser-import-consent'
import { BROWSER_IMPORT_CATEGORIES } from '@craft-agent/shared/environment'

describe('per-profile browser import scopes', () => {
  it('imports selected history and bookmarks before any cookie domains have been granted', () => {
    const consent = browserImportConsent(BROWSER_IMPORT_CATEGORIES, 'chromium', [])
    expect(consent.historyBookmarks).toBe(true)
    expect(consent.history).toBe(true)
    expect(consent.bookmarks).toBe(true)
    expect(consent.cookies).toBe(false)
    expect(consent.osCredentialsApproved).toBe(false)
  })

  it.each(['firefox', 'safari'] as const)('keeps non-sensitive %s import available without claiming cookie support', (family) => {
    const consent = browserImportConsent(BROWSER_IMPORT_CATEGORIES, family, ['example.com'])
    expect(consent.historyBookmarks).toBe(true)
    expect(consent.cookies).toBe(false)
    expect(consent.credentials).toBe(true)
    expect(consent.osCredentialsApproved).toBe(false)
  })

  it('requests only selected cookie scopes and preserves explicit opt-outs', () => {
    expect(browserImportConsent(['cookies'], 'chromium', ['example.com']).cookies).toBe(true)
    const consent = browserImportConsent(['history'], 'chromium', ['example.com'])
    expect(consent.cookies).toBe(false)
    expect(consent.bookmarks).toBe(false)
    expect(consent.history).toBe(true)
  })
})

describe('browser profile selection across workspaces', () => {
  it('replaces the prior selection with the current workspace authorized profile', () => {
    expect(browserImportProfileSelection('workspace-b', 'chromium:profile-a', {
      workspaceId: 'workspace-b', enabled: true, profileId: 'firefox:profile-b',
    }, null)).toBe('firefox:profile-b')
  })

  it('ignores a late status response from a previous workspace', () => {
    expect(browserImportProfileSelection('workspace-b', 'firefox:profile-b', {
      workspaceId: 'workspace-a', enabled: true, profileId: 'chromium:profile-a',
    }, null)).toBe('firefox:profile-b')
  })

  it('keeps independent cookie consent while resetting an unbound workspace selection', () => {
    expect(browserImportProfileSelection('workspace-b', null, null, { consent: true, profileId: 'chromium:cookies' })).toBe('chromium:cookies')
    expect(browserImportProfileSelection('workspace-b', null, null, { consent: false })).toBeNull()
    expect(browserImportProfileSelection('workspace-b', 'chromium:manual', null, { consent: false })).toBe('chromium:manual')
  })
})
