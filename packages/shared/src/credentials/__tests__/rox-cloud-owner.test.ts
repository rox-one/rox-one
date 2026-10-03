import { describe, expect, it } from 'bun:test'
import { CredentialManager } from '../manager'
import { credentialIdToAccount, type CredentialId, type StoredCredential } from '../types'
import type { CredentialBackend } from '../backends/types'

function fixture() {
  const values = new Map<string, StoredCredential>()
  const backend: CredentialBackend = { name: 'synthetic-memory', priority: 1, isAvailable: async () => true,
    get: async id => values.get(credentialIdToAccount(id)) ?? null,
    set: async (id, value) => { values.set(credentialIdToAccount(id), value) },
    delete: async id => values.delete(credentialIdToAccount(id)), list: async () => [] as CredentialId[] }
  return { manager: new CredentialManager({ backends: [backend] }), values, backend }
}
const session = (userId: string) => ({ accessToken: `synthetic-${userId}`, userId, name: userId, email: `${userId}@example.test`, expiresAt: Date.now() + 60_000 })
const ownerA = { issuer: 'synthetic-server-a', subject: 'synthetic-native-user' }
const ownerB = { issuer: 'synthetic-server-b', subject: 'synthetic-native-user' }

describe('Rox Connect native credential isolation', () => {
  it('never inherits the host cloud account and isolates same subject across issuers', async () => {
    const { manager, values } = fixture()
    await manager.setRoxCloudSession(session('host-user'))
    expect(await manager.getRoxCloudSession(ownerA)).toBeNull()
    await manager.setRoxCloudSession(session('native-a'), ownerA)
    await manager.setRoxCloudSession(session('native-b'), ownerB)
    expect((await manager.getRoxCloudSession())?.userId).toBe('host-user')
    expect((await manager.getRoxCloudSession(ownerA))?.userId).toBe('native-a')
    expect((await manager.getRoxCloudSession(ownerB))?.userId).toBe('native-b')
    expect(values.size).toBe(3)
    expect([...values.keys()].filter(value => value !== 'service_oauth::global::rox-cloud').every(value => /^service_oauth::global::rox-cloud-[0-9a-f]{64}$/.test(value))).toBe(true)
  })
  it('logout clears only the authenticated caller namespace', async () => {
    const { manager } = fixture()
    await manager.setRoxCloudSession(session('host-user'))
    await manager.setRoxCloudSession(session('native-a'), ownerA)
    await manager.setRoxCloudSession(session('native-b'), ownerB)
    await manager.clearRoxCloudSession(ownerA)
    expect(await manager.hasRoxCloudSession(ownerA)).toBe(false)
    expect(await manager.hasRoxCloudSession(ownerB)).toBe(true)
    expect(await manager.hasRoxCloudSession()).toBe(true)
  })
  it('reports an expired own session as disconnected without falling back', async () => {
    const { manager } = fixture()
    await manager.setRoxCloudSession(session('host-user'))
    await manager.setRoxCloudSession({ ...session('native-a'), expiresAt: Date.now() - 1 }, ownerA)
    expect(await manager.hasRoxCloudSession(ownerA)).toBe(false)
    expect(await manager.hasRoxCloudSession()).toBe(true)
  })
  it('surfaces secure-store deletion failure instead of claiming a completed logout', async () => {
    const { manager, backend } = fixture()
    await manager.setRoxCloudSession(session('native-a'), ownerA)
    backend.delete = async () => { throw new Error('sensitive backend detail') }
    await expect(manager.clearRoxCloudSession(ownerA)).rejects.toThrow('ROX_CLOUD_CLEAR_FAILED')
    expect(await manager.hasRoxCloudSession(ownerA)).toBe(true)
  })

})
