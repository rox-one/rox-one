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
  const projected = projectNativeVaultReceipt({ phase: 'write', platform: 'win32', passed: false, stage: 'account_write', code: 'ROX_SECURE_STORE_WRITE_FAILED', electron: '39.2.7', apiKey: secret, stderr: secret, fsync: [{ access: 'readonly', opened: true, flushed: false, code: 'EPERM', path: secret }, { access: 'writable', opened: true, flushed: true, code: null }] }, 'write')
  expect(projected).toMatchObject({ phase: 'write', stage: 'account_write', code: 'ROX_SECURE_STORE_WRITE_FAILED' })
  expect(JSON.stringify(projected)).not.toContain(secret)
  expect(safeVaultErrorCode({ code: 'EPERM', message: secret })).toBe('EPERM')
  expect(safeVaultErrorCode(new Error(secret))).toBe('unknown')
  expect(projectNativeVaultReceipt({ phase: 'read', platform: 'win32', passed: true }, 'write')).toBeNull()
  expect(projectNativeVaultReceipt({ phase: 'write', platform: 'linux', passed: true }, 'write')).toBeNull()
})
