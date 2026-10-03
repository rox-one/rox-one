import { describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MailService } from '../mail-service'
import { isOptionalMailSetup } from '../../../shared/mail-local'

describe('optional local mail setup', () => {
  for (const setup of ['default', 'explicit-url', 'explicit-default-url', 'explicit-enabled', 'existing-mailbox'] as const) {
    test(`unreachable ${setup} has truthful configuration metadata`, async () => {
      const directory = mkdtempSync(join(tmpdir(), 'rox-optional-mail-'))
      try {
        mkdirSync(join(directory, 'mail'))
        if (setup === 'explicit-default-url') writeFileSync(join(directory, 'mail/config.json'), JSON.stringify({ serverUrl: 'http://127.0.0.1:8480' }))
        if (setup === 'explicit-enabled') writeFileSync(join(directory, 'mail/config.json'), JSON.stringify({ enabled: true }))
        if (setup === 'existing-mailbox') writeFileSync(join(directory, 'mail/mailboxes.json'), JSON.stringify({ synthetic: { address: 'synthetic@rox.one', ownerUuid: 'synthetic', state: 'READY' } }))
        const unavailableFetch = Object.assign(async () => { throw new Error('synthetic offline') }, { preconnect: () => {} })
        const service = new MailService({ configDir: directory, env: { ROX_MAIL_NO_AUTOSTART: '1', ...(setup === 'explicit-url' ? { ROX_MAIL_SERVER_URL: 'https://mail.example.test' } : {}) }, identity: async () => ({ ownerUuid: 'synthetic', handles: ['synthetic'] }), secrets: { get: async () => null, put: async () => {}, delete: async () => {} }, fetch: unavailableFetch })
        const status = await service.status()
        expect(status.state).toBe('unreachable')
        expect(status.configured).toBe(setup !== 'default')
        expect(isOptionalMailSetup(status)).toBe(setup === 'default')
      } finally { rmSync(directory, { recursive: true, force: true }) }
    })
  }
  test('missing metadata, remote errors and existing addresses remain real failures', () => {
    const base = { flag: 'inbox.mail.v1', enabled: true, state: 'unreachable', serverUrl: 'http://127.0.0.1:8480', domain: 'rox.one', local: true, reachable: false, address: null, push: 'off' } as const
    expect(isOptionalMailSetup(base)).toBe(false)
    expect(isOptionalMailSetup({ ...base, configured: false, local: false })).toBe(false)
    expect(isOptionalMailSetup({ ...base, configured: false, address: 'existing@rox.one' })).toBe(false)
    expect(isOptionalMailSetup({ ...base, configured: false, state: 'error' })).toBe(false)
  })
})
