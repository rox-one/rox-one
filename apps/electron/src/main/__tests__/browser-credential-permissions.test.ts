import { describe, expect, test } from 'bun:test'
import { pbkdf2Sync } from 'node:crypto'
import type { DiscoveredProfile } from '@rox/shared/browser/profile-import'
import {
  createBrowserCredentialPermissionAdapter, runNativeCredentialCommand,
  type NativeCredentialCommand, type BrowserCredentialConfirmation,
} from '../browser-credential-permissions'

const profile = (path = '/Users/fixture/Library/Application Support/Google/Chrome/Default'): DiscoveredProfile => ({
  id: `chromium:${path}`, path, family: 'chromium', name: 'Fixture Chrome',
  state: 'ok', recommended: false, lastUsedAt: null,
})
const request = (p = profile()) => ({ profile: p, workspaceId: 'fixture-workspace' })

describe('native browser credential grants', () => {
  test.each(['deny', 'cancel'] as const)('%s refuses all protected-store commands', async decision => {
    let commands = 0
    const adapter = createBrowserCredentialPermissionAdapter({ platform: 'darwin', exists: () => true,
      confirm: async () => decision, execute: async () => { commands++; return Buffer.from('should never be read') },
    })
    expect((await adapter.requestAccess(request())).status).toBe(decision === 'deny' ? 'denied' : 'cancelled')
    expect(commands).toBe(0)
  })

  test('macOS host confirmation precedes the exact Keychain lookup and key release erases memory', async () => {
    const events: string[] = []
    const secret = Buffer.from(' fixture safe storage secret \n')
    const adapter = createBrowserCredentialPermissionAdapter({ platform: 'darwin', exists: () => true,
      confirm: async req => { events.push('confirm'); expect(req.workspaceId).toBe('fixture-workspace'); expect(req.mechanism).toBe('macos-keychain'); return 'allow' },
      execute: async (program, args) => {
        events.push('lookup'); expect(program).toBe('/usr/bin/security')
        expect(args).toEqual(['find-generic-password', '-w', '-s', 'Chrome Safe Storage'])
        return secret
      },
    })
    const grant = await adapter.requestAccess(request())
    expect(events).toEqual(['confirm', 'lookup'])
    expect(grant.status).toBe('granted')
    if (grant.status !== 'granted') throw Error('missing fixture grant')
    expect(grant.key).toEqual(pbkdf2Sync(' fixture safe storage secret ', 'saltysalt', 1003, 16, 'sha1'))
    expect(grant.profileId).toBe(profile().id)
    expect(grant.profilePath).toBe(profile().path)
    expect(secret.every(byte => byte === 0)).toBe(true)
    const derivedKey = grant.key
    grant.release(); grant.release()
    expect(derivedKey?.every(byte => byte === 0)).toBe(true)
    expect(grant.key).toBeNull()
  })

  test('Linux asks for the selected browser key with exact libsecret attributes', async () => {
    const p = profile('/home/fixture/.config/BraveSoftware/Brave-Browser/Default')
    const adapter = createBrowserCredentialPermissionAdapter({ platform: 'linux', exists: () => true,
      confirm: async () => 'allow', execute: async (program, args) => {
        expect(program).toBe('/usr/bin/secret-tool')
        expect(args).toEqual(['lookup', 'application', 'brave'])
        return Buffer.from('fixture browser key\n')
      },
    })
    const grant = await adapter.requestAccess(request(p))
    expect(grant.status).toBe('granted')
    if (grant.status !== 'granted') throw Error('missing fixture grant')
    expect(grant.key).toEqual(pbkdf2Sync('fixture browser key', 'saltysalt', 1, 16, 'sha1'))
    grant.release()
  })

  test.each(['browser-credential-access-cancelled', 'browser-credential-access-denied', 'secret fixture error'])('native failure %s exposes only stable status', async reason => {
    const adapter = createBrowserCredentialPermissionAdapter({ platform: 'darwin', exists: () => true,
      confirm: async () => 'allow', execute: async () => { throw Error(reason) },
    })
    const result = await adapter.requestAccess(request())
    expect(result.status).toBe(reason.endsWith('cancelled') ? 'cancelled' : reason.endsWith('denied') ? 'denied' : 'unavailable')
    expect(JSON.stringify(result)).not.toContain('secret fixture error')
  })

  test('absent native service, unsupported family/browser and invalid scope never prompt or decrypt', async () => {
    let prompts = 0
    const confirm = async (): Promise<BrowserCredentialConfirmation> => { prompts++; return 'allow' }
    const absent = createBrowserCredentialPermissionAdapter({ platform: 'darwin', exists: () => false, confirm })
    expect((await absent.requestAccess(request())).status).toBe('unavailable')
    const adapter = createBrowserCredentialPermissionAdapter({ platform: 'darwin', exists: () => true, confirm })
    expect((await adapter.requestAccess(request({ ...profile(), family: 'firefox' }))).status).toBe('unsupported')
    expect((await adapter.requestAccess(request(profile('/fixture/unknown-browser/Default')))).status).toBe('unsupported')
    expect((await adapter.requestAccess({ ...request(), workspaceId: '  ' })).status).toBe('denied')
    expect(prompts).toBe(0)
  })

  test('a concurrent request cannot reuse an in-flight confirmation; a completed grant is not cached', async () => {
    let answer!: (value: BrowserCredentialConfirmation) => void
    let prompts = 0
    const adapter = createBrowserCredentialPermissionAdapter({ platform: 'darwin', exists: () => true,
      confirm: () => { prompts++; return new Promise(resolve => { answer = resolve }) },
      execute: async () => Buffer.from('fixture-key'),
    })
    const first = adapter.requestAccess(request())
    expect((await adapter.requestAccess(request())).status).toBe('denied')
    answer('cancel'); expect((await first).status).toBe('cancelled')
    const next = adapter.requestAccess(request()); answer('deny'); await next
    expect(prompts).toBe(2)
  })

  test('Windows DPAPI input uses stdin only, and an expired grant cannot decrypt', async () => {
    let calls = 0
    let input: Buffer | null = null
    let output: Buffer | null = null
    const execute: NativeCredentialCommand = async (program, args, options) => {
      calls++
      expect(program).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
      expect(args).toContain('-NonInteractive')
      expect(args.join(' ')).not.toContain('encrypted fixture')
      const script = Buffer.from(args[args.length - 1]!, 'base64').toString('utf16le')
      expect(script).toContain('DataProtectionScope]::CurrentUser')
      expect(script).toContain('[Console]::In.ReadToEnd()')
      input = options.input!; expect(input.toString('ascii')).toBe(Buffer.from('encrypted fixture').toString('base64'))
      output = Buffer.from(Buffer.from('decrypted fixture').toString('base64')); return output
    }
    const adapter = createBrowserCredentialPermissionAdapter({ platform: 'win32', windowsDirectory: 'C:\\Windows', exists: () => true,
      confirm: async req => { expect(req.mechanism).toBe('windows-dpapi'); return 'allow' }, execute,
    })
    const grant = await adapter.requestAccess(request(profile('C:\\Users\\fixture\\AppData\\Local\\Google\\Chrome\\User Data\\Default')))
    expect(grant.status).toBe('granted'); expect(calls).toBe(0)
    if (grant.status !== 'granted') throw Error('missing fixture grant')
    expect(grant.key).toBeNull()
    const decrypted = await grant.decryptWindows!(Buffer.from('encrypted fixture'))
    expect(decrypted.toString()).toBe('decrypted fixture'); decrypted.fill(0)
    expect((input as Buffer | null)?.every(byte => byte === 0)).toBe(true)
    expect((output as Buffer | null)?.every(byte => byte === 0)).toBe(true)
    grant.release()
    await expect(grant.decryptWindows!(Buffer.from('encrypted fixture'))).rejects.toThrow('grant-expired')
    expect(calls).toBe(1)
  })

  test('revocation during the Windows OS await discards output', async () => {
    let releaseOutput!: (value: Buffer) => void
    const adapter = createBrowserCredentialPermissionAdapter({ platform: 'win32', exists: () => true, confirm: async () => 'allow',
      execute: () => new Promise(resolve => { releaseOutput = resolve }),
    })
    const grant = await adapter.requestAccess(request())
    if (grant.status !== 'granted') throw Error('missing fixture grant')
    const pending = grant.decryptWindows!(Buffer.from('encrypted fixture'))
    grant.release()
    const output = Buffer.from('Zml4dHVyZQ=='); releaseOutput(output)
    await expect(pending).rejects.toThrow('grant-expired')
    expect(output.every(byte => byte === 0)).toBe(true)
  })
})

