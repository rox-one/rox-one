import { describe, expect, it } from 'bun:test'
import { createCipheriv, createHash } from 'node:crypto'
import {
  browserNameFor,
  chromiumExpiryToUnix,
  decryptChromiumValue,
  deriveChromiumKey,
  safeStorageServiceFor,
  toElectronCookie,
} from '../browser-cookie-crypto'

function encryptV10(plain: Buffer, key: Buffer): Buffer {
  const cipher = createCipheriv('aes-128-cbc', key, Buffer.alloc(16, 0x20))
  return Buffer.concat([Buffer.from('v10'), cipher.update(plain), cipher.final()])
}

describe('browser cookie crypto', () => {
  const key = deriveChromiumKey('secret-from-keychain')

  it('decrypts v10 values (legacy and meta v24 host-hash prefix)', () => {
    expect(decryptChromiumValue(encryptV10(Buffer.from('abc123'), key), key, 18)).toBe('abc123')
    const hash = createHash('sha256').update('.example.com').digest()
    const withHash = encryptV10(Buffer.concat([hash, Buffer.from('tok')]), key)
    expect(decryptChromiumValue(withHash, key, 24)).toBe('tok')
  })

  it('returns null for wrong key or unknown prefix', () => {
    expect(decryptChromiumValue(encryptV10(Buffer.from('abc'), key), deriveChromiumKey('other'), 18)).toBeNull()
    expect(decryptChromiumValue(Buffer.from('v20xxxxxxxxxxxxxxxx'), key, 24)).toBeNull()
    expect(decryptChromiumValue(null, key, 24)).toBeNull()
  })

  it('maps rows to Electron cookies and drops expired ones', () => {
    const future = (Date.now() / 1000 + 3600 + 11_644_473_600) * 1_000_000
    const cookie = toElectronCookie(
      { host_key: '.example.com', name: 'sid', value: '', encrypted_value: null, path: '/', expires_utc: future, is_secure: 1, is_httponly: 1, samesite: 0 },
      'v',
    )
    expect(cookie?.url).toBe('https://example.com/')
    expect(cookie?.domain).toBe('.example.com')
    expect(cookie?.sameSite).toBe('no_restriction')
    const hostOnly = toElectronCookie(
      { host_key: 'app.example.com', name: 'a', value: '', encrypted_value: null, path: '/x', expires_utc: 0, is_secure: 0, is_httponly: 0, samesite: 0 },
      'v',
    )
    expect(hostOnly?.domain).toBeUndefined()
    expect(hostOnly?.sameSite).toBe('unspecified')
    expect(hostOnly?.expirationDate).toBeUndefined()
    expect(
      toElectronCookie(
        { host_key: '.old.com', name: 'x', value: '', encrypted_value: null, path: '/', expires_utc: 13_000_000_000_000_000, is_secure: 1, is_httponly: 0, samesite: 1 },
        'v',
      ),
    ).toBeNull()
    expect(chromiumExpiryToUnix(0)).toBeUndefined()
  })

  it('picks keychain service and name per browser', () => {
    expect(safeStorageServiceFor('/Users/a/Library/Application Support/Google/Chrome/Default')).toBe('Chrome Safe Storage')
    expect(safeStorageServiceFor('/Users/a/Library/Application Support/BraveSoftware/Brave-Browser/Default')).toBe('Brave Safe Storage')
    expect(browserNameFor('/Users/a/Library/Application Support/Microsoft Edge/Default')).toBe('Microsoft Edge')
  })
})
