import { RoxAccountAuthority, type PocketAccountRecord, type PocketClient, type PocketBinding } from '../rox-account-authority.ts'
import type { RoxAccountSnapshot } from '../rox-pocket-client.ts'
export const pocketSnapshot = (id = 'account-a', amount = '500.000000'): RoxAccountSnapshot => ({ state: 'ready', user: { id, email: 'same@example.test', emailVerified: true, name: 'Cloud name', handle: 'fixture', profileUrl: 'https://rox.one/@fixture' }, organization: { id: 'org-' + id, name: 'Personal', slug: 'fixture', role: 'owner' }, balance: { currency: 'ROX', balanceRox: amount, availableRox: amount, heldRox: '0.000000', bonusStatus: 'granted' }, key: { id: 'key-' + id, prefix: 'fixture_', generation: 1, status: 'active' }, updatedAt: new Date().toISOString() })
export function createPocketFixture(id = 'account-a', amount = '500.000000') {
  const records = new Map<string, PocketAccountRecord>(), bindings = new Map<string, PocketBinding>()
  const key = (caller: unknown) => JSON.stringify(caller)
  let snapshot = pocketSnapshot(id, amount)
  let refreshes: string[] = [], logouts = 0
  const client: PocketClient = {
    start: async () => ({ started: { deviceCode: 'device-proof', userCode: 'USER-CODE', verificationUri: 'https://rox.one/login/device?v=2', verificationUriComplete: 'https://rox.one/login/device?v=2&user_code=USER-CODE', interval: 5, expiresIn: 900 }, proof: { codeVerifier: 'proof-main-only', redemptionId: 'redemption-main-only' } }),
    wait: async () => ({ status: 'approved', accessToken: 'access-fixture', refreshToken: 'refresh-fixture', tokenType: 'Bearer', expiresIn: 900, user: { id: snapshot.user.id, email: snapshot.user.email, name: 'Cloud name' } }),
    refresh: async (_token, refreshId) => { refreshes.push(refreshId); return { status: 'approved', accessToken: 'rotated-access-fixture', refreshToken: 'rotated-refresh-fixture', tokenType: 'Bearer', expiresIn: 900, user: { id: snapshot.user.id, email: snapshot.user.email, name: 'Cloud name' } } },
    logout: async () => { logouts++ },
    account: async () => snapshot,
    credential: async (_token, state) => ({ accountId: state.user.id, keyId: state.key!.id, generation: state.key!.generation, apiKey: 'account-key-fixture', baseUrl: 'https://api.rox.one/v1' }),
  }
  const store = {
    async read(caller: unknown) { return records.get(key(caller)) ?? null },
    async write(caller: unknown, record: PocketAccountRecord) { records.set(key(caller), structuredClone(record)) },
    async clear(caller: unknown) { records.delete(key(caller)) },
    async readBinding(resource: string) { return bindings.get(resource) ?? null },
    async writeBinding(resource: string, binding: PocketBinding) { bindings.set(resource, structuredClone(binding)) },
  }
  const authority = new RoxAccountAuthority(store, client)
  return { authority, records, bindings, client, store, refreshes, get logouts() { return logouts }, setSnapshot(value: RoxAccountSnapshot) { snapshot = value } }
}
