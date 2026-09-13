import { describe, expect, it } from 'bun:test'
import type { Meeting } from '@craft-agent/core/meetings'
import {
  buildMeetingImportGrant,
  i18nKeyForImportError,
  importMediaViaRpc,
  specFromBytes,
  type ImportMediaSpec,
  type MeetingImportApi,
} from '../import-rpc'

const grant = buildMeetingImportGrant({ workspaceId: 'ws', actorId: 'user' })

function imported(spec: ImportMediaSpec): Meeting {
  return {
    schemaVersion: 1,
    workspaceId: 'ws',
    meetingId: 'meeting-1',
    entityId: 'call:meeting-1',
    revision: 2,
    status: 'finalizing',
    title: 'локальная',
    createdAt: 1,
    updatedAt: 2,
    archiveGranted: false,
    sourceBinding: {
      provider: 'native-journal',
      accountId: 'user',
      remoteType: 'import-intent',
      remoteId: spec.contentHash,
    },
  }
}

describe('meetings import RPC client', () => {
  it('maps import fail-closed codes', () => {
    expect(i18nKeyForImportError('grant-required')).toBe('meetings.grantRequired')
    expect(i18nKeyForImportError('archive-denied')).toBe('meetings.archiveDenied')
    expect(i18nKeyForImportError('import-empty')).toBe('meetings.importEmpty')
    expect(i18nKeyForImportError('import-bad-format')).toBe('meetings.importBadFormat')
  })

  it('does not call importMedia without api, meeting, grant, or spec', async () => {
    const calls: unknown[] = []
    const spec: ImportMediaSpec = { contentHash: 'a'.repeat(64), byteLength: 4, mimeType: 'audio/wav' }
    const api: MeetingImportApi = {
      importMedia: async (...args) => {
        calls.push(args)
        return { meeting: imported(spec) }
      },
    }
    expect(await importMediaViaRpc({
      api: null,
      workspaceId: 'ws',
      meetingId: 'meeting-1',
      actorId: 'user',
      grant,
      spec,
    })).toEqual({ ok: false, code: 'rpc-unavailable' })
    expect(await importMediaViaRpc({
      api,
      workspaceId: 'ws',
      meetingId: null,
      actorId: 'user',
      grant,
      spec,
    })).toEqual({ ok: false, code: 'meeting-required' })
    expect(await importMediaViaRpc({
      api,
      workspaceId: 'ws',
      meetingId: 'meeting-1',
      actorId: 'user',
      grant: null,
      spec,
    })).toEqual({ ok: false, code: 'grant-required' })
    expect(await importMediaViaRpc({
      api,
      workspaceId: 'ws',
      meetingId: 'meeting-1',
      actorId: 'user',
      grant,
      spec: null,
    })).toEqual({ ok: false, code: 'import-empty' })
    expect(calls).toEqual([])
  })

  it('import goes through RPC and stays native-journal, not live SFU', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4])
    const spec = await specFromBytes(bytes, 'audio/wav')
    const calls: Array<{ channel: string; args: unknown[] }> = []
    const api: MeetingImportApi = {
      importMedia: async (...args) => {
        calls.push({ channel: 'meetings:importMedia', args })
        return { meeting: imported(spec) }
      },
    }
    const result = await importMediaViaRpc({
      api,
      workspaceId: 'ws',
      meetingId: 'meeting-1',
      actorId: 'user',
      grant,
      spec,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected import')
    expect(result.meeting.status).toBe('finalizing')
    expect(calls[0]?.channel).toBe('meetings:importMedia')
    expect(calls[0]?.args).toEqual(['ws', 'meeting-1', 'user', grant, spec])
  })

  it('rejects a live-looking SFU binding from RPC', async () => {
    const spec: ImportMediaSpec = { contentHash: 'b'.repeat(64), byteLength: 4, mimeType: 'audio/wav' }
    const live: Meeting = {
      ...imported(spec),
      sourceBinding: {
        provider: 'sfu',
        accountId: 'user',
        remoteType: 'room',
        remoteId: 'room-1',
      },
    }
    const api: MeetingImportApi = {
      importMedia: async () => ({ meeting: live }),
    }
    expect(await importMediaViaRpc({
      api,
      workspaceId: 'ws',
      meetingId: 'meeting-1',
      actorId: 'user',
      grant,
      spec,
    })).toEqual({ ok: false, code: 'import-failed' })
  })
})
