import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createKeeperKeyCustody, generateVaultKey, openVaultPayload, sealVaultPayload, storageCustodyAvailable, type KeeperSafeStorage } from '../crypto'
import { KEEPER_ERROR } from '../types'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function tempDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'rox-keeper-crypto-'))
  roots.push(root)
  return root
}

function fakeSafeStorage(options: { available?: boolean; backend?: string } = {}): KeeperSafeStorage {
  const tag = Buffer.from('rox-test-seal:')
  return {
    isEncryptionAvailable: () => options.available !== false,
    encryptString: (value) => Buffer.concat([tag, Buffer.from(value, 'utf8')]),
    decryptString: (value) => {
      if (!value.subarray(0, tag.length).equals(tag)) throw new Error('not sealed here')
      return value.subarray(tag.length).toString('utf8')
    },
    ...(options.backend ? { getSelectedStorageBackend: () => options.backend! } : {}),
  }
}

describe('vault payload sealing', () => {
  it('round-trips through AES-256-GCM', () => {
    const key = generateVaultKey()
    const sealed = sealVaultPayload(key, JSON.stringify({ items: [{ title: 'bank' }] }))
    expect(sealed).toMatchObject({ version: 1, cipher: 'aes-256-gcm' })
    expect(openVaultPayload(key, sealed)).toBe(JSON.stringify({ items: [{ title: 'bank' }] }))
    expect(sealed.data).not.toContain('bank')
  })

  it('fails with a wrong key and on tampered ciphertext', () => {
    const key = generateVaultKey()
    const sealed = sealVaultPayload(key, 'top secret')
    expect(() => openVaultPayload(generateVaultKey(), sealed)).toThrow(KEEPER_ERROR.invalidKey)
    const tampered = { ...sealed, data: Buffer.from('garbage').toString('base64') }
    expect(() => openVaultPayload(key, tampered)).toThrow(KEEPER_ERROR.invalidKey)
    expect(() => openVaultPayload(key, { version: 1, cipher: 'aes-256-gcm', iv: 'x', tag: 'y', data: 'z' })).toThrow(KEEPER_ERROR.invalidKey)
  })
})

describe('safeStorage custody availability', () => {
  it('follows the browser-credential rules (no Linux basic_text)', () => {
    expect(storageCustodyAvailable(fakeSafeStorage(), 'darwin')).toBe(true)
    expect(storageCustodyAvailable(fakeSafeStorage({ available: false }), 'darwin')).toBe(false)
    expect(storageCustodyAvailable(fakeSafeStorage({ backend: 'basic_text' }), 'linux')).toBe(false)
    expect(storageCustodyAvailable(fakeSafeStorage({ backend: 'kwallet' }), 'linux')).toBe(true)
    expect(storageCustodyAvailable(fakeSafeStorage({ backend: 'unknown' }), 'linux')).toBe(false)
    expect(storageCustodyAvailable(fakeSafeStorage(), 'linux')).toBe(false)
  })

  it('fails closed when the backend throws', () => {
    const throwing: KeeperSafeStorage = {
      isEncryptionAvailable: () => { throw new Error('no keychain') },
      encryptString: () => Buffer.alloc(0),
      decryptString: () => '',
    }
    expect(storageCustodyAvailable(throwing, 'darwin')).toBe(false)
  })
})

describe('key custody files', () => {
  it('creates a wrapped key once and reads it back, 0600', () => {
    const directory = join(tempDir(), 'personal')
    const custody = createKeeperKeyCustody({ directory, safeStorage: fakeSafeStorage(), platform: 'darwin' })
    expect(custody.hasKey('vault')).toBe(false)
    const key = custody.createKey('vault')
    expect(key?.length).toBe(32)
    expect(custody.createKey('vault')).toBeNull() // exclusive publish
    expect(custody.readKey('vault')?.equals(key!)).toBe(true)
    expect(custody.readKey('../escape')).toBeNull()
    if (process.platform !== 'win32') {
      expect(statSync(join(directory, 'vault.key.enc')).mode & 0o777).toBe(0o600)
      expect(statSync(directory).mode & 0o777).toBe(0o700)
    }
  })

  it('returns null when the OS store is unavailable and never writes plaintext', () => {
    const directory = join(tempDir(), 'personal')
    const custody = createKeeperKeyCustody({ directory, safeStorage: fakeSafeStorage({ available: false }), platform: 'darwin' })
    expect(custody.available()).toBe(false)
    expect(custody.createKey('vault')).toBeNull()
    expect(custody.readKey('vault')).toBeNull()
  })

  it('does not accept a key file that was sealed by a different OS store', () => {
    const directory = join(tempDir(), 'personal')
    createKeeperKeyCustody({ directory, safeStorage: fakeSafeStorage(), platform: 'darwin' }).createKey('vault')
    const other = createKeeperKeyCustody({ directory, safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: () => Buffer.from('other'),
      decryptString: () => { throw new Error('different store') },
    }, platform: 'darwin' })
    expect(other.readKey('vault')).toBeNull()
    // The on-disk file remains ciphertext, never the raw key hex.
    expect(readFileSync(join(directory, 'vault.key.enc'), 'utf8')).toContain('rox-test-seal:')
  })
})