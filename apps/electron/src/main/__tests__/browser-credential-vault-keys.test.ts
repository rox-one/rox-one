import { afterEach, describe, expect, test } from 'bun:test'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createBrowserCredentialVaultKeyStore, type BrowserCredentialSafeStorage } from '../browser-credential-vault-keys'

const folders: string[] = []
afterEach(() => { for (const dir of folders.splice(0)) rmSync(dir, { recursive: true, force: true }) })
const reference = 'fixture-vault-key-reference'
function fixture(platform: NodeJS.Platform = 'darwin', backend = 'gnome_libsecret') {
  const root = mkdtempSync(join(tmpdir(), 'rox-credential-key-fixture-')); folders.push(root)
  const wrappingKey = randomBytes(32)
  let available = true
  let encryptions = 0
  const safeStorage: BrowserCredentialSafeStorage = {
    isEncryptionAvailable: () => available,
    getSelectedStorageBackend: () => backend,
    encryptString(value) {
      encryptions++
      const iv = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', wrappingKey, iv)
      const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
      return Buffer.concat([iv, cipher.getAuthTag(), encrypted])
    },
    decryptString(value) {
      const decipher = createDecipheriv('aes-256-gcm', wrappingKey, value.subarray(0, 12))
      decipher.setAuthTag(value.subarray(12, 28))
      return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString('utf8')
    },
  }
  const directory = join(root, 'keys')
  return { root, directory, safeStorage,
    store: createBrowserCredentialVaultKeyStore({ directory, safeStorage, platform }),
    setAvailable: (next: boolean) => { available = next }, encryptions: () => encryptions,
  }
}

describe('OS-protected browser vault key custody', () => {
  test('only wrapped ciphertext persists; readback and deletion survive a fresh adapter', () => {
    const f = fixture()
    const key = randomBytes(32)
    expect(f.store.storeKey(reference, key)).toBe(true)
    const encrypted = readFileSync(join(f.directory, `${reference}.enc`))
    expect(encrypted.includes(key)).toBe(false)
    expect(encrypted.includes(Buffer.from(key.toString('hex')))).toBe(false)
    expect(readdirSync(f.directory)).toEqual([`${reference}.enc`])
    expect(statSync(f.directory).mode & 0o777).toBe(0o700)
    expect(statSync(join(f.directory, `${reference}.enc`)).mode & 0o777).toBe(0o600)
    const fresh = createBrowserCredentialVaultKeyStore({ directory: f.directory, safeStorage: f.safeStorage, platform: 'darwin' })
    const readback = fresh.readKey(reference)
    expect(readback).toEqual(key); readback?.fill(0)
    expect(fresh.deleteKey(reference)).toBe(true)
    expect(fresh.deleteKey(reference)).toBe(true)
    expect(fresh.readKey(reference)).toBeNull()
    key.fill(0)
  })

  test('missing OS encryption and Linux basic_text/unknown never create a file', () => {
    const missing = fixture(); missing.setAvailable(false)
    expect(missing.store.storeKey(reference, randomBytes(32))).toBe(false)
    expect(existsSync(missing.directory)).toBe(false)
    for (const backend of ['basic_text', 'unknown', '']) {
      const f = fixture('linux', backend)
      expect(f.store.available()).toBe(false)
      expect(f.store.storeKey(reference, randomBytes(32))).toBe(false)
      expect(f.encryptions()).toBe(0)
      expect(existsSync(f.directory)).toBe(false)
    }
    expect(fixture('linux', 'kwallet6').store.available()).toBe(true)
  })

  test('no overwrite, invalid reference and invalid key lengths cannot change existing custody', () => {
    const f = fixture(); const original = randomBytes(32)
    expect(f.store.storeKey(reference, original)).toBe(true)
    expect(f.store.storeKey(reference, randomBytes(32))).toBe(false)
    expect(f.store.readKey(reference)).toEqual(original)
    for (const invalid of ['../outside-keys-here', '', 'a/b/secret-reference', 'x'.repeat(161)]) {
      expect(f.store.storeKey(invalid, randomBytes(32))).toBe(false)
      expect(f.store.readKey(invalid)).toBeNull()
      expect(f.store.deleteKey(invalid)).toBe(false)
    }
    expect(f.store.storeKey('second-fixture-reference', randomBytes(16))).toBe(false)
    expect(readdirSync(f.directory)).toEqual([`${reference}.enc`])
    original.fill(0)
  })

  test('encrypted damage never returns a key and deleting does not require unlocking the OS store', () => {
    const f = fixture()
    expect(f.store.storeKey(reference, randomBytes(32))).toBe(true)
    writeFileSync(join(f.directory, `${reference}.enc`), 'corrupt fixture encrypted bytes')
    expect(f.store.readKey(reference)).toBeNull()
    f.setAvailable(false)
    expect(f.store.deleteKey(reference)).toBe(true)
    expect(f.store.deleteKey('missing-fixture-reference')).toBe(true)
  })

  test('symlink and directory entries are ambiguous custody, never treated as absent or deleted', () => {
    const f = fixture(); mkdirSync(f.directory)
    const outside = join(f.root, 'outside.enc'); writeFileSync(outside, 'outside fixture')
    symlinkSync(outside, join(f.directory, `${reference}.enc`))
    expect(f.store.readKey(reference)).toBeNull()
    expect(f.store.deleteKey(reference)).toBe(false)
    expect(readFileSync(outside, 'utf8')).toBe('outside fixture')
    rmSync(join(f.directory, `${reference}.enc`)); mkdirSync(join(f.directory, `${reference}.enc`))
    expect(f.store.deleteKey(reference)).toBe(false)
    expect(f.store.readKey(reference)).toBeNull()
  })

  test('OS seal failure leaves no encrypted or temporary custody files', () => {
    const f = fixture()
    const failing = createBrowserCredentialVaultKeyStore({ directory: f.directory, platform: 'darwin',
      safeStorage: { ...f.safeStorage, encryptString() { throw Error('fictional locked keychain') } },
    })
    expect(failing.storeKey(reference, randomBytes(32))).toBe(false)
    expect(existsSync(f.directory)).toBe(false)
  })

  test('a symlinked custody directory cannot read, overwrite or delete another directory', () => {
    const f = fixture()
    const other = join(f.root, 'other-keys'); mkdirSync(other)
    const outside = join(other, `${reference}.enc`); writeFileSync(outside, 'outside fixture')
    symlinkSync(other, f.directory, 'dir')
    expect(f.store.storeKey('second-fixture-reference', randomBytes(32))).toBe(false)
    expect(f.store.readKey(reference)).toBeNull()
    expect(f.store.deleteKey(reference)).toBe(false)
    expect(readFileSync(outside, 'utf8')).toBe('outside fixture')
  })
})

test('never decrypts a valid wrapped key reached through a substituted symlink', () => {
  const f = fixture(); mkdirSync(f.directory)
  const wrapped = f.safeStorage.encryptString(randomBytes(32).toString('hex'))
  const outside = join(f.root, 'valid-outside.enc'); writeFileSync(outside, wrapped)
  symlinkSync(outside, join(f.directory, `${reference}.enc`))
  let decryptions = 0
  const decrypt = f.safeStorage.decryptString
  f.safeStorage.decryptString = value => { decryptions++; return decrypt(value) }
  expect(f.store.readKey(reference)).toBeNull()
  expect(decryptions).toBe(0)
  expect(readFileSync(outside)).toEqual(wrapped)
})
