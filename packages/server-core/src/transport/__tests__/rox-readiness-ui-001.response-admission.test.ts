import { afterEach, expect, test } from 'bun:test'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import WebSocket from 'ws'
import { CodedError, PROTOCOL_VERSION, type MessageEnvelope } from '@rox/shared/protocol'
import { WsRpcServer } from '../server'
import { deserializeEnvelope } from '../codec'
import type { WorkspaceAuthoritySession } from '../types'

const cleanups: Array<() => void> = []
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup() })

// The trusted resolver is controlled here; the socket, dispatch, response guard
// and serialization are production code. This is not persisted-auth acceptance.
async function ordinaryGuardFixture(expiresAt = Date.now() + 60_000) {
  const workspaceId = '00000000-0000-4000-8000-000000000002'
  function session(sessionId: string): WorkspaceAuthoritySession {
    const actor = { principalId: 'guard-principal', sessionId, deviceId: 'guard-device',
      expiresAt, authenticatedWorkspaceIds: [workspaceId] }
    return { actor, identity: { issuer: 'guard-fixture', subject: 'guard-subject',
      principalId: actor.principalId, sessionId, deviceId: actor.deviceId, expiresAt } }
  }
  let current = session('original-session')
  let revoked = false
  let trackingRequest = false
  let requestRevalidations = 0
  let guardCalls = 0
  let serializations = 0
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  cleanups.push(() => release.resolve())
  const server = new WsRpcServer({ host: '127.0.0.1', port: 0, requireAuth: true,
    workspaceAuthority: {
      authenticate: async token => {
        if (revoked || (token !== 'fixture.header.signature' && token !== 'replacement.header.signature')) {
          throw new CodedError('AUTH_FAILED', 'Synthetic session denied')
        }
        return current
      },
      revalidate: async () => {
        if (trackingRequest) requestRevalidations++
        if (revoked) throw new CodedError('AUTH_FAILED', 'Synthetic session revoked')
        return current
      },
    } })
  cleanups.push(() => server.close())
  server.handle('test:ordinary-guard', () => ({
    toJSON() { serializations++; return { content: 'PRIVATE_GUARDED_BYTES' } },
  }), { access: 'authenticatedWorkspace', beforeResponse: async (context, args, result) => {
    expect(context.workspaceId).toBe(workspaceId)
    expect(context.actor?.principalId).toBe('guard-principal')
    expect(context.principal).toBeUndefined()
    expect(args).toEqual(['captured-request-scope'])
    expect(result).toHaveProperty('toJSON')
    guardCalls++
    if (guardCalls === 1) { entered.resolve(); await release.promise }
  } })
  await server.listen()

  async function connect(token: string) {
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}`)
    cleanups.push(() => socket.terminate())
    await once(socket, 'open')
    function response(id: string): Promise<MessageEnvelope> {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { socket.off('message', listener); reject(new Error('Guard fixture timed out')) }, 5000)
        const listener = (data: WebSocket.RawData) => {
          const message = deserializeEnvelope(data.toString())
          if (message.id !== id) return
          clearTimeout(timer); socket.off('message', listener); resolve(message)
        }
        socket.on('message', listener)
      })
    }
    const id = randomUUID()
    const ack = response(id)
    socket.send(JSON.stringify({ id, type: 'handshake', protocolVersion: PROTOCOL_VERSION, workspaceId, token }))
    expect((await ack).type).toBe('handshake_ack')
    return () => {
      const id = randomUUID()
      const pending = response(id)
      socket.send(JSON.stringify({ id, type: 'request', channel: 'test:ordinary-guard', args: ['captured-request-scope'] }))
      return pending
    }
  }
  const request = await connect('fixture.header.signature')
  trackingRequest = true
  return { entered, release, request, expiresAt,
    revoke: () => { revoked = true },
    regrantWithReplacementSession: () => { revoked = false; current = session('replacement-session') },
    connectReplacement: () => connect('replacement.header.signature'),
    guardCalls: () => guardCalls,
    serializations: () => serializations,
    revalidations: () => requestRevalidations }
}

function expectDenied(response: MessageEnvelope, serializations: number) {
  expect(response.error).toEqual({ code: 'AUTH_FAILED', message: 'Request failed' })
  expect(response.result).toBeUndefined()
  expect(JSON.stringify(response)).not.toContain('PRIVATE_GUARDED_BYTES')
  expect(serializations).toBe(0)
}

test('ordinary asynchronous response guard is followed by fresh WorkspaceActor admission before serialization', async () => {
  const f = await ordinaryGuardFixture()
  const pending = f.request()
  await f.entered.promise
  expect(f.revalidations()).toBe(3)
  expect(f.serializations()).toBe(0)
  f.release.resolve()
  const response = await pending
  expect(response.error).toBeUndefined()
  expect(response.result).toEqual({ content: 'PRIVATE_GUARDED_BYTES' })
  expect(f.revalidations()).toBe(4)
  expect(f.guardCalls()).toBe(1)
  expect(f.serializations()).toBe(1)
})

test('session revoke during ordinary response guard denies the pending request with zero serialization', async () => {
  const f = await ordinaryGuardFixture()
  const pending = f.request()
  await f.entered.promise
  f.revoke()
  f.release.resolve()
  expectDenied(await pending, f.serializations())
  expect(f.revalidations()).toBe(4)
  expect(f.guardCalls()).toBe(1)
})

test('session expiry during ordinary response guard denies the pending request with zero serialization', async () => {
  const f = await ordinaryGuardFixture(Date.now() + 2000)
  const pending = f.request()
  await f.entered.promise
  await new Promise(resolve => setTimeout(resolve, Math.max(0, f.expiresAt - Date.now() + 20)))
  f.release.resolve()
  expectDenied(await pending, f.serializations())
  expect(f.guardCalls()).toBe(1)
}, 10_000)

test('revoked pending request cannot inherit a replacement session, while a fresh connection uses the new grant', async () => {
  const f = await ordinaryGuardFixture()
  const pending = f.request()
  await f.entered.promise
  f.revoke()
  f.regrantWithReplacementSession()
  f.release.resolve()
  expectDenied(await pending, f.serializations())
  expect(f.guardCalls()).toBe(1)
  const replacementRequest = await f.connectReplacement()
  const response = await replacementRequest()
  expect(response.error).toBeUndefined()
  expect(response.result).toEqual({ content: 'PRIVATE_GUARDED_BYTES' })
  expect(f.guardCalls()).toBe(2)
  expect(f.serializations()).toBe(1)
})

test('final joint workspace guard cannot be installed on a standalone or nonshared channel', () => {
  const standalone = new WsRpcServer({ host: '127.0.0.1', port: 0 })
  cleanups.push(() => standalone.close())
  expect(() => standalone.handle('test:invalid-joint', () => 'must not run', {
    access: 'authenticatedWorkspace', beforeWorkspaceResponse: async () => {},
  })).toThrow('Joint workspace response guard requires authenticatedWorkspace access and shared authority')
  // A rejected registration must not reserve a handler or change its ownership.
  expect(() => standalone.handle('test:invalid-joint', () => 'valid standalone handler')).not.toThrow()

  const shared = new WsRpcServer({ host: '127.0.0.1', port: 0,
    workspaceAuthority: { authenticate: async () => { throw new Error('Unused') },
      revalidate: async () => { throw new Error('Unused') } } })
  cleanups.push(() => shared.close())
  expect(() => shared.handle('test:invalid-access', () => 'must not run', {
    beforeWorkspaceResponse: async () => {},
  })).toThrow('Joint workspace response guard requires authenticatedWorkspace access and shared authority')
  expect(() => shared.handle('test:invalid-access', () => 'valid shared handler', {
    access: 'authenticatedWorkspace',
  })).not.toThrow()
})
