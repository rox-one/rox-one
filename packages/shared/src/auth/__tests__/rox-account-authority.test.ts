import { describe, expect, it, setSystemTime } from 'bun:test'
import { RoxAccountAuthority, LOCAL_ROX_CALLER } from '../rox-account-authority.ts'
import { createPocketFixture, pocketSnapshot } from './pocket-test-fixture.ts'
const native = { issuer: 'https://native.example.test', subject: 'native-a' }
async function connect(fixture: ReturnType<typeof createPocketFixture>, caller = LOCAL_ROX_CALLER) { await fixture.authority.start(caller); for (let i = 0; i < 100; i++) { if ((await fixture.authority.state(caller)).connected) return; await Bun.sleep(1) } throw Error('approval did not complete') }

describe('Pocket host account authority', () => {
 it('does not share native/local account credentials and never projects tokens/key', async () => {
  const f = createPocketFixture(); await connect(f)
  expect((await f.authority.state(native)).connected).toBe(false)
  const state = await f.authority.state(LOCAL_ROX_CALLER)
  expect(state.account?.organization.role).toBe('owner')
  expect(JSON.stringify(state)).not.toContain('access-fixture')
  expect(JSON.stringify(state)).not.toContain('account-key-fixture')
  expect(JSON.stringify(state)).not.toContain('refresh-fixture')
 })
 it('keeps zero balance authenticated and ready but rejects paid dispatch', async () => {
  const f = createPocketFixture('account-a', '0.000000'); await connect(f)
  const context = await f.authority.capture(LOCAL_ROX_CALLER)
  expect((await f.authority.state(LOCAL_ROX_CALLER)).connected).toBe(true)
  await expect(f.authority.inference(context)).rejects.toThrow('ROX_INSUFFICIENT_BALANCE')
  expect((await f.authority.inference(context, false)).accountId).toBe('account-a')
 })
 it('fences old executor and durable session/automation bindings on account switch', async () => {
  const f = createPocketFixture(); await connect(f)
  const old = await f.authority.capture(LOCAL_ROX_CALLER)
  await f.authority.bind('automation:workspace:owned-id', old)
  let invalidated = 0; f.authority.onInvalidated(() => invalidated++)
  await f.authority.logout(LOCAL_ROX_CALLER)
  expect(() => f.authority.assertCurrent(old)).toThrow('ROX_ACCOUNT_CHANGED')
  f.setSnapshot(pocketSnapshot('account-b')); await connect(f)
  await expect(f.authority.bound('automation:workspace:owned-id')).rejects.toThrow('ROX_ACCOUNT_CHANGED')
  expect(invalidated).toBeGreaterThan(0)
  expect(f.logouts).toBe(1)
 })
 it('restores exact owned resources after restart without ambient fallback', async () => {
  const f = createPocketFixture(); await connect(f)
  const context = await f.authority.capture(LOCAL_ROX_CALLER)
  await f.authority.bind('session:workspace:session-a', context)
  const restarted = new RoxAccountAuthority(f.store, f.client)
  expect((await restarted.bound('session:workspace:session-a'))?.cloudAccountId).toBe('account-a')
  expect(await restarted.bound('session:workspace:unowned')).toBeUndefined()
 })
 it('persists refresh operation proof before dispatch, retries same id after dropped response', async () => {
  const f = createPocketFixture(); await connect(f)
  const stored = f.records.get(JSON.stringify(LOCAL_ROX_CALLER))!; stored.expiresAt = 0
  const attempts: string[] = []
  f.client.refresh = async (_token, id) => { attempts.push(id); if (attempts.length === 1) throw new TypeError('lost response'); return { status: 'approved', accessToken: 'new-access', refreshToken: 'new-refresh', tokenType: 'Bearer', expiresIn: 900, user: { id: 'account-a', email: 'same@example.test', name: 'Cloud' } } }
  const restarted = new RoxAccountAuthority(f.store, f.client)
  expect((await restarted.state(LOCAL_ROX_CALLER)).connected).toBe(false)
  expect(f.records.get(JSON.stringify(LOCAL_ROX_CALLER))?.refreshId).toBe(attempts[0])
  const relaunched = new RoxAccountAuthority(f.store, f.client)
  expect((await relaunched.state(LOCAL_ROX_CALLER)).connected).toBe(true)
  expect(attempts[0]).toBe(attempts[1])
  expect(f.records.get(JSON.stringify(LOCAL_ROX_CALLER))).toMatchObject({ accessToken: 'new-access', refreshToken: 'new-refresh', refreshId: undefined })
 })
 it('refreshes expired access and durably clears pending proof before inference without a UI poll', async () => {
  const f = createPocketFixture(); await connect(f)
  const context = await f.authority.capture(LOCAL_ROX_CALLER)
  const key = JSON.stringify(LOCAL_ROX_CALLER)
  let sent = false
  f.client.refresh = async (_token, id) => {
   expect(f.records.get(key)?.refreshId).toBe(id)
   sent = true
   return { status: 'approved', accessToken: 'fresh-access', refreshToken: 'fresh-refresh', tokenType: 'Bearer', expiresIn: 900, user: { id: 'account-a', email: 'same@example.test', name: 'Cloud' } }
  }
  setSystemTime(new Date(Date.now() + 901_000))
  try {
   expect((await f.authority.inference(context)).accountId).toBe('account-a')
   expect(sent).toBe(true)
   expect(f.records.get(key)).toMatchObject({ accessToken: 'fresh-access', refreshToken: 'fresh-refresh', refreshId: undefined })
  } finally { setSystemTime() }
 })
 it('ignores a late bootstrap response after logout and removes persisted secrets', async () => {
  const f = createPocketFixture(); await connect(f)
  let resolve!: (value: ReturnType<typeof pocketSnapshot>) => void
  f.client.account = () => new Promise(done => { resolve = done })
  const oldRead = f.authority.state(LOCAL_ROX_CALLER)
  await Bun.sleep(1)
  const logout = f.authority.logout(LOCAL_ROX_CALLER)
  await Bun.sleep(1); resolve(pocketSnapshot())
  await oldRead; await logout
  expect(f.records.size).toBe(0)
  expect((await f.authority.state(LOCAL_ROX_CALLER)).connected).toBe(false)
 })
 it('uses sealed prior access proof to revoke a device after an in-flight refresh rotation', async () => {
  const f = createPocketFixture(); await connect(f)
  const stored = f.records.get(JSON.stringify(LOCAL_ROX_CALLER))!; stored.expiresAt = 0
  let firstResolve!: (value: any) => void
  let sentId: string | undefined
  const approved = { status: 'approved' as const, accessToken: 'current-device-access', refreshToken: 'current-device-refresh', tokenType: 'Bearer', expiresIn: 900, user: { id: 'account-a', email: 'same@example.test', name: 'Cloud' } }
  f.client.refresh = async (_token, id) => { if (!sentId) { sentId = id; return new Promise(resolve => { firstResolve = resolve }) } expect(id).toBe(sentId); return approved }
  let revoked: string | undefined; f.client.logout = async token => { revoked = token }
  const restarted = new RoxAccountAuthority(f.store, f.client)
  const read = restarted.state(LOCAL_ROX_CALLER); await Bun.sleep(1)
  const logout = restarted.logout(LOCAL_ROX_CALLER); await Bun.sleep(1)
  firstResolve(approved); await read; await logout
  expect(revoked).toBe('access-fixture')
  expect(f.records.size).toBe(0)
 })
 it('fences a running executor when account key generation changes', async () => {
  const f = createPocketFixture(); await connect(f)
  const context = await f.authority.capture(LOCAL_ROX_CALLER)
  const snapshot = pocketSnapshot(); snapshot.key!.generation = 2; f.setSnapshot(snapshot)
  expect((await f.authority.state(LOCAL_ROX_CALLER)).connected).toBe(true)
  expect(() => f.authority.assertCurrent(context)).toThrow('ROX_ACCOUNT_CHANGED')
  expect((await f.authority.capture(LOCAL_ROX_CALLER)).authGeneration).not.toBe(context.authGeneration)
 })
 it('invalidates the running executor when the active key is revoked', async () => {
  const f = createPocketFixture(); await connect(f)
  const context = await f.authority.capture(LOCAL_ROX_CALLER)
  let invalidated = 0; f.authority.onInvalidated(() => { invalidated++ })
  const snapshot = pocketSnapshot(); snapshot.key!.status = 'revoked'; f.setSnapshot(snapshot)
  expect((await f.authority.state(LOCAL_ROX_CALLER)).connected).toBe(false)
  expect(invalidated).toBe(1)
  expect(() => f.authority.assertCurrent(context)).toThrow('ROX_ACCOUNT_CHANGED')
 })
 it('keeps failed device revocation sealed for retry after process restart', async () => {
  const f = createPocketFixture(); await connect(f)
  const context = await f.authority.capture(LOCAL_ROX_CALLER)
  f.client.logout = async () => { throw new TypeError('broker offline') }
  await expect(f.authority.logout(LOCAL_ROX_CALLER)).rejects.toThrow('broker offline')
  expect(() => f.authority.assertCurrent(context)).toThrow('ROX_ACCOUNT_CHANGED')
  expect(f.records.size).toBe(0)
  expect(f.pendingLogouts.size).toBe(1)
  let revoked: string | undefined; f.client.logout = async token => { revoked = token }
  const relaunched = new RoxAccountAuthority(f.store, f.client)
  await relaunched.logout(LOCAL_ROX_CALLER)
  expect(revoked).toBe('access-fixture')
  expect(f.pendingLogouts.size).toBe(0)
  expect((await relaunched.state(LOCAL_ROX_CALLER)).connected).toBe(false)
 })
 it('revokes via logout-only prior access proof without an expired refresh replay', async () => {
  const f = createPocketFixture(); await connect(f)
  const record = f.records.get(JSON.stringify(LOCAL_ROX_CALLER))!
  record.expiresAt = 0; record.refreshId = 'consumed-refresh-proof'
  let refreshed = false; f.client.refresh = async () => { refreshed = true; throw new Error('ROX_AUTH_EXPIRED') }
  let revoked: string | undefined; f.client.logout = async token => { revoked = token }
  const relaunched = new RoxAccountAuthority(f.store, f.client)
  await relaunched.logout(LOCAL_ROX_CALLER)
  expect(revoked).toBe('access-fixture')
  expect(refreshed).toBe(false)
  expect(f.records.size).toBe(0)
  expect(f.pendingLogouts.size).toBe(0)
 })

})
