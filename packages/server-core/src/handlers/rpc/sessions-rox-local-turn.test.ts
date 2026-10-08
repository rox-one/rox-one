import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { RPC_CHANNELS } from '@rox/shared/protocol'
import { resolveConfigDir } from '@rox/shared/config/paths'
import { LOCAL_ROX_CALLER, peekRoxAccountAuthority, setRoxAccountAuthority, type RoxAccountAuthority, type RoxExecutionContext } from '@rox/shared/auth'
import { createPocketFixture } from '../../../../shared/src/auth/__tests__/pocket-test-fixture.ts'
import type { HandlerDeps } from '../handler-deps'
import type { HandlerFn, RequestContext, RpcServer } from '../../transport'
import { registerSessionsHandlers } from './sessions'

/**
 * A local (non-cloud) turn must reach the model with the local key: the Rox
 * cloud account gate is a proxy authorization, so it may not fail the send
 * before any model call. A genuine cloud caller keeps the strict account gate.
 */

let restoreAuthority: RoxAccountAuthority | undefined

beforeEach(() => {
  restoreAuthority = peekRoxAccountAuthority()
})

afterEach(() => {
  if (restoreAuthority) setRoxAccountAuthority(restoreAuthority)
})

function harness() {
  const handlers = new Map<string, HandlerFn>()
  const sends: unknown[][] = []
  const refreshed: unknown[][] = []
  const server = {
    handle(channel: string, handler: HandlerFn) { handlers.set(channel, handler) },
    push() {}, async invokeClient() {}, hasClientCapability() { return false },
    findClientsWithCapability() { return [] }, isRequestContextCurrent() { return true },
  } as unknown as RpcServer
  registerSessionsHandlers(server, {
    sessionManager: {
      async sendMessage(...args: unknown[]) {
        sends.push(args)
        const ack = args[7]
        if (typeof ack === 'function') ack('persisted-message')
      },
      async refreshTitle(...args: unknown[]) { refreshed.push(args); return { title: 'fixture' } },
      getSessionWorkingDirectory() { return undefined },
      getSessions() { return [{ id: 'session', workspaceId: 'workspace' }] },
    },
    nativeData: { authority: { authorize: () => true } },
    platform: { logger: { error() {}, warn() {}, info() {}, debug() {} } },
  } as unknown as HandlerDeps)
  return { handlers, sends, refreshed }
}

/** The RPC handler's transport context argument (position 8 of sessionManager.sendMessage). */
function sendRpcContext(call: unknown[]): Record<string, unknown> {
  const value = call[8]
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {}
}

const localContext = (): RequestContext => ({ clientId: 'client', workspaceId: 'workspace', webContentsId: null })
const cloudContext = (): RequestContext => ({
  clientId: 'client', workspaceId: 'workspace', webContentsId: null,
  principal: { issuer: 'rox:cloud', subject: 'user-1', credentialId: 'cred-1', credentialVersion: 1 },
})

/** The native workspace gate reads the host registry before the cloud gate. */
function seedNativeWorkspace(workspaceId = 'workspace'): void {
  const dir = resolveConfigDir()
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'config.json'), JSON.stringify({
    workspaces: [{ id: workspaceId, rootPath: process.cwd(), name: 'fixture', kind: 'personal' }],
  }))
}

test('a local turn is not blocked by an unconnected Rox account', async () => {
  const pocket = createPocketFixture()
  setRoxAccountAuthority(pocket.authority)
  // Ground truth for the reported failure: capture itself still refuses.
  await expect(pocket.authority.capture(LOCAL_ROX_CALLER)).rejects.toThrow('ROX_ACCOUNT_NOT_READY')

  const { handlers, sends } = harness()
  const send = handlers.get(RPC_CHANNELS.sessions.SEND_MESSAGE)!
  expect(await send(localContext(), 'session', 'local turn')).toEqual({ accepted: true, messageId: 'persisted-message' })
  expect(sends).toHaveLength(1)
  expect(sendRpcContext(sends[0]!).roxExecutionContext).toBeUndefined()
})

test('a cloud caller with no account still fails with ROX_ACCOUNT_NOT_READY', async () => {
  seedNativeWorkspace()
  const pocket = createPocketFixture()
  setRoxAccountAuthority(pocket.authority)

  const { handlers, sends } = harness()
  const send = handlers.get(RPC_CHANNELS.sessions.SEND_MESSAGE)!
  await expect(send(cloudContext(), 'session', 'cloud turn')).rejects.toThrow('ROX_ACCOUNT_NOT_READY')
  expect(sends).toHaveLength(0)
})

test('a connected account still supplies the execution context for a local turn', async () => {
  const pocket = createPocketFixture()
  setRoxAccountAuthority(pocket.authority)
  await pocket.authority.start(LOCAL_ROX_CALLER)
  await pocket.authority.state(LOCAL_ROX_CALLER)

  const { handlers, sends } = harness()
  const send = handlers.get(RPC_CHANNELS.sessions.SEND_MESSAGE)!
  expect(await send(localContext(), 'session', 'connected local turn')).toEqual({ accepted: true, messageId: 'persisted-message' })
  expect(sendRpcContext(sends[0]!).roxExecutionContext)
    .toMatchObject({ cloudAccountId: 'account-a', caller: { issuer: LOCAL_ROX_CALLER.issuer, subject: LOCAL_ROX_CALLER.subject } })
})

test('local title refresh is not blocked by an unconnected Rox account', async () => {
  const pocket = createPocketFixture()
  setRoxAccountAuthority(pocket.authority)

  const { handlers, refreshed } = harness()
  const command = handlers.get(RPC_CHANNELS.sessions.COMMAND)!
  expect(await command(localContext(), 'session', { type: 'refreshTitle' })).toEqual({ title: 'fixture' })
  expect(refreshed[0]![1]).toBeUndefined()
})