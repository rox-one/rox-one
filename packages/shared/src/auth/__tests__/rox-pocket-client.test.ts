import { afterEach, describe, expect, it } from 'bun:test'
import { createHash } from 'node:crypto'
import { startPocketDeviceFlow, waitForPocketApproval, fetchPocketCredential, fetchPocketAccount, refreshPocketSession } from '../rox-pocket-client.ts'
import { pocketSnapshot } from './pocket-test-fixture.ts'
const previous = globalThis.fetch
const respond = (data: unknown) => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } })
const approved = { status: 'approved', access_token: 'access-main-only', refresh_token: 'refresh-main-only', token_type: 'Bearer', expires_in: 900, user: { id:'account-a',email:'same@example.test',name:null } }
afterEach(() => { globalThis.fetch = previous })
describe('Pocket v2 proof client', () => {
 it('uses S256 proof and operation id exclusively in main requests', async () => {
  const wire: Array<{ url: string; body: any }> = []
  globalThis.fetch = (async (url, options) => { wire.push({url:String(url),body:JSON.parse(String(options?.body))}); return respond(String(url).endsWith('/start') ? { device_code:'device-main',user_code:'USER-CODE',verification_uri:'https://rox.one/login/device?v=2',expires_in:900,interval:5 } : approved) }) as typeof fetch
  const controller = new AbortController()
  const start = await startPocketDeviceFlow(controller.signal)
  expect(wire[0]?.url).toBe('https://rox.one/api/auth/device/v2/start')
  expect(wire[0]?.body).toEqual({ clientId:'craft-agents-desktop',code_challenge:createHash('sha256').update(start.proof.codeVerifier).digest('base64url'),code_challenge_method:'S256' })
  expect(start.proof.codeVerifier).toHaveLength(43)
  const result = await waitForPocketApproval(start.started.deviceCode,start.proof,{timeoutMs:1000,interval:2,signal:controller.signal})
  expect(result.refreshToken).toBe('refresh-main-only')
  expect(wire[1]?.body).toEqual({device_code:'device-main',code_verifier:start.proof.codeVerifier,redemption_id:start.proof.redemptionId})
 })
 it('rejects foreign broker redirect and malformed token envelopes', async () => {
  globalThis.fetch = (async () => respond({device_code:'d',user_code:'u',verification_uri:'https://evil.example.test/auth',expires_in:900})) as typeof fetch
  await expect(startPocketDeviceFlow(new AbortController().signal)).rejects.toThrow('ROX_AUTH_INVALID_RESPONSE')
  globalThis.fetch = (async () => respond({...approved,refresh_token:null})) as typeof fetch
  await expect(refreshPocketSession('fixture-refresh','fixture-operation')).rejects.toThrow('ROX_AUTH_INVALID_RESPONSE')
 })
 it('cancels a late approval even when HTTP transport ignores its abort', async () => {
  const controller = new AbortController()
  globalThis.fetch = (async () => { controller.abort(); return respond(approved) }) as typeof fetch
  await expect(waitForPocketApproval('device',{codeVerifier:'proof',redemptionId:'operation'},{timeoutMs:1000,interval:2,signal:controller.signal})).rejects.toThrow('ROX_CONNECT_CANCELLED')
 })
 it('rejects foreign-account credential and a redirected inference base', async () => {
  globalThis.fetch = (async () => respond({accountId:'account-b',keyId:'key-account-a',generation:1,apiKey:'fixture-secret',baseUrl:'https://api.rox.one/v1'})) as typeof fetch
  await expect(fetchPocketCredential('access-fixture',pocketSnapshot())).rejects.toThrow('ROX_AUTH_INVALID_RESPONSE')
  globalThis.fetch = (async () => respond({...pocketSnapshot(),balance:{currency:'ROX',balanceRox:'NaN',heldRox:'0.000000',availableRox:'0.000000'}})) as typeof fetch
  await expect(fetchPocketAccount('access-fixture')).rejects.toThrow('ROX_AUTH_INVALID_RESPONSE')
 })
 it('projects account snapshot without credential canaries even if the server sends accidental extra fields', async () => {
  const snapshot = pocketSnapshot()
  globalThis.fetch = (async () => respond({ ...snapshot, access_token:'ACCESS_CANARY',refresh_token:'REFRESH_CANARY',apiKey:'KEY_CANARY',user:{...snapshot.user,accessToken:'NESTED_CANARY'},key:{...snapshot.key,apiKey:'KEY_CANARY'} })) as typeof fetch
  const serialized = JSON.stringify(await fetchPocketAccount('access-fixture'))
  for (const canary of ['ACCESS_CANARY','REFRESH_CANARY','KEY_CANARY','NESTED_CANARY']) expect(serialized).not.toContain(canary)
 })

 it('reuses the same redemption proof after a dropped approved response', async () => {
  const wire: unknown[] = []
  globalThis.fetch = (async (_url, options) => { wire.push(JSON.parse(String(options?.body))); if (wire.length === 1) throw new TypeError('lost response'); return respond(approved) }) as typeof fetch
  const result = await waitForPocketApproval('device',{codeVerifier:'stable-proof',redemptionId:'stable-operation'},{timeoutMs:4000,interval:2,signal:new AbortController().signal})
  expect(result.accessToken).toBe('access-main-only')
  expect(wire).toHaveLength(2)
  expect(wire[0]).toEqual(wire[1])
 }, 5000)

})
