import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { nativeFsyncFixture, projectNativeVaultReceipt, safeVaultErrorCode } from './pocket-vault-diagnostics'

test('native fixture records actual descriptor flush outcomes and removes fixture data', () => {
  const root = mkdtempSync(join(tmpdir(), 'pocket-fsync-'))
  try {
    const result = nativeFsyncFixture(root)
    expect(result).toHaveLength(2)
    expect(result[1]).toMatchObject({ access: 'writable', opened: true, flushed: true, code: null })
    expect(readdirSync(root)).toEqual([])
  } finally { rmSync(root, { recursive: true, force: true }) }
})
test('failure projection retains known phase/stage/code and strips secret canaries', () => {
  const secret = 'secret-canary-never-emit'
  const projected = projectNativeVaultReceipt({ phase: 'write', platform: 'win32', passed: false, stage: 'account_write', code: 'ROX_SECURE_STORE_WRITE_FAILED', electron: '39.2.7', apiKey: secret, stderr: secret, fsync: [{ access: 'readonly', opened: true, flushed: false, code: 'EPERM', path: secret }, { access: 'writable', opened: true, flushed: true, code: null }] }, 'write', 'win32')
  expect(projected).toMatchObject({ phase: 'write', stage: 'account_write', code: 'ROX_SECURE_STORE_WRITE_FAILED' })
  expect(JSON.stringify(projected)).not.toContain(secret)
  expect(safeVaultErrorCode({ code: 'EPERM', message: secret })).toBe('EPERM')
  expect(safeVaultErrorCode(new Error(secret))).toBe('unknown')
  expect(projectNativeVaultReceipt({ phase: 'read', platform: 'win32', passed: true }, 'write')).toBeNull()
  expect(projectNativeVaultReceipt({ phase: 'write', platform: 'linux', passed: true }, 'write')).toBeNull()
})
test('success proof requires matching native platform and completed OS encryption plus writable flush', () => {
  const good = { phase: 'write', platform: 'win32', passed: true, code: null, stage: 'complete', encryptionAvailable: true, electron: '39.2.7', fsync: [{ access: 'readonly', opened: true, flushed: false, code: 'EPERM' }, { access: 'writable', opened: true, flushed: true, code: null }] }
  expect(projectNativeVaultReceipt(good, 'write', 'win32')).toMatchObject({ passed: true, stage: 'complete', encryptionAvailable: true, electron: '39.2.7' })
  expect(projectNativeVaultReceipt({ ...good, platform: 'darwin' }, 'write', 'darwin')?.passed).toBe(true)
  for (const patch of [
    { phase: 'read' }, { platform: 'darwin' }, { stage: 'account_write' }, { encryptionAvailable: false }, { code: 'EIO' }, { code: undefined },
    { electron: undefined }, { electron: 'unknown' }, { electron: '0.0.0' }, { electron: '39.2.7-secret' },
    { fsync: [] }, { fsync: undefined },
    { fsync: [{ access: 'readonly', opened: true, flushed: true, code: null }] },
    { fsync: [{ access: 'writable', opened: false, flushed: true, code: null }] },
    { fsync: [{ access: 'writable', opened: true, flushed: false, code: 'EPERM' }] },
    { fsync: [{ access: 'writable', opened: true, flushed: true, code: 'EIO' }] },
  ]) expect(projectNativeVaultReceipt({ ...good, ...patch }, 'write', 'win32')).toBeNull()
  expect(projectNativeVaultReceipt({ ...good, phase: 'read' }, 'read', 'win32')?.passed).toBe(true)
})
