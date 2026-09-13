import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createHash } from 'crypto'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { MeetingGrant } from '@craft-agent/shared/meeting-agents'
import type { Meeting } from '@craft-agent/core/meetings'
import {
  registerMeetingHandlers,
  resetMeetingHandlerStateForTests,
} from '../meetings.ts'
import { MeetingJournal } from '../../../meetings/journal.ts'

type Handler = (ctx: unknown, ...args: unknown[]) => unknown | Promise<unknown>

const sendGrant: MeetingGrant = {
  id: 'g',
  actorId: 'user',
  workspaceId: 'ws',
  deviceId: 'dev',
  capabilities: ['send'],
}

const archiveGrant: MeetingGrant = {
  ...sendGrant,
  capabilities: ['send', 'archive'],
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

describe('meetings:addManualNote / meetings:correctSegment RPC', () => {
  const previousRox = process.env.ROX_CONFIG_DIR
  const previousCraft = process.env.CRAFT_CONFIG_DIR
  let configDir = ''

  beforeEach(() => {
    resetMeetingHandlerStateForTests()
    configDir = mkdtempSync(join(tmpdir(), 'meetings-manual-rpc-'))
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

  it('CREATE + IMPORT_MEDIA then notes survive restart without ASR upsert', async () => {
    const handlers = createHarness()
    const created = await handlers.get(RPC_CHANNELS.meetings.CREATE)!({}, 'ws', 'локальная', 'user', sendGrant) as {
      meeting: Meeting | null
    }
    const spec = {
      contentHash: createHash('sha256').update(new Uint8Array([9, 8, 7, 6])).digest('hex'),
      byteLength: 4,
      mimeType: 'audio/wav',
    }
    await handlers.get(RPC_CHANNELS.meetings.IMPORT_MEDIA)!(
      {},
      'ws',
      created.meeting!.meetingId,
      'user',
      archiveGrant,
      spec,
    )
    const noted = await handlers.get(RPC_CHANNELS.meetings.ADD_MANUAL_NOTE)!(
      {},
      'ws',
      created.meeting!.meetingId,
      'user',
      archiveGrant,
      { noteId: 'n1', text: 'правка' },
    ) as { meeting: Meeting | null; error?: { code: string } }
    expect(noted.error).toBeUndefined()
    expect(noted.meeting?.sourceBinding?.provider).toBe('native-journal')

    const corrected = await handlers.get(RPC_CHANNELS.meetings.CORRECT_SEGMENT)!(
      {},
      'ws',
      created.meeting!.meetingId,
      'user',
      archiveGrant,
      { segmentId: 's1', replacement: 'исправление' },
    ) as { meeting: Meeting | null; error?: { code: string } }
    expect(corrected.error).toBeUndefined()

    resetMeetingHandlerStateForTests()
    const restarted = createHarness()
    const got = await restarted.get(RPC_CHANNELS.meetings.GET)!({}, 'ws', created.meeting!.meetingId) as Meeting | null
    expect(got?.sourceBinding?.remoteId).toBe(spec.contentHash)
    const persistRoot = join(configDir, 'meetings', 'ws')
    const snapshot = new MeetingJournal(persistRoot).read(created.meeting!.meetingId)
    expect(snapshot.events.some((event) => event.type === 'manual.note' && event.text === 'правка')).toBe(true)
    expect(snapshot.events.some((event) => event.type === 'segment.correct' && event.replacement === 'исправление')).toBe(true)
    expect(snapshot.events.some((event) => event.type === 'segment.upsert')).toBe(false)
  })

  it('manual RPCs fail-close without grant, CONFIG_DIR, or archive', async () => {
    const handlers = createHarness()
    const created = await handlers.get(RPC_CHANNELS.meetings.CREATE)!({}, 'ws', 'локальная', 'user', sendGrant) as {
      meeting: Meeting | null
    }
    const spec = {
      contentHash: createHash('sha256').update(new Uint8Array([1])).digest('hex'),
      byteLength: 1,
      mimeType: 'audio/wav',
    }
    await handlers.get(RPC_CHANNELS.meetings.IMPORT_MEDIA)!(
      {},
      'ws',
      created.meeting!.meetingId,
      'user',
      archiveGrant,
      spec,
    )
    const noteSpec = { noteId: 'n1', text: 'правка' }
    const noGrant = await handlers.get(RPC_CHANNELS.meetings.ADD_MANUAL_NOTE)!(
      {},
      'ws',
      created.meeting!.meetingId,
      'user',
      null,
      noteSpec,
    ) as { meeting: Meeting | null; error?: { code: string } }
    expect(noGrant.meeting).toBeNull()
    expect(noGrant.error?.code).toBe('grant-required')

    const noArchive = await handlers.get(RPC_CHANNELS.meetings.CORRECT_SEGMENT)!(
      {},
      'ws',
      created.meeting!.meetingId,
      'user',
      sendGrant,
      { segmentId: 's1', replacement: 'правка' },
    ) as { meeting: Meeting | null; error?: { code: string } }
    expect(noArchive.error?.code).toBe('archive-denied')

    delete process.env.ROX_CONFIG_DIR
    delete process.env.CRAFT_CONFIG_DIR
    const noDir = await handlers.get(RPC_CHANNELS.meetings.ADD_MANUAL_NOTE)!(
      {},
      'ws',
      created.meeting!.meetingId,
      'user',
      archiveGrant,
      noteSpec,
    ) as { meeting: Meeting | null; error?: { code: string } }
    expect(noDir.meeting).toBeNull()
    expect(noDir.error?.code).toBe('config-dir-required')
  })
})
