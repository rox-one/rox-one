import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { MeetingGrant } from '@craft-agent/shared/meeting-agents'
import type { Meeting } from '@craft-agent/core/meetings'
import {
  registerMeetingHandlers,
  resetMeetingHandlerStateForTests,
} from '../meetings.ts'

type Handler = (ctx: unknown, ...args: unknown[]) => unknown | Promise<unknown>

const grant: MeetingGrant = {
  id: 'g',
  actorId: 'user',
  workspaceId: 'ws',
  deviceId: 'dev',
  capabilities: ['send'],
}

function createHarness() {
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
  return handlers
}

describe('meetings:create native catalog RPC', () => {
  const previousRox = process.env.ROX_CONFIG_DIR
  const previousCraft = process.env.CRAFT_CONFIG_DIR
  let configDir = ''

  beforeEach(() => {
    resetMeetingHandlerStateForTests()
    configDir = mkdtempSync(join(tmpdir(), 'meetings-create-'))
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

  it('create then list/get from journal; not a live room', async () => {
    const handlers = createHarness()
    const created = await handlers.get(RPC_CHANNELS.meetings.CREATE)!(
      {},
      'ws',
      'локальная',
      'user',
      grant,
    ) as { meeting: Meeting | null; error?: { code: string } }
    expect(created.error).toBeUndefined()
    expect(created.meeting?.status).toBe('planned')
    expect(created.meeting?.sourceBinding).toBeUndefined()
    expect(existsSync(join(configDir, 'meetings', 'ws', 'meetings', created.meeting!.meetingId, 'snapshot.json'))).toBe(true)

    resetMeetingHandlerStateForTests()
    const restarted = createHarness()
    const listed = await restarted.get(RPC_CHANNELS.meetings.LIST)!({}, 'ws') as { page: Meeting[] }
    expect(listed.page).toHaveLength(1)
    expect(listed.page[0]?.meetingId).toBe(created.meeting!.meetingId)
    const got = await restarted.get(RPC_CHANNELS.meetings.GET)!({}, 'ws', created.meeting!.meetingId) as Meeting | null
    expect(got?.title).toBe('локальная')
  })

  it('create fail-closes without grant or CONFIG_DIR', async () => {
    const handlers = createHarness()
    const noGrant = await handlers.get(RPC_CHANNELS.meetings.CREATE)!(
      {},
      'ws',
      'локальная',
      'user',
      null,
    ) as { meeting: Meeting | null; error?: { code: string } }
    expect(noGrant.meeting).toBeNull()
    expect(noGrant.error?.code).toBe('grant-required')

    delete process.env.ROX_CONFIG_DIR
    delete process.env.CRAFT_CONFIG_DIR
    const noDir = await handlers.get(RPC_CHANNELS.meetings.CREATE)!(
      {},
      'ws',
      'локальная',
      'user',
      grant,
    ) as { meeting: Meeting | null; error?: { code: string } }
    expect(noDir.meeting).toBeNull()
    expect(noDir.error?.code).toBe('config-dir-required')
  })
})
