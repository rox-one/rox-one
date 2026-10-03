import { expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { rollbackImport, deleteImportedProfile, type ProfileFs } from '../profile-import.ts'
import { deleteProtectedCookieKey } from '../../../../server-core/src/handlers/rpc/browser-protected-cookie-key.ts'

function fixture(run: (input: { fs: ProfileFs; root: string; index: string; vault: string; keys: Set<string> }) => void) {
  const root = mkdtempSync(join(tmpdir(), 'cookie-key-recovery-'))
  const index = join(root, 'index.json'), vault = join(root, 'vault.json')
  const keys = new Set(['owned-new-key', 'unrelated-prior-key'])
  const fs: ProfileFs = {
    exists: existsSync,
    readText: path => existsSync(path) ? readFileSync(path, 'utf8') : null,
    writeText: (path, text) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text) },
    remove: path => { if (existsSync(path)) rmSync(path) },
    listPaths: prefix => readdirSync(dirname(prefix)).map(name => join(dirname(prefix), name)).filter(path => path.startsWith(prefix)),
  }
  fs.writeText(index, JSON.stringify({ cookieKeyRef: 'owned-new-key', history: [], bookmarks: [] }))
  fs.writeText(vault, 'owned-current-ciphertext')
  try { run({ fs, root, index, vault, keys }) } finally { rmSync(root, { recursive: true, force: true }) }
}

test('rollback resumes key deletion when phase persistence failed after the protected key disappeared', () => fixture(({ fs, index, vault, keys }) => {
  const snapshot = JSON.stringify({ cookieKeyRef: 'unrelated-prior-key', history: [], bookmarks: [] })
  const backup = index + '.rb-crash'
  fs.writeText(backup, snapshot)
  fs.writeText(backup + '.cookies', JSON.stringify({ vaultPath: vault, previousVault: 'prior-ciphertext', currentKeyRef: 'owned-new-key', keyDeleted: false }))
  const originalWrite = fs.writeText
  let failOnce = true
  fs.writeText = (path, text) => {
    if (path === backup + '.cookies' && !keys.has('owned-new-key') && failOnce) { failOnce = false; throw Error('fixture-after-key-delete') }
    originalWrite(path, text)
  }
  const custody = { vaultPath: vault, deleteKey: (reference: string) => deleteProtectedCookieKey(reference, 'darwin', file => file === '/usr/bin/security'
    ? { status: keys.delete(reference) ? 0 : 44 } : { status: 0, stdout: '-25300' }) }
  expect(() => rollbackImport(fs, index, 'rb-crash', custody)).toThrow('fixture-after-key-delete')
  expect(keys.has('owned-new-key')).toBe(false)
  expect(fs.readText(backup + '.cookies')).toContain('"keyDeleted":false')
  expect(fs.readText(vault)).toBe('owned-current-ciphertext')
  expect(keys.has('unrelated-prior-key')).toBe(true)
  expect(rollbackImport(fs, index, 'rb-crash', custody)).toBe(true)
  expect(fs.readText(index)).toBe(snapshot)
  expect(fs.readText(vault)).toBe('prior-ciphertext')
  expect(keys.has('unrelated-prior-key')).toBe(true)
}))

test('profile deletion retains recovery journal if key deletion succeeded before its phase write failed', () => fixture(({ fs, index, vault, keys }) => {
  const originalWrite = fs.writeText
  let failOnce = true
  fs.writeText = (path, text) => {
    if (path === index + '.delete-custody' && !keys.has('owned-new-key') && failOnce) { failOnce = false; throw Error('fixture-after-key-delete') }
    originalWrite(path, text)
  }
  const input = { fs, indexPath: index, vaultPath: vault, protectedCookies: { read: () => null, storeKey: () => null,
    deleteKey: (reference: string) => deleteProtectedCookieKey(reference, 'darwin', file => file === '/usr/bin/security'
      ? { status: keys.delete(reference) ? 0 : 44 } : { status: 0, stdout: '-25300' }) } }
  expect(() => deleteImportedProfile(input)).toThrow('fixture-after-key-delete')
  expect(fs.readText(index + '.delete-custody')).toContain('owned-new-key')
  expect(fs.readText(vault)).toBe('owned-current-ciphertext')
  expect(keys.has('unrelated-prior-key')).toBe(true)
  expect(deleteImportedProfile(input).deletionReceipt.categories).toContain('cookies')
  expect(fs.readText(index)).toBe(null)
  expect(fs.readText(vault)).toBe(null)
  expect(fs.readText(index + '.delete-custody')).toBe(null)
  expect(keys.has('unrelated-prior-key')).toBe(true)
}))

test('ambiguous Linux absence after lost phase write remains fail closed with recovery bytes retained', () => fixture(({ fs, index, vault, keys }) => {
  const write = fs.writeText
  let failOnce = true
  fs.writeText = (path, text) => {
    if (path === index + '.delete-custody' && !keys.has('owned-new-key') && failOnce) { failOnce = false; throw Error('fixture-after-key-delete') }
    write(path, text)
  }
  const input = { fs, indexPath: index, vaultPath: vault, protectedCookies: { read: () => null, storeKey: () => null,
    deleteKey: (reference: string) => deleteProtectedCookieKey(reference, 'linux', () => ({ status: keys.delete(reference) ? 0 : 1, stdout: '' })) } }
  expect(() => deleteImportedProfile(input)).toThrow('fixture-after-key-delete')
  const pending = fs.readText(index + '.delete-custody'), source = fs.readText(index)
  expect(() => deleteImportedProfile(input)).toThrow('protected-cookie-key-delete-failed')
  expect(fs.readText(index + '.delete-custody')).toBe(pending)
  expect(fs.readText(index)).toBe(source)
  expect(fs.readText(vault)).toBe('owned-current-ciphertext')
  expect(keys.has('unrelated-prior-key')).toBe(true)
}))
