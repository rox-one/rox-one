import { afterEach, describe, expect, test } from 'bun:test'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { RpcServer } from '@craft-agent/server-core/transport'
import { registerMeetingHandlers, resetMeetingHandlerStateForTests } from '../meetings.ts'

type Handler = (ctx: unknown, ...args: unknown[]) => unknown | Promise<unknown>

const occurrence = {
  accountId: 'acct-1',
  calendarId: 'cal-1',
  eventId: 'event-1',
  occurrenceId: 'occ-1',
  timeZone: 'UTC',
}

function calendarBindHandler(): Handler {
  const handlers = new Map<string, Handler>()
  const server = {
    handle: (channel: string, handler: Handler) => handlers.set(channel, handler),
    push: () => {},
    invokeClient: async () => undefined,
    hasClientCapability: () => false,
    findClientsWithCapability: () => [],
  }
  registerMeetingHandlers(server as unknown as RpcServer, { platform: { logger: console } } as never)
  const handler = handlers.get(RPC_CHANNELS.meetings.CALENDAR_BIND)
  if (!handler) throw new Error('Calendar bind handler was not registered')
  return handler
}

describe('calendar binding RPC authorization', () => {
  afterEach(() => resetMeetingHandlerStateForTests())


  test('rejects a workspace different from the authenticated RPC context', async () => {
    const result = await calendarBindHandler()(
      { clientId: 'client-1', workspaceId: 'ws-1', webContentsId: 1 },
      'ws-2',
      occurrence,
      true,
    ) as { status: string; reason: string; live: boolean }

    expect(result.status).toBe('denied')
    expect(result.reason).toBe('workspace-mismatch')
    expect(result.live).toBe(false)
  })

  test('does not claim a calendar binding from client-supplied occurrence credentials', async () => {
    const result = await calendarBindHandler()(
      { clientId: 'client-1', workspaceId: 'ws-1', webContentsId: 1 },
      'ws-1',
      occurrence,
      true,
    ) as { status: string; reason: string; live: boolean }

    expect(result.status).toBe('blocked')
    expect(result.reason).toBe('calendar-conation-unconfirmed')
    expect(result.live).toBe(false)
  })
})
