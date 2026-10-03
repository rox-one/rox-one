import { afterAll, describe, expect, mock, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

if (process.env.ROX_COOKIE_CONSENT_ISOLATED === '1') {
const root = mkdtempSync(join(tmpdir(), 'rox-cookie-consent-'))
const cookies: Array<{ domain: string; name: string; path: string; secure: boolean }> = []
let refuseRemoval = false
mock.module('@rox/shared/config', () => ({ CONFIG_DIR: root, resolveConfigDir: () => root }))
mock.module('electron', () => ({ session: { fromPartition(partition: string) {
  if (partition !== 'persist:browser-cookie-import') throw Error('unexpected partition')
  return { cookies: {
    get: async ({ domain }: { domain: string }) => cookies.filter(cookie => cookie.domain.replace(/^\./, '') === domain),
    remove: async (url: string, name: string) => { if (refuseRemoval) return; const domain = new URL(url).hostname; const at = cookies.findIndex(cookie => cookie.domain.replace(/^\./, '') === domain && cookie.name === name); if (at >= 0) cookies.splice(at, 1) },
    flushStore: async () => {},
  } }
} } }))
const { BrowserCookieAutoImporter } = await import('../browser-cookie-auto-import')
const { loadPrivacyState } = await import('@rox/shared/privacy')
class FixtureImporter extends BrowserCookieAutoImporter {
  override run() { return Promise.resolve(this.status()) }
}
const importer = new FixtureImporter(id => ({ profile: id ? { id, family: 'chromium', path: '/fixture/profile', name: 'Fixture', lastUsedAt: null, recommended: false, state: 'ok' } : null, browsers: [] }))
afterAll(() => rmSync(root, { recursive: true, force: true }))
describe('cookie consent scope reduction', () => {
  test('removes excluded exact-domain cookies, preserves other cookies, and revokes old profile on switch', async () => {
    await importer.setConsent({ consent: true, profileId: 'profile-a', domains: ['old.test', 'kept.test'] })
    cookies.push({ domain: '.old.test', name: 'old', path: '/', secure: true }, { domain: 'kept.test', name: 'kept', path: '/', secure: true }, { domain: 'unrelated.test', name: 'other', path: '/', secure: true })
    await importer.setConsent({ consent: true, profileId: 'profile-a', domains: ['kept.test'] })
    expect(cookies.map(c => c.name)).toEqual(['kept', 'other'])
    await importer.setConsent({ consent: true, profileId: 'profile-b', domains: ['new.test'] })
    expect(cookies.map(c => c.name)).toEqual(['other'])
    expect(loadPrivacyState(root).providerAccess.filter(entry => entry.revokedAt === null)).toHaveLength(1)
    expect(importer.status().profileId).toBe('profile-b')
  })
  test('failed purge retains old ledger and scope for retry while import is disabled', async () => {
    await importer.setConsent({ consent: true, profileId: 'profile-b', domains: ['new.test', 'removed.test'] })
    cookies.push({ domain: 'removed.test', name: 'retry', path: '/', secure: true })
    refuseRemoval = true
    await expect(importer.setConsent({ consent: true, profileId: 'profile-b', domains: ['new.test'] })).rejects.toThrow('revocation-failed')
    expect(importer.status().consent).toBe(false)
    expect(loadPrivacyState(root).providerAccess.find(entry => entry.revokedAt === null)?.domains).toEqual(['new.test', 'removed.test'])
    expect(cookies.some(c => c.name === 'retry')).toBe(true)
    refuseRemoval = false
    await importer.setConsent({ consent: true, profileId: 'profile-b', domains: ['new.test'] })
    expect(cookies.some(c => c.name === 'retry')).toBe(false)
    expect(importer.status().domains).toEqual(['new.test'])
  })
})

} else {
  test('cookie consent production fixture passes in an isolated process without leaking module mocks', () => {
    const result = spawnSync(process.execPath, ['test', import.meta.filename], {
      cwd: process.cwd(), env: { ...process.env, ROX_COOKIE_CONSENT_ISOLATED: '1' }, encoding: 'utf8', timeout: 20_000,
    })
    if (result.status !== 0) throw new Error(result.stderr || result.stdout || String(result.error))
    expect(result.status).toBe(0)
    expect(result.stderr).toContain('2 pass')
    expect(result.stderr).toContain('0 fail')
  }, 25_000)
}
