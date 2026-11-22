import { describe, expect, it } from 'bun:test'
import {
  KeyStoreError,
  addCredential,
  assertWithinCap,
  createMemoryKeyStore,
  decryptSecret,
  disableCredential,
  encryptSecret,
  fingerprintSecret,
  lastFour,
  listCredentials,
  markHealth,
  promoteCredential,
  type AddCredentialInput,
  type KeyStore,
  type ProviderCredential,
} from '../index.ts'

const MASTER_KEY = new Uint8Array(32).fill(7)
const OTHER_MASTER_KEY = new Uint8Array(32).fill(9)
const SECRET = 'dt_live_secret_0001'

function newStore(iso = '2026-11-19T10:00:00.000Z'): KeyStore {
  return createMemoryKeyStore({ now: () => new Date(iso) })
}

function input(overrides: Partial<AddCredentialInput> = {}): AddCredentialInput {
  return {
    tenantId: 'ten_1',
    provider: 'daytona',
    label: 'Primary key',
    secret: SECRET,
    spendCapCents: 5_000,
    ...overrides,
  }
}

describe('credential crypto', () => {
  it('round-trips a secret through AES-256-GCM', () => {
    const encrypted = encryptSecret(SECRET, MASTER_KEY)
    expect(encrypted.ciphertext.length).toBeGreaterThan(0)
    expect(encrypted.iv.length).toBeGreaterThan(0)
    expect(encrypted.tag.length).toBeGreaterThan(0)
    expect(decryptSecret(encrypted, MASTER_KEY)).toBe(SECRET)
  })

  it('uses a fresh IV per encryption', () => {
    const first = encryptSecret(SECRET, MASTER_KEY)
    const second = encryptSecret(SECRET, MASTER_KEY)
    expect(first.iv).not.toBe(second.iv)
    expect(first.ciphertext).not.toBe(second.ciphertext)
  })

  it('throws on a wrong master key', () => {
    const encrypted = encryptSecret(SECRET, MASTER_KEY)
    expect(() => decryptSecret(encrypted, OTHER_MASTER_KEY)).toThrow()
  })

  it('throws on tampered ciphertext', () => {
    const encrypted = encryptSecret(SECRET, MASTER_KEY)
    const bytes = Buffer.from(encrypted.ciphertext, 'base64')
    const firstByte = bytes[0] ?? 0
    bytes[0] = firstByte ^ 0xff
    const tampered = { ...encrypted, ciphertext: bytes.toString('base64') }
    expect(() => decryptSecret(tampered, MASTER_KEY)).toThrow()
  })

  it('throws on a tampered tag and a tampered iv', () => {
    const encrypted = encryptSecret(SECRET, MASTER_KEY)
    const tag = Buffer.from(encrypted.tag, 'base64')
    const tagByte = tag[0] ?? 0
    tag[0] = tagByte ^ 0xff
    expect(() => decryptSecret({ ...encrypted, tag: tag.toString('base64') }, MASTER_KEY)).toThrow()

    const iv = Buffer.from(encrypted.iv, 'base64')
    const ivByte = iv[0] ?? 0
    iv[0] = ivByte ^ 0xff
    expect(() => decryptSecret({ ...encrypted, iv: iv.toString('base64') }, MASTER_KEY)).toThrow()
  })

  it('rejects a master key that is not 32 bytes', () => {
    const shortKey = new Uint8Array(16).fill(1)
    expect(() => encryptSecret(SECRET, shortKey)).toThrow()
    const encrypted = encryptSecret(SECRET, MASTER_KEY)
    expect(() => decryptSecret(encrypted, shortKey)).toThrow()
  })

  it('fingerprints to sha256 hex and reports the last four characters', () => {
    expect(fingerprintSecret(SECRET)).toMatch(/^[0-9a-f]{64}$/)
    expect(fingerprintSecret(SECRET)).not.toBe(fingerprintSecret(`${SECRET}2`))
    expect(lastFour(SECRET)).toBe('0001')
  })
})

