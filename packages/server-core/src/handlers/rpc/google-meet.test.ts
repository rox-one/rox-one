import { describe, expect, it, spyOn } from 'bun:test'
import { RPC_CHANNELS } from '@rox/shared/protocol'
import type { HandlerDeps } from '../handler-deps'
import type { HandlerFn, RequestContext, RpcServer } from '../../transport'
import { registerGoogleMeetHandlers, type GoogleMeetConfig } from './google-meet'

const logger = { info() {}, warn() {}, error() {}, debug() {} }

function harness(config?: GoogleMeetConfig) {
  const handlers = new Map<string, HandlerFn>()
  const server = {
    handle(channel: string, handler: HandlerFn) { handlers.set(channel, handler) },
  } as unknown as RpcServer
  const deps = (config === undefined
    ? { platform: { logger } }
    : { platform: { logger }, meet: { getConfig: () => config } }) as unknown as HandlerDeps
  registerGoogleMeetHandlers(server, deps)
  const context: RequestContext = { clientId: 'client', workspaceId: 'ws-1', webContentsId: null }
  return {
    invoke: (channel: string, args?: unknown) => {
      const handler = handlers.get(channel)
      if (!handler) throw new Error(`channel not registered: ${channel}`)
      return handler(context, args)
    },
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('meet:* handlers — Developer-Preview gate', () => {
  it('refuses with PREVIEW_NOT_ACKNOWLEDGED before any fetch and never calls fetch', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch')
    try {
      const { invoke } = harness({ enrollmentAcknowledged: false, accessToken: 'access-1' })
      for (const [channel, args] of [
        [RPC_CHANNELS.meet.SPACE, { workspaceId: 'ws-1', space: 'spaces/abc' }],
        [RPC_CHANNELS.meet.CONFERENCE_RECORDS, { workspaceId: 'ws-1', space: 'spaces/abc' }],
        [RPC_CHANNELS.meet.PARTICIPANTS, { workspaceId: 'ws-1', conferenceRecord: 'conferenceRecords/rec-1' }],
        [RPC_CHANNELS.meet.RECORDINGS, { workspaceId: 'ws-1', conferenceRecord: 'conferenceRecords/rec-1' }],
        [RPC_CHANNELS.meet.TRANSCRIPTS, { workspaceId: 'ws-1', conferenceRecord: 'conferenceRecords/rec-1' }],
        [RPC_CHANNELS.meet.SMART_NOTES, { workspaceId: 'ws-1', conferenceRecord: 'conferenceRecords/rec-1' }],
      ] as const) {
        const result = await invoke(channel, args) as { ok: boolean; code?: string }
        expect(result.ok).toBe(false)
        expect(result.code).toBe('PREVIEW_NOT_ACKNOWLEDGED')
      }
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it('refuses with MEET_NOT_CONNECTED when no credential is stored, before any fetch', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch')
    try {
      const { invoke } = harness({ enrollmentAcknowledged: true, accessToken: null })
      const result = await invoke(RPC_CHANNELS.meet.PARTICIPANTS, {
        workspaceId: 'ws-1',
        conferenceRecord: 'conferenceRecords/rec-1',
      }) as { ok: boolean; code?: string }
      expect(result).toMatchObject({ ok: false, code: 'MEET_NOT_CONNECTED' })
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it('refuses with MEET_NOT_CONFIGURED when the host composed no connector', async () => {
    const { invoke } = harness()
    const result = await invoke(RPC_CHANNELS.meet.SPACE, { workspaceId: 'ws-1', space: 'spaces/abc' }) as {
      ok: boolean
      code?: string
    }
    expect(result).toMatchObject({ ok: false, code: 'MEET_NOT_CONFIGURED' })
  })
})

describe('meet:* handlers — artifact parsing', () => {
  const seen: Array<{ url: string; auth: string | null }> = []

  // Parameters come from `typeof fetch` so the fixture cannot drift from the
  // production seam (`GoogleMeetConfig.fetchImpl`); the cast is only for bun's
  // extra `preconnect` member, which a plain function cannot declare.
  const fixtureFetch = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = String(input)
    seen.push({ url, auth: new Headers(init?.headers).get('Authorization') })
    if (url.includes('/v2/spaces/abc')) {
      return Promise.resolve(jsonResponse({
        name: 'spaces/abc',
        meetingUri: 'https://meet.google.com/abc-defg-hij',
        meetingCode: 'abc-defg-hij',
        config: { accessType: 'OPEN', entryPointAccess: 'ALL' },
        activeConference: { conferenceRecord: 'conferenceRecords/rec-1' },
      }))
    }
    if (url.includes('/conferenceRecords?filter=')) {
      return Promise.resolve(jsonResponse({
        conferenceRecords: [
          { name: 'conferenceRecords/rec-1', startTime: '2026-10-01T09:00:00Z', space: 'spaces/abc' },
        ],
      }))
    }
    if (url.includes('/participants')) {
      return Promise.resolve(jsonResponse({
        participants: [
          {
            name: 'conferenceRecords/rec-1/participants/p1',
            earliestStartTime: '2026-10-01T09:00:00Z',
            signedinUser: { user: 'users/1', displayName: 'Ada' },
          },
          { name: 'conferenceRecords/rec-1/participants/p2', phoneUser: { displayName: '+15550100' } },
        ],
      }))
    }
    if (url.includes('/recordings')) {
      return Promise.resolve(jsonResponse({
        recordings: [
          {
            name: 'conferenceRecords/rec-1/recordings/r1',
            state: 'FILE_GENERATED',
            driveDestination: { file: 'drive/file-1', exportUri: 'https://drive.google.com/file/d/file-1' },
          },
        ],
      }))
    }
    if (url.includes('/transcripts')) {
      return Promise.resolve(jsonResponse({
        transcripts: [
          {
            name: 'conferenceRecords/rec-1/transcripts/t1',
            state: 'FILE_GENERATED',
            docsDestination: { document: 'documents/doc-1', exportUri: 'https://docs.google.com/document/d/doc-1' },
          },
        ],
      }))
    }
    if (url.includes('/smartNotes')) {
      return Promise.resolve(jsonResponse({
        smartNotes: [
          {
            name: 'conferenceRecords/rec-1/smartNotes/s1',
            state: 'FILE_GENERATED',
            docsDestination: { document: 'documents/note-1' },
          },
        ],
      }))
    }
    return Promise.resolve(jsonResponse({}, 404))
  }) as typeof fetch

  const config: GoogleMeetConfig = {
    enrollmentAcknowledged: true,
    accessToken: 'access-1',
    apiBase: 'https://meet.googleapis.com/v2',
    fetchImpl: fixtureFetch as unknown as typeof fetch,
  }

  it('parses a space with its Meet URI', async () => {
    seen.length = 0
    const { invoke } = harness(config)
    const result = await invoke(RPC_CHANNELS.meet.SPACE, { workspaceId: 'ws-1', space: 'spaces/abc' }) as {
      ok: boolean
      space: { meetingUri?: string; activeConference?: { conferenceRecord?: string } }
    }
    expect(result.ok).toBe(true)
    expect(result.space.meetingUri).toBe('https://meet.google.com/abc-defg-hij')
    expect(result.space.activeConference).toEqual({ conferenceRecord: 'conferenceRecords/rec-1' })
    expect(seen[0]!.url).toBe('https://meet.googleapis.com/v2/spaces/abc')
    expect(seen[0]!.auth).toBe('Bearer access-1')
  })

  it('lists conference records for a space via the space.name filter', async () => {
    seen.length = 0
    const { invoke } = harness(config)
    const result = await invoke(RPC_CHANNELS.meet.CONFERENCE_RECORDS, { workspaceId: 'ws-1', space: 'spaces/abc' }) as {
      ok: boolean
      conferenceRecords: Array<{ name: string }>
    }
    expect(result.ok).toBe(true)
    expect(result.conferenceRecords.map((r) => r.name)).toEqual(['conferenceRecords/rec-1'])
    expect(seen[0]!.url).toBe(
      `https://meet.googleapis.com/v2/conferenceRecords?filter=${encodeURIComponent('space.name="spaces/abc"')}`,
    )
  })

  it('parses participants into typed rows', async () => {
    seen.length = 0
    const { invoke } = harness(config)
    const result = await invoke(RPC_CHANNELS.meet.PARTICIPANTS, {
      workspaceId: 'ws-1',
      conferenceRecord: 'conferenceRecords/rec-1',
    }) as { ok: boolean; participants: Array<{ kind: string; displayName?: string; user?: string }> }
    expect(result.ok).toBe(true)
    expect(result.participants).toEqual([
      expect.objectContaining({ kind: 'signedin', displayName: 'Ada', user: 'users/1' }),
      expect.objectContaining({ kind: 'phone', displayName: '+15550100' }),
    ])
  })

  it('parses recordings and transcripts with their Drive/Docs destinations', async () => {
    const { invoke } = harness(config)
    const recordings = await invoke(RPC_CHANNELS.meet.RECORDINGS, {
      workspaceId: 'ws-1',
      conferenceRecord: 'conferenceRecords/rec-1',
    }) as { ok: boolean; recordings: Array<{ name: string; driveDestination?: { file?: string } }> }
    expect(recordings.ok).toBe(true)
    expect(recordings.recordings[0] as unknown as Record<string, unknown>).toEqual({
      name: 'conferenceRecords/rec-1/recordings/r1',
      state: 'FILE_GENERATED',
      driveDestination: { file: 'drive/file-1', exportUri: 'https://drive.google.com/file/d/file-1' },
    })

    const transcripts = await invoke(RPC_CHANNELS.meet.TRANSCRIPTS, {
      workspaceId: 'ws-1',
      conferenceRecord: 'conferenceRecords/rec-1',
    }) as { ok: boolean; transcripts: Array<{ name: string; docsDestination?: { document?: string } }> }
    expect(transcripts.ok).toBe(true)
    expect(transcripts.transcripts[0] as unknown as Record<string, unknown>).toEqual({
      name: 'conferenceRecords/rec-1/transcripts/t1',
      state: 'FILE_GENERATED',
      docsDestination: { document: 'documents/doc-1', exportUri: 'https://docs.google.com/document/d/doc-1' },
    })
  })

  it('parses smart notes into Docs destinations', async () => {
    const { invoke } = harness(config)
    const result = await invoke(RPC_CHANNELS.meet.SMART_NOTES, {
      workspaceId: 'ws-1',
      conferenceRecord: 'conferenceRecords/rec-1',
    }) as { ok: boolean; smartNotes: Array<{ name: string; docsDestination?: { document?: string } }> }
    expect(result.ok).toBe(true)
    expect(result.smartNotes[0] as unknown as Record<string, unknown>).toEqual({
      name: 'conferenceRecords/rec-1/smartNotes/s1',
      state: 'FILE_GENERATED',
      docsDestination: { document: 'documents/note-1' },
    })
  })

  it('reports a non-OK upstream response as MEET_FETCH_FAILED', async () => {
    const { invoke } = harness({
      enrollmentAcknowledged: true,
      accessToken: 'access-1',
      apiBase: 'https://meet.googleapis.com/v2',
      fetchImpl: (() => Promise.resolve(jsonResponse({ error: { message: 'nope' } }, 403))) as unknown as typeof fetch,
    })
    const result = await invoke(RPC_CHANNELS.meet.PARTICIPANTS, {
      workspaceId: 'ws-1',
      conferenceRecord: 'conferenceRecords/rec-1',
    }) as { ok: boolean; code?: string }
    expect(result).toMatchObject({ ok: false, code: 'MEET_FETCH_FAILED' })
  })

  it('rejects a malformed resource name before any fetch', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch')
    try {
      const { invoke } = harness(config)
      await expect(invoke(RPC_CHANNELS.meet.PARTICIPANTS, {
        workspaceId: 'ws-1',
        conferenceRecord: 'not-a-record',
      })).rejects.toMatchObject({ code: 'INVALID_PAYLOAD' })
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      fetchSpy.mockRestore()
    }
  })
})