import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { RpcServer } from '@craft-agent/server-core/transport'
import {
  registerMeetingHandlers,
  resetMeetingHandlerStateForTests,
} from '@craft-agent/server-core/handlers/rpc/meetings'
import type { Meeting } from '@craft-agent/core/meetings'
import type { MeetingGrant } from '@craft-agent/shared/meeting-agents'
import {
  searchNativeMeetingsViaRpc,
  startNativeMeetingViaRpc,
  type MeetingCatalogApi,
  type MeetingSearchApi,
} from '../start-rpc'

type Handler = (ctx: unknown, ...args: unknown[]) => unknown | Promise<unknown>

const grant: MeetingGrant = {
  id: 'g',
  actorId: 'user',
  workspaceId: 'ws',
  deviceId: 'desktop',
  capabilities: ['send'],
}

function apisFromHandlers(): MeetingCatalogApi & MeetingSearchApi {
  const handlers = new Map<string, Handler>()
  const server = {
    handle(channel: string, handler: Handler) {
      handlers.set(channel, handler)
    },
    push() {},
    async invokeClient() {},
    hasClientCapability() { return false },
    findClientsWithCapability() { return [] },
  }
  registerMeetingHandlers(server as unknown as RpcServer, {
    platform: { logger: console },
  } as never)
  return {
    createMeeting: async (...args) => handlers.get(RPC_CHANNELS.meetings.CREATE)!(
      {},
      ...args,
    ) as Promise<{ meeting: Meeting | null; error?: { code: string } }>,
    listMeetings: async (...args) => handlers.get(RPC_CHANNELS.meetings.LIST)!(
      {},
      ...args,
    ) as Promise<{ page: Meeting[]; continueCursor: string | null }>,
    searchMeetings: async (...args) => handlers.get(RPC_CHANNELS.meetings.SEARCH)!(
      {},
      ...args,
    ) as Promise<{
      page: Meeting[]
      continueCursor: string | null
      denied?: boolean
      error?: { code: string }
    }>,
  }
}

describe('meetings UI client against SEARCH journal snapshots', () => {
  const previousRox = process.env.ROX_CONFIG_DIR
  const previousCraft = process.env.CRAFT_CONFIG_DIR
  let configDir = ''

  beforeEach(() => {
    resetMeetingHandlerStateForTests()
    configDir = mkdtempSync(join(tmpdir(), 'meetings-search-rpc-'))
    process.env.ROX_CONFIG_DIR = configDir
    delete process.env.CRAFT_CONFIG_DIR
  })

  afterEach(() => {
    resetMeetingHandlerStateForTests()
    if (previousRox === undefined) delete process.env.ROX_CONFIG_DIR
    else process.env.ROX_CONFIG_DIR = previousRox
    if (previousCraft === undefined) delete process.env.CRAFT_CONFIG_DIR
    else process.env.CRAFT_CONFIG_DIR = previousCraft
    rmSync(configDir, { recursive: true, force: true })
  })

  it('search matches journal snapshots and fail-closes without CONFIG_DIR', async () => {
    const api = apisFromHandlers()
    const first = await startNativeMeetingViaRpc({
      api,
      workspaceId: 'ws',
      actorId: 'user',
      grant,
      title: 'локальная',
    })
    expect(first.ok).toBe(true)
    const second = await startNativeMeetingViaRpc({
      api,
      workspaceId: 'ws',
      actorId: 'user',
      grant,
      title: 'другая',
    })
    expect(second.ok).toBe(true)
    const matched = await searchNativeMeetingsViaRpc({
      api,
      workspaceId: 'ws',
      query: 'локал',
    })
    expect(matched.ok).toBe(true)
    if (!matched.ok) throw new Error('expected search')
    expect(matched.meetings).toHaveLength(1)
    expect(matched.meetings[0]?.title).toBe('локальная')
    expect(matched.meetings[0]?.status).toBe('planned')
    delete process.env.ROX_CONFIG_DIR
    delete process.env.CRAFT_CONFIG_DIR
    const noDir = await searchNativeMeetingsViaRpc({
      api,
      workspaceId: 'ws',
      query: 'локал',
    })
    expect(noDir).toEqual({ ok: false, code: 'config-dir-required' })
  })
})
