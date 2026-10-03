import { afterEach, describe, expect, test } from 'bun:test'
import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from '../../utils/sqlite-runtime.ts'
import type { DiscoveredProfile } from '../profile-import.ts'
import { sealNativeBrowserCredentials, type NativeCredentialAccess } from '../profile-native-credentials.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'rox-password-fixture-'))
  roots.push(root)
  const profilePath = join(root, 'User Data', 'Default')
  const temporaryRoot = join(root, 'snapshots')
  mkdirSync(profilePath, { recursive: true })
  mkdirSync(temporaryRoot)
  const profile: DiscoveredProfile = {
    id: `chromium:${profilePath}`, family: 'chromium', name: 'Synthetic', path: profilePath,
    state: 'ok', lastUsedAt: null, recommended: false,
  }
  const key = pbkdf2Sync('synthetic-safe-storage', 'saltysalt', 1003, 16, 'sha1')
  const access: NativeCredentialAccess = { profileId: profile.id, profilePath, key }
  return { root, profile, temporaryRoot, key, access, vaultKey: randomBytes(32) }
}

function store(path: string) {
  const database = new DatabaseSync(path)
  database.exec('CREATE TABLE logins (origin_url TEXT, action_url TEXT, signon_realm TEXT, username_value TEXT, password_value BLOB, blacklisted_by_user INTEGER)')
  return {
    database,
    insert(blob: Uint8Array, username = 'synthetic-user', origin = 'https://example.test/login', blacklisted = 0) {
      database.prepare('INSERT INTO logins VALUES (?, ?, ?, ?, ?, ?)')
        .run(origin, 'https://example.test/auth', 'https://example.test/', username, blob, blacklisted)
    },
  }
}

function cbc(secret: string, key: Buffer, version = 'v10'): Buffer {
  const cipher = createCipheriv('aes-128-cbc', key, Buffer.alloc(16, 0x20))
  return Buffer.concat([Buffer.from(version), cipher.update(secret, 'utf8'), cipher.final()])
}

function gcm(secret: string, key: Buffer): Buffer {
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  return Buffer.concat([Buffer.from('v10'), nonce, cipher.update(secret, 'utf8'), cipher.final(), cipher.getAuthTag()])
}

function openVault(blob: string, key: Buffer): { profileId: string; credentials: Array<{ password: string; username: string; origin: string }> } {
  const envelope = JSON.parse(blob)
  expect(envelope.format).toBe('rox-browser-credentials')
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'))
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'))
  const plain = Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()])
  try { return JSON.parse(plain.toString('utf8')) } finally { plain.fill(0) }
}