describe('adding credentials', () => {
  it('returns metadata without the secret and stores ciphertext only', () => {
    const store = newStore()
    const meta = addCredential(store, MASTER_KEY, input())

    expect(meta.fingerprint).toBe(fingerprintSecret(SECRET))
    expect(meta.last4).toBe('0001')
    expect(meta.health).toBe('unknown')
    expect(meta.checkedAt).toBeNull()
    expect(meta.createdAt).toBe('2026-11-19T10:00:00.000Z')
    expect(meta.status).toBe('active')
    expect(Object.keys(meta)).not.toContain('secret')
    expect(Object.keys(meta)).not.toContain('ciphertext')
    expect(Object.values(meta)).not.toContain(SECRET)

    expect(store.records.size).toBe(1)
    const stored = [...store.records.values()][0]!
    expect(Object.values(stored)).not.toContain(SECRET)
    expect(JSON.stringify([...store.records.values()])).not.toContain(SECRET)
    expect(decryptSecret(stored, MASTER_KEY)).toBe(SECRET)
  })

  it('keeps optional metadata only when supplied', () => {
    const store = newStore()
    const plain = addCredential(store, MASTER_KEY, input())
    expect(plain.expiresAt).toBeUndefined()
    expect(plain.regions).toBeUndefined()

    const full = addCredential(
      store,
      MASTER_KEY,
      input({
        secret: 'mdo_live_secret_0002',
        provider: 'modal',
        expiresAt: '2027-01-01T00:00:00.000Z',
        regions: ['us-east'],
        products: ['flux'],
      }),
    )
    expect(full.expiresAt).toBe('2027-01-01T00:00:00.000Z')
    expect(full.regions).toEqual(['us-east'])
    expect(full.products).toEqual(['flux'])
  })

  it('rejects an empty secret', () => {
    const store = newStore()
    const failure = (): unknown => addCredential(store, MASTER_KEY, input({ secret: '' }))
    expect(failure).toThrow(KeyStoreError)
    expect(failure).toThrow('empty')
    expect(store.records.size).toBe(0)
  })

  it('rejects a secret shorter than eight characters', () => {
    const store = newStore()
    try {
      addCredential(store, MASTER_KEY, input({ secret: 'short12' }))
      throw new Error('expected rejection')
    } catch (error) {
      expect(error).toBeInstanceOf(KeyStoreError)
      expect((error as KeyStoreError).code).toBe('secret_too_short')
    }
    expect(store.records.size).toBe(0)
  })

  it('rejects a duplicate fingerprint for the same tenant', () => {
    const store = newStore()
    addCredential(store, MASTER_KEY, input())
    try {
      addCredential(store, MASTER_KEY, input({ provider: 'modal', label: 'Again' }))
      throw new Error('expected rejection')
    } catch (error) {
      expect(error).toBeInstanceOf(KeyStoreError)
      expect((error as KeyStoreError).code).toBe('duplicate_fingerprint')
    }
    expect(store.records.size).toBe(1)
  })

  it('allows the same secret for a different tenant', () => {
    const store = newStore()
    addCredential(store, MASTER_KEY, input())
    const other = addCredential(store, MASTER_KEY, input({ tenantId: 'ten_2' }))
    expect(other.tenantId).toBe('ten_2')
    expect(store.records.size).toBe(2)
  })
})

describe('listing credentials', () => {
  it('never exposes ciphertext, iv or tag', () => {
    const store = newStore()
    addCredential(store, MASTER_KEY, input())
    addCredential(store, MASTER_KEY, input({ secret: 'mdo_live_secret_0002', provider: 'modal' }))

    const rows = listCredentials(store, 'ten_1')
    expect(rows.length).toBe(2)
    for (const row of rows) {
      expect(row).not.toHaveProperty('ciphertext')
      expect(row).not.toHaveProperty('iv')
      expect(row).not.toHaveProperty('tag')
      expect(row).not.toHaveProperty('secret')
    }
    expect(Object.keys(rows[0]!).sort()).toEqual(
      [
        'checkedAt',
        'createdAt',
        'fingerprint',
        'health',
        'id',
        'label',
        'last4',
        'provider',
        'spendCapCents',
        'status',
        'tenantId',
      ].sort(),
    )
  })

  it('filters by provider and by tenant', () => {
    const store = newStore()
    addCredential(store, MASTER_KEY, input())
    addCredential(store, MASTER_KEY, input({ secret: 'mdo_live_secret_0002', provider: 'modal' }))
    addCredential(store, MASTER_KEY, input({ tenantId: 'ten_2', secret: 'eb_live_secret_0003', provider: 'e2b' }))

    expect(listCredentials(store, 'ten_1').length).toBe(2)
    expect(listCredentials(store, 'ten_1', 'modal').map((row) => row.provider)).toEqual(['modal'])
    expect(listCredentials(store, 'ten_2').map((row) => row.provider)).toEqual(['e2b'])
  })
})

