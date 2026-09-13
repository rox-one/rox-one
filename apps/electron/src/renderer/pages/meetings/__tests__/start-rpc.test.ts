import { describe, expect, it } from 'bun:test'
import type { Meeting } from '@craft-agent/core/meetings'
import type { MeetingGrant } from '@craft-agent/shared/meeting-agents'
import {
  i18nKeyForStartError,
  listNativeMeetingsViaRpc,
  startNativeMeetingViaRpc,
  type MeetingCatalogApi,
} from '../start-rpc'

const grant: MeetingGrant = {
  id: 'g',
  actorId: 'user',
  workspaceId: 'ws',
  deviceId: 'desktop',
  capabilities: ['send'],
}

function planned(): Meeting {
  return {
    schemaVersion: 1,
    workspaceId: 'ws',
    meetingId: 'meeting-1',
    entityId: 'call:meeting-1',
    revision: 1,
    status: 'planned',
    title: 'локальная',
    createdAt: 1,
    updatedAt: 1,
    archiveGranted: false,
  }
}

describe('meetings start RPC client', () => {
  it('maps start fail-closed codes', () => {
    expect(i18nKeyForStartError('grant-required')).toBe('meetings.grantRequired')
    expect(i18nKeyForStartError('config-dir-required')).toBe('meetings.configDirRequired')
    expect(i18nKeyForStartError('start-failed')).toBe('meetings.startFailed')
  })

  it('does not call createMeeting without api, workspace, or grant', async () => {
    const calls: unknown[] = []
    const api: MeetingCatalogApi = {
      createMeeting: async (...args) => {
        calls.push(args)
        return { meeting: planned() }
      },
      listMeetings: async () => ({ page: [], continueCursor: null }),
    }
    expect(await startNativeMeetingViaRpc({
      api: null,
      workspaceId: 'ws',
      actorId: 'user',
      grant,
      title: 'локальная',
    })).toEqual({ ok: false, code: 'rpc-unavailable' })
    expect(await startNativeMeetingViaRpc({
      api,
      workspaceId: null,
      actorId: 'user',
      grant,
      title: 'локальная',
    })).toEqual({ ok: false, code: 'workspace-required' })
    expect(await startNativeMeetingViaRpc({
      api,
      workspaceId: 'ws',
      actorId: 'user',
      grant: null,
      title: 'локальная',
    })).toEqual({ ok: false, code: 'grant-required' })
    expect(calls).toEqual([])
  })

  it('start and list go through RPC and stay planned, not live', async () => {
    const calls: Array<{ channel: string; args: unknown[] }> = []
    const api: MeetingCatalogApi = {
      createMeeting: async (...args) => {
        calls.push({ channel: 'meetings:create', args })
        return { meeting: planned() }
      },
      listMeetings: async (...args) => {
        calls.push({ channel: 'meetings:list', args })
        return { page: [planned()], continueCursor: null }
      },
    }
    const started = await startNativeMeetingViaRpc({
      api,
      workspaceId: 'ws',
      actorId: 'user',
      grant,
      title: 'локальная',
    })
    expect(started.ok).toBe(true)
    if (!started.ok) throw new Error('expected start')
    expect(started.meeting.status).toBe('planned')
    const listed = await listNativeMeetingsViaRpc({ api, workspaceId: 'ws' })
    expect(listed.ok).toBe(true)
    if (!listed.ok) throw new Error('expected list')
    expect(listed.meetings[0]?.id).toBe('meeting-1')
    expect(calls[0]?.channel).toBe('meetings:create')
    expect(calls[0]?.args).toEqual(['ws', 'локальная', 'user', grant])
    expect(calls[1]?.channel).toBe('meetings:list')
  })
})