describe('native browser credential sealing', () => {
  test('macOS reads real synthetic SQLite rows and returns only sealed ciphertext', async () => {
    const f = fixture()
    const secret = 'a long synthetic password with more than 32 characters ✓'
    const db = store(join(f.profile.path, 'Login Data'))
    db.insert(cbc(secret, f.key))
    db.insert(cbc('blocked-secret', f.key), 'blocked', 'https://blocked.test/', 1)
    db.database.close()
    const originalVaultKey = Buffer.from(f.vaultKey)
    const result = await sealNativeBrowserCredentials(f.profile, f.access, f.vaultKey, { platform: 'darwin', temporaryRoot: f.temporaryRoot })
    expect(result.count).toBe(1)
    expect(result.skipped).toBe(0)
    expect(JSON.stringify(result)).not.toContain(secret)
    expect(JSON.stringify(result)).not.toContain('synthetic-user')
    expect(openVault(result.sealedBlob!, f.vaultKey).credentials[0]?.password).toBe(secret)
    expect(f.vaultKey).toEqual(originalVaultKey)
    expect(f.key.some(value => value !== 0)).toBe(true) // The host releases its grant.
    expect(readdirSync(f.temporaryRoot)).toEqual([])
    expect(readdirSync(f.profile.path)).toEqual(['Login Data'])
  })

  test('Linux uses the host-derived v11 Safe Storage key, not the insecure peanuts fallback', async () => {
    const f = fixture()
    f.key = pbkdf2Sync('secret-service-password', 'saltysalt', 1, 16, 'sha1')
    f.access.key = f.key
    const db = store(join(f.profile.path, 'Login Data'))
    db.insert(cbc('linux-fixture-password', f.key, 'v11'))
    db.database.close()
    const result = await sealNativeBrowserCredentials(f.profile, f.access, f.vaultKey, { platform: 'linux', temporaryRoot: f.temporaryRoot })
    expect(openVault(result.sealedBlob!, f.vaultKey).credentials[0]?.password).toBe('linux-fixture-password')
  })

  test('Windows unwraps Local State with current-user DPAPI, authenticates GCM and supports legacy rows', async () => {
    const f = fixture()
    const windowsKey = randomBytes(32)
    const expectedWindowsKey = Buffer.from(windowsKey)
    const wrapped = Buffer.from('synthetic-wrapped-key')
    writeFileSync(join(f.root, 'User Data', 'Local State'), JSON.stringify({ os_crypt: { encrypted_key: Buffer.concat([Buffer.from('DPAPI'), wrapped]).toString('base64') } }))
    const db = store(join(f.profile.path, 'Login Data'))
    db.insert(gcm('gcm-fixture-password', expectedWindowsKey))
    db.insert(Buffer.from('synthetic-legacy-dpapi'), 'old-user')
    db.insert(Buffer.concat([Buffer.from('v20'), randomBytes(48)]), 'app-bound')
    const tampered = gcm('tampered-secret', expectedWindowsKey)
    tampered[tampered.length - 1]! ^= 1
    db.insert(tampered, 'tampered')
    db.database.close()
    const calls: string[] = []
    const legacyPlain = Buffer.from('legacy-fixture-password')
    const result = await sealNativeBrowserCredentials(f.profile, {
      ...f.access, key: null,
      async decryptWindows(blob) {
        calls.push(Buffer.from(blob).toString('utf8'))
        return Buffer.from(blob).equals(wrapped) ? windowsKey : legacyPlain
      },
    }, f.vaultKey, { platform: 'win32', temporaryRoot: f.temporaryRoot })
    expect(result).toMatchObject({ count: 2, skipped: 2, unsupported: 1 })
    expect(calls).toEqual(['synthetic-wrapped-key', 'synthetic-legacy-dpapi'])
    expect(openVault(result.sealedBlob!, f.vaultKey).credentials.map(row => row.password)).toEqual(['gcm-fixture-password', 'legacy-fixture-password'])
    expect(windowsKey.every(value => value === 0)).toBe(true)
    expect(legacyPlain.every(value => value === 0)).toBe(true)
    expect(readdirSync(f.temporaryRoot)).toEqual([])
  })

  test('reads an active WAL snapshot and removes every temporary secret-store copy', async () => {
    const f = fixture()
    const db = store(join(f.profile.path, 'Login Data'))
    db.database.exec('PRAGMA journal_mode=WAL')
    db.insert(cbc('active-wal-password', f.key))
    expect(existsSync(join(f.profile.path, 'Login Data-wal'))).toBe(true)
    try {
      const result = await sealNativeBrowserCredentials(f.profile, f.access, f.vaultKey, { platform: 'darwin', temporaryRoot: f.temporaryRoot })
      expect(result.count).toBe(1)
      expect(openVault(result.sealedBlob!, f.vaultKey).credentials[0]?.password).toBe('active-wal-password')
      expect(readdirSync(f.temporaryRoot)).toEqual([])
      expect(db.database.prepare('SELECT COUNT(*) AS total FROM logins').get()?.total).toBe(1)
    } finally { db.database.close() }
  })

  test('includes the selected profile account store and never scans sibling profiles', async () => {
    const f = fixture()
    const db = store(join(f.profile.path, 'Login Data For Account'))
    db.insert(cbc('account-store-secret', f.key))
    db.database.close()
    const sibling = join(f.root, 'User Data', 'Profile 1')
    mkdirSync(sibling)
    // Corrupt sibling stores would fail if the adapter attempted broad discovery.
    writeFileSync(join(sibling, 'Login Data'), 'not a sqlite database')
    const result = await sealNativeBrowserCredentials(f.profile, f.access, f.vaultKey, { platform: 'darwin', temporaryRoot: f.temporaryRoot })
    expect(result.count).toBe(1)
    expect(openVault(result.sealedBlob!, f.vaultKey).profileId).toBe(f.profile.id)
    expect(readdirSync(sibling)).toEqual(['Login Data'])
  })

  test.each(['profileId', 'profilePath'] as const)('rejects a mismatched %s before any store read', async field => {
    const f = fixture()
    writeFileSync(join(f.profile.path, 'Login Data'), 'corrupt database that must remain unopened')
    await expect(sealNativeBrowserCredentials(f.profile, { ...f.access, [field]: 'ungranted-profile' }, f.vaultKey,
      { platform: 'darwin', temporaryRoot: f.temporaryRoot })).rejects.toThrow('browser-credentials-profile-not-authorized')
    expect(readdirSync(f.temporaryRoot)).toEqual([])
  })

  test.each(['firefox', 'safari'] as const)('%s remains unsupported and no credential store is opened', async family => {
    const f = fixture()
    writeFileSync(join(f.profile.path, 'Login Data'), 'unopened')
    await expect(sealNativeBrowserCredentials({ ...f.profile, family }, f.access, f.vaultKey,
      { platform: 'darwin', temporaryRoot: f.temporaryRoot })).rejects.toThrow('browser-credentials-store-unsupported')
    expect(readdirSync(f.temporaryRoot)).toEqual([])
  })

  test('missing access and invalid vault key fail before opening a corrupt credential database', async () => {
    const f = fixture()
    writeFileSync(join(f.profile.path, 'Login Data'), 'unopened')
    await expect(sealNativeBrowserCredentials(f.profile, { ...f.access, key: null }, f.vaultKey,
      { platform: 'darwin', temporaryRoot: f.temporaryRoot })).rejects.toThrow('browser-credentials-access-unavailable')
    await expect(sealNativeBrowserCredentials(f.profile, f.access, Buffer.alloc(16),
      { platform: 'darwin', temporaryRoot: f.temporaryRoot })).rejects.toThrow('browser-credentials-vault-key-unavailable')
    expect(readdirSync(f.temporaryRoot)).toEqual([])
  })

  test('unsupported row encryption is counted without claiming a successful import', async () => {
    const f = fixture()
    const db = store(join(f.profile.path, 'Login Data'))
    db.insert(Buffer.concat([Buffer.from('v20'), randomBytes(48)]))
    db.database.close()
    expect(await sealNativeBrowserCredentials(f.profile, f.access, f.vaultKey, { platform: 'darwin', temporaryRoot: f.temporaryRoot }))
      .toEqual({ sealedBlob: null, count: 0, skipped: 1, unsupported: 1 })
  })

  test('corrupt database errors reveal no file path or bytes and snapshots are removed', async () => {
    const f = fixture()
    writeFileSync(join(f.profile.path, 'Login Data'), 'sensitive-corrupt-bytes')
    await expect(sealNativeBrowserCredentials(f.profile, f.access, f.vaultKey,
      { platform: 'darwin', temporaryRoot: f.temporaryRoot })).rejects.toThrow(/^browser-credentials-read-failed$/)
    expect(readdirSync(f.temporaryRoot)).toEqual([])
  })

  test('denied legacy DPAPI cannot leak helper exceptions or persist a partial import', async () => {
    const f = fixture()
    const db = store(join(f.profile.path, 'Login Data'))
    db.insert(Buffer.from('synthetic-legacy-dpapi'))
    db.database.close()
    await expect(sealNativeBrowserCredentials(f.profile, { ...f.access, key: null, decryptWindows: async () => { throw new Error('sensitive-helper-output') } },
      f.vaultKey, { platform: 'win32', temporaryRoot: f.temporaryRoot })).rejects.toThrow(/^browser-credentials-access-denied$/)
    expect(readdirSync(f.temporaryRoot)).toEqual([])
    expect(readdirSync(f.profile.path)).toEqual(['Login Data'])
  })

  test('Windows without Local State still supports historical DPAPI, while versioned GCM is reported unsupported', async () => {
    const f = fixture()
    const db = store(join(f.profile.path, 'Login Data'))
    db.insert(Buffer.from('legacy-without-state'))
    db.insert(gcm('key-is-unavailable', randomBytes(32)), 'versioned')
    db.database.close()
    let decryptCalls = 0
    const result = await sealNativeBrowserCredentials(f.profile, {
      ...f.access, key: null, decryptWindows: async () => { decryptCalls++; return Buffer.from('legacy-without-state-password') },
    }, f.vaultKey, { platform: 'win32', temporaryRoot: f.temporaryRoot })
    expect(result).toMatchObject({ count: 1, skipped: 1, unsupported: 1 })
    expect(decryptCalls).toBe(1)
    expect(openVault(result.sealedBlob!, f.vaultKey).credentials[0]?.password).toBe('legacy-without-state-password')
  })

  test('an unwrapped Windows key is erased when a later store read fails', async () => {
    const f = fixture()
    const windowsKey = randomBytes(32)
    writeFileSync(join(f.root, 'User Data', 'Local State'), JSON.stringify({ os_crypt: { encrypted_key: Buffer.from('DPAPIwrapped').toString('base64') } }))
    writeFileSync(join(f.profile.path, 'Login Data'), 'sensitive-corrupt-bytes')
    await expect(sealNativeBrowserCredentials(f.profile, { ...f.access, key: null, decryptWindows: async () => windowsKey },
      f.vaultKey, { platform: 'win32', temporaryRoot: f.temporaryRoot })).rejects.toThrow('browser-credentials-read-failed')
    expect(windowsKey.every(value => value === 0)).toBe(true)
    expect(readdirSync(f.temporaryRoot)).toEqual([])
  })

  test('a linked password store cannot redirect a grant into a sibling profile', async () => {
    const f = fixture()
    const other = join(f.root, 'other.sqlite')
    const db = store(other)
    db.insert(cbc('ungranted-secret', f.key))
    db.database.close()
    symlinkSync(other, join(f.profile.path, 'Login Data'))
    await expect(sealNativeBrowserCredentials(f.profile, f.access, f.vaultKey,
      { platform: 'darwin', temporaryRoot: f.temporaryRoot })).rejects.toThrow(/^browser-credentials-read-failed$/)
    expect(readdirSync(f.temporaryRoot)).toEqual([])
  })

  test('invalid URLs, empty values and bad CBC padding are skipped without vault publication', async () => {
    const f = fixture()
    const db = store(join(f.profile.path, 'Login Data'))
    db.insert(cbc('local-secret', f.key), 'local', 'file:///tmp/private')
    db.insert(cbc('embedded-secret', f.key), 'embedded', 'https://user:password@example.test/')
    db.insert(cbc('', f.key))
    db.insert(Buffer.from('v10broken'))
    db.database.close()
    expect(await sealNativeBrowserCredentials(f.profile, f.access, f.vaultKey, { platform: 'darwin', temporaryRoot: f.temporaryRoot }))
      .toEqual({ sealedBlob: null, count: 0, skipped: 4, unsupported: 0 })
  })
})