describe('rotation and lifecycle', () => {
  it('makes the first key active and later ones standby', () => {
    const store = newStore()
    const first = addCredential(store, MASTER_KEY, input())
    const second = addCredential(store, MASTER_KEY, input({ secret: 'dt_live_secret_0002', label: 'Backup' }))
    expect(first.status).toBe('active')
    expect(second.status).toBe('standby')
  })

  it('promote flips the previous active key to standby', () => {
    const store = newStore()
    const first = addCredential(store, MASTER_KEY, input())
    const second = addCredential(store, MASTER_KEY, input({ secret: 'dt_live_secret_0002', label: 'Backup' }))

    const promoted = promoteCredential(store, 'ten_1', second.id)
    expect(promoted.status).toBe('active')
    expect(store.records.get(first.id)!.status).toBe('standby')
    expect(listCredentials(store, 'ten_1').filter((row) => row.status === 'active').length).toBe(1)
  })

  it('promote leaves a disabled key of the same provider disabled', () => {
    const store = newStore()
    const first = addCredential(store, MASTER_KEY, input())
    const second = addCredential(store, MASTER_KEY, input({ secret: 'dt_live_secret_0002' }))
    disableCredential(store, 'ten_1', first.id)

    promoteCredential(store, 'ten_1', second.id)
    expect(store.records.get(first.id)!.status).toBe('disabled')
    expect(store.records.get(second.id)!.status).toBe('active')
  })

  it('promote does not touch another provider or another tenant', () => {
    const store = newStore()
    const daytona = addCredential(store, MASTER_KEY, input())
    const modal = addCredential(store, MASTER_KEY, input({ provider: 'modal', secret: 'mdo_live_secret_0002' }))
    const foreign = addCredential(store, MASTER_KEY, input({ tenantId: 'ten_2', secret: 'dt_live_secret_0003' }))
    const daytonaSecond = addCredential(store, MASTER_KEY, input({ secret: 'dt_live_secret_0004' }))

    promoteCredential(store, 'ten_1', daytonaSecond.id)
    expect(store.records.get(daytona.id)!.status).toBe('standby')
    expect(store.records.get(modal.id)!.status).toBe('active')
    expect(store.records.get(foreign.id)!.status).toBe('active')
  })

  it('records health and the check time', () => {
    const store = newStore('2026-11-19T10:00:00.000Z')
    const meta = addCredential(store, MASTER_KEY, input())
    const checked = markHealth(store, 'ten_1', meta.id, 'ok')
    expect(checked.health).toBe('ok')
    expect(checked.checkedAt).toBe('2026-11-19T10:00:00.000Z')
  })

  it('refuses to touch a credential of another tenant', () => {
    const store = newStore()
    const meta: ProviderCredential = addCredential(store, MASTER_KEY, input())
    expect(() => disableCredential(store, 'ten_2', meta.id)).toThrow(KeyStoreError)
    expect(() => promoteCredential(store, 'ten_2', meta.id)).toThrow(KeyStoreError)
    expect(() => markHealth(store, 'ten_2', meta.id, 'ok')).toThrow(KeyStoreError)
    expect(store.records.get(meta.id)!.status).toBe('active')
  })
})

describe('spend gating', () => {
  it('allows a spend at or under the cap', () => {
    const store = newStore()
    const meta = addCredential(store, MASTER_KEY, input({ spendCapCents: 5_000 }))
    expect(assertWithinCap(store, 'ten_1', meta.id, 4_999)).toBeNull()
    expect(assertWithinCap(store, 'ten_1', meta.id, 5_000)).toBeNull()
  })

  it('rejects a spend above the cap', () => {
    const store = newStore()
    const meta = addCredential(store, MASTER_KEY, input({ spendCapCents: 5_000 }))
    expect(assertWithinCap(store, 'ten_1', meta.id, 5_001)).toEqual({ error: 'spend_cap_exceeded' })
  })

  it('rejects use of a disabled credential', () => {
    const store = newStore()
    const meta = addCredential(store, MASTER_KEY, input())
    disableCredential(store, 'ten_1', meta.id)
    expect(assertWithinCap(store, 'ten_1', meta.id, 100)).toEqual({ error: 'credential_disabled' })
  })

  it('rejects use of an expired credential', () => {
    const store = newStore('2026-06-01T00:00:00.000Z')
    const meta = addCredential(store, MASTER_KEY, input({ expiresAt: '2026-01-01T00:00:00.000Z' }))
    expect(assertWithinCap(store, 'ten_1', meta.id, 100)).toEqual({ error: 'credential_expired' })

    const live = addCredential(
      store,
      MASTER_KEY,
      input({ secret: 'dt_live_secret_0002', expiresAt: '2027-01-01T00:00:00.000Z' }),
    )
    expect(assertWithinCap(store, 'ten_1', live.id, 100)).toBeNull()
  })

  it('rejects use of a credential marked expired', () => {
    const store = newStore()
    const meta = addCredential(store, MASTER_KEY, input())
    store.records.get(meta.id)!.status = 'expired'
    expect(assertWithinCap(store, 'ten_1', meta.id, 100)).toEqual({ error: 'credential_expired' })
  })

  it('refuses an unknown credential', () => {
    const store = newStore()
    expect(() => assertWithinCap(store, 'ten_1', 'cred_missing', 100)).toThrow(KeyStoreError)
  })
})
