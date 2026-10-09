import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RPC_CHANNELS } from '@rox/shared/protocol'
import type { RpcServer } from '@rox/server-core/transport'
import type { MeetingGrant } from '@rox/shared/meeting-agents'
import type { Meeting } from '@rox/core/meetings'
import {
  MEETING_HANDLED_CHANNELS,
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
  registerMeetingHandlers(server as unknown as RpcServer, { platform: { logger: console } } as never)
  return handlers
}

describe('meetings observe RPC', () => {
  const previousRox = process.env.ROX_CONFIG_DIR
  const previousCraft = process.env.CRAFT_CONFIG_DIR
  let configDir = ''

  beforeEach(() => {
    resetMeetingHandlerStateForTests()
    configDir = mkdtempSync(join(tmpdir(), 'meetings-observe-rpc-'))
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

  it('registers all five frozen observe channels', () => {
    expect(MEETING_HANDLED_CHANNELS).toContain(RPC_CHANNELS.meetings.OBSERVE_START)
    expect(MEETING_HANDLED_CHANNELS).toContain(RPC_CHANNELS.meetings.OBSERVE_STOP)
    expect(MEETING_HANDLED_CHANNELS).toContain(RPC_CHANNELS.meetings.OBSERVE_STATE)
    expect(MEETING_HANDLED_CHANNELS).toContain(RPC_CHANNELS.meetings.SESSION_SUMMARY)
    expect(MEETING_HANDLED_CHANNELS).toContain(RPC_CHANNELS.meetings.TRANSCRIPT_LINES)
    const handlers = createHarness()
    for (const channel of [
      RPC_CHANNELS.meetings.OBSERVE_START,
      RPC_CHANNELS.meetings.OBSERVE_STOP,
      RPC_CHANNELS.meetings.OBSERVE_STATE,
      RPC_CHANNELS.meetings.SESSION_SUMMARY,
      RPC_CHANNELS.meetings.TRANSCRIPT_LINES,
    ]) {
      expect(handlers.has(channel)).toBe(true)
    }
  })

  it('start/state/stop returns honest observing flags and fail-closes without a config dir', async () => {
    const handlers = createHarness()
    const created = await handlers.get(RPC_CHANNELS.meetings.CREATE)!({}, 'ws', 'локальная', 'user', grant) as {
      meeting: Meeting | null
    }
    const meetingId = created.meeting!.meetingId

    const started = await handlers.get(RPC_CHANNELS.meetings.OBSERVE_START)!({}, { workspaceId: 'ws', meetingId })
    expect(started).toEqual({ observing: true })
    const state = await handlers.get(RPC_CHANNELS.meetings.OBSERVE_STATE)!({}, { workspaceId: 'ws', meetingId })
    expect(state).toEqual({ observing: true })
    expect(await handlers.get(RPC_CHANNELS.meetings.SESSION_SUMMARY)!({}, { workspaceId: 'ws', meetingId })).toBeNull()
    expect(await handlers.get(RPC_CHANNELS.meetings.TRANSCRIPT_LINES)!({}, { workspaceId: 'ws', meetingId })).toEqual([])

    const stopped = await handlers.get(RPC_CHANNELS.meetings.OBSERVE_STOP)!({}, { workspaceId: 'ws', meetingId })
    expect(stopped).toEqual({ observing: false })

    // Malformed args are rejected, never guessed.
    expect(await handlers.get(RPC_CHANNELS.meetings.OBSERVE_START)!({}, { workspaceId: 'ws' })).toEqual({ observing: false })

    delete process.env.ROX_CONFIG_DIR
    delete process.env.CRAFT_CONFIG_DIR
    expect(await handlers.get(RPC_CHANNELS.meetings.OBSERVE_START)!({}, { workspaceId: 'ws', meetingId })).toEqual({ observing: false })
  })
})