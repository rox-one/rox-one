import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
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

const sendGrant: MeetingGrant = {
  id: 'g',
  actorId: 'user',
  workspaceId: 'ws',
  deviceId: 'dev',
  capabilities: ['send'],
}

const micGrant: MeetingGrant = {
  ...sendGrant,
  capabilities: ['send', 'mic'],
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

describe('meetings capture intent RPC', () => {
  const previousRox = process.env.ROX_CONFIG_DIR
  const previousCraft = process.env.CRAFT_CONFIG_DIR
  let configDir = ''

  beforeEach(() => {
    resetMeetingHandlerStateForTests()
    configDir = mkdtempSync(join(tmpdir(), 'meetings-capture-rpc-'))
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

  it('startCapture then GET has native-journal binding, not a live room', async () => {
    const handlers = createHarness()
    const created = await handlers.get(RPC_CHANNELS.meetings.CREATE)!({}, 'ws', 'локальная', 'user', sendGrant) as {
      meeting: Meeting | null
    }
    const started = await handlers.get(RPC_CHANNELS.meetings.START_CAPTURE)!(
      {},
      'ws',
      created.meeting!.meetingId,
      'user',
      micGrant,
    ) as { meeting: Meeting | null; error?: { code: string } }
    expect(started.error).toBeUndefined()
    expect(started.meeting?.status).toBe('capturing')
    expect(started.meeting?.sourceBinding?.provider).toBe('native-journal')
    expect(started.meeting?.sourceBinding?.remoteType).toBe('capture-intent')

    resetMeetingHandlerStateForTests()
    const restarted = createHarness()
    const got = await restarted.get(RPC_CHANNELS.meetings.GET)!({}, 'ws', created.meeting!.meetingId) as Meeting | null
    expect(got?.status).toBe('capturing')
    expect(got?.sourceBinding?.provider).toBe('native-journal')
  })

  it('startCapture fail-closes without grant, CONFIG_DIR, or mic', async () => {
    const handlers = createHarness()
    const created = await handlers.get(RPC_CHANNELS.meetings.CREATE)!({}, 'ws', 'локальная', 'user', sendGrant) as {
      meeting: Meeting | null
    }
    const noGrant = await handlers.get(RPC_CHANNELS.meetings.START_CAPTURE)!(
      {},
      'ws',
      created.meeting!.meetingId,
      'user',
      null,
    ) as { meeting: Meeting | null; error?: { code: string } }
    expect(noGrant.meeting).toBeNull()
    expect(noGrant.error?.code).toBe('grant-required')

    const noMic = await handlers.get(RPC_CHANNELS.meetings.START_CAPTURE)!(
      {},
      'ws',
      created.meeting!.meetingId,
      'user',
      sendGrant,
    ) as { meeting: Meeting | null; error?: { code: string } }
    expect(noMic.error?.code).toBe('capability-denied')

    delete process.env.ROX_CONFIG_DIR
    delete process.env.CRAFT_CONFIG_DIR
    const noDir = await handlers.get(RPC_CHANNELS.meetings.START_CAPTURE)!(
      {},
      'ws',
      created.meeting!.meetingId,
      'user',
      micGrant,
    ) as { meeting: Meeting | null; error?: { code: string } }
    expect(noDir.meeting).toBeNull()
    expect(noDir.error?.code).toBe('config-dir-required')
  })
})