describe('native command isolation with disposable subprocess fixtures', () => {
  test('secret bytes travel over stdin/stdout without child output in errors', async () => {
    const output = await runNativeCredentialCommand(process.execPath, ['-e', 'process.stdin.on("data", bytes => process.stdout.write(bytes))'], {
      input: Buffer.from('fixture secret'), timeoutMs: 5000, maxOutputBytes: 1024,
    })
    expect(output.toString()).toBe('fixture secret'); output.fill(0)
    await expect(runNativeCredentialCommand(process.execPath, ['-e', 'process.stderr.write("private fixture message"); process.exit(1)'], {
      timeoutMs: 5000, maxOutputBytes: 1024,
    })).rejects.toThrow('browser-credential-access-unavailable')
  })
  test('OS cancellation, excessive output and timeout stop with stable errors', async () => {
    await expect(runNativeCredentialCommand(process.execPath, ['-e', 'process.stderr.write("User canceled (-128)"); process.exit(1)'], {
      timeoutMs: 5000, maxOutputBytes: 1024,
    })).rejects.toThrow('browser-credential-access-cancelled')
    await expect(runNativeCredentialCommand(process.execPath, ['-e', 'process.stdout.write("x".repeat(2048))'], {
      timeoutMs: 5000, maxOutputBytes: 32,
    })).rejects.toThrow('browser-credential-access-unavailable')
    await expect(runNativeCredentialCommand(process.execPath, ['-e', 'setTimeout(() => {}, 5000)'], {
      timeoutMs: 20, maxOutputBytes: 32,
    })).rejects.toThrow('browser-credential-access-cancelled')
  })
})
