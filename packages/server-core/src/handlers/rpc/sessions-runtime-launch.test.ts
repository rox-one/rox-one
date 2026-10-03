import { expect, test } from 'bun:test'
import { RPC_CHANNELS, type SendMessageOptions } from '@rox/shared/protocol'
import { known, unknown, isRuntimeLaunch } from '@rox/core/runtime-trace'
import type { HandlerDeps } from '../handler-deps'
import type { HandlerFn, RequestContext, RpcServer } from '../../transport'
import { registerSessionsHandlers } from './sessions'

test('existing send RPC preserves observed producer metadata; malformed metadata fails closed', async () => {
  const handlers = new Map<string, HandlerFn>()
  const calls: unknown[][] = []
  const server = {
    handle(channel: string, handler: HandlerFn) { handlers.set(channel, handler) },
    push() {}, async invokeClient() {}, hasClientCapability() { return false },
    findClientsWithCapability() { return [] },
  } as RpcServer
  registerSessionsHandlers(server, {
    sessionManager: { async sendMessage(...args: unknown[]) {
      calls.push(args)
      ;(args[7] as (id: string) => void)('persisted-message')
    } },
    platform: { logger: { error() {}, warn() {}, info() {}, debug() {} } },
  } as unknown as HandlerDeps)
  const send = handlers.get(RPC_CHANNELS.sessions.SEND_MESSAGE)!
  const context = { workspaceId: 'workspace', clientId: 'client' } as RequestContext
  const launch = { kind: 'scheduled' as const, scheduleId: 'daily-policy', occurrenceId: 'actual-claim',
    timezone: 'Europe/Berlin', scheduledAt: unknown('not-recorded'), dispatchedAt: known(1_790_000_000_000, 'actual-dispatch') }
  expect(isRuntimeLaunch(launch)).toBe(true)
  expect(await send(context, 'session', 'producer input', undefined, undefined, { runtimeLaunch: launch } satisfies SendMessageOptions))
    .toEqual({ accepted: true, messageId: 'persisted-message' })
  expect(calls[0]![8]).toMatchObject({ callerClientId: 'client', runtimeLaunch: launch })
  expect(await send(context, 'session', 'manual input')).toEqual({ accepted: true, messageId: 'persisted-message' })
  expect((calls[1]![8] as Record<string, unknown>).runtimeLaunch).toBeUndefined()
  for (const malformed of [{ ...launch, kind: 'fabricated' }, { ...launch, dispatchedAt: known(-1, 'clock') },
    { ...launch, scheduledAt: known(Infinity, 'clock') }, { ...launch, timezone: 42 }]) {
    expect(isRuntimeLaunch(malformed)).toBe(false)
    await send(context, 'session', 'producer input', undefined, undefined, { runtimeLaunch: malformed })
    expect((calls.at(-1)![8] as Record<string, unknown>).runtimeLaunch).toEqual({ kind: 'unknown' })
  }
})
