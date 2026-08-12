/**
 * secrets/providers/local.ts — CredentialManager adapter.
 */
import { describe, expect, it } from 'bun:test'
import type { CredentialId, StoredCredential } from '../../credentials/types.ts'
import { LocalEncryptedProvider, defaultLocalRefFor } from '../providers/local.ts'

function fakeManager(store: Record<string, StoredCredential>) {
  return {
    async get(id: CredentialId): Promise<StoredCredential | null> {
      const { credentialIdToAccount } = await import('../../credentials/types.ts')
      return store[credentialIdToAccount(id)] ?? null
    },
    async list(): Promise<CredentialId[]> {
      const { accountToCredentialId } = await import('../../credentials/types.ts')
      return Object.keys(store)
        .map((account) => accountToCredentialId(account))
        .filter((id): id is CredentialId => id !== null)
    },
  }
}

describe('defaultLocalRefFor', () => {
  it('derives a global service_oauth account from the logical name', () => {
    expect(defaultLocalRefFor('my-secret')).toBe('service_oauth::global::my-secret')
  })
})

describe('LocalEncryptedProvider', () => {
  it('is available when the credential store is usable', async () => {
    const p = new LocalEncryptedProvider({ manager: fakeManager({}) })
    expect(p.id).toBe('local-encrypted')
    expect(await p.isAvailable()).toBe(true)
  })

  it('resolves a stored credential value by explicit account ref', async () => {
    const manager = fakeManager({
      'llm_api_key::my-conn': { value: 'sk-local-value' },
    })
    const p = new LocalEncryptedProvider({ manager })
    expect(await p.resolve({ name: 'x', ref: 'llm_api_key::my-conn' })).toBe('sk-local-value')
  })

  it('resolves via the derived default ref when ref is omitted', async () => {
    const manager = fakeManager({
      'service_oauth::global::my-secret': { value: 'derived-value' },
    })
    const p = new LocalEncryptedProvider({ manager })
    expect(await p.resolve({ name: 'my-secret' })).toBe('derived-value')
  })

  it('returns null when the credential does not exist', async () => {
    const p = new LocalEncryptedProvider({ manager: fakeManager({}) })
    expect(await p.resolve({ name: 'missing', ref: 'llm_api_key::nope' })).toBeNull()
  })

  it('returns null for an unparseable account ref', async () => {
    const p = new LocalEncryptedProvider({ manager: fakeManager({}) })
    expect(await p.resolve({ name: 'x', ref: 'not-a-valid-account' })).toBeNull()
  })

  it('propagates backend errors as null (treated as not found, never throws)', async () => {
    const p = new LocalEncryptedProvider({
      manager: {
        async get(): Promise<StoredCredential | null> {
          throw new Error('decryption failed')
        },
      },
    })
    expect(await p.resolve({ name: 'x', ref: 'llm_api_key::my-conn' })).toBeNull()
  })

  it('lists stored credentials as refs', async () => {
    const manager = fakeManager({
      'llm_api_key::my-conn': { value: 'v1' },
      'service_oauth::global::my-secret': { value: 'v2' },
    })
    const p = new LocalEncryptedProvider({ manager })
    const refs = await p.list!()
    expect(refs.map((r) => r.ref).sort()).toEqual([
      'llm_api_key::my-conn',
      'service_oauth::global::my-secret',
    ])
  })
})
