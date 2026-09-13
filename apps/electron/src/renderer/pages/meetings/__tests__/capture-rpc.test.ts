import { describe, expect, it } from 'bun:test'
import type { Meeting } from '@craft-agent/core/meetings'
import type { MeetingGrant } from '@craft-agent/shared/meeting-agents'
import {
  applyCaptureIntentViaRpc,
  buildMeetingCaptureGrant,
  i18nKeyForCaptureError,
  type MeetingCaptureApi,
} from '../capture-rpc'

const grant = buildMeetingCaptureGrant({ workspaceId: 'ws', actorId: 'user' })

function capturing(): Meeting {
  return {
    schemaVersion: 1,
    workspaceId: 'ws',
    meetingId: 'meeting-1',
    entityId: 'call:meeting-1',
    revision: 2,
    status: 'capturing',
    title: 'локальная',
    createdAt: 1,
    updatedAt: 2,
    archiveGranted: false,
    sourceBinding: {
      provider: 'native-journal',
      accountId: 'user',
      remoteType: 'capture-intent',
      remoteId: 'meeting-1',
    },
  }
}

describe('meetings capture RPC client', () => {
  it('maps capture fail-closed codes', () => {
    expect(i18nKeyForCaptureError('grant-required')).toBe('meetings.grantRequired')
    expect(i18nKeyForCaptureError('capability-denied')).toBe('meetings.capabilityDenied')
    expect(i18nKeyForCaptureError('capture-not-started')).toBe('meetings.captureNotStarted')
    expect(i18nKeyForCaptureError('meeting-not-found')).toBe('meetings.meetingNotFound')
  })

  it('does not call startCapture without api, meeting, or grant', async () => {
    const calls: unknown[] = []
    const api: MeetingCaptureApi = {
      startCapture: async (...args) => {
        calls.push(args)
        return { meeting: capturing() }
      },
      pauseCapture: async () => ({ meeting: capturing() }),
      stopCapture: async () => ({ meeting: capturing() }),
    }
    expect(await applyCaptureIntentViaRpc({
      api: null,
      workspaceId: 'ws',
      meetingId: 'meeting-1',
      actorId: 'user',
      grant,
      action: 'start',
    })).toEqual({ ok: false, code: 'rpc-unavailable' })
    expect(await applyCaptureIntentViaRpc({
      api,
      workspaceId: 'ws',
      meetingId: null,
      actorId: 'user',
      grant,
      action: 'start',
    })).toEqual({ ok: false, code: 'meeting-required' })
    expect(await applyCaptureIntentViaRpc({
      api,
      workspaceId: 'ws',
      meetingId: 'meeting-1',
      actorId: 'user',
      grant: null,
      action: 'start',
    })).toEqual({ ok: false, code: 'grant-required' })
    expect(calls).toEqual([])
  })

  it('start goes through RPC and stays native-journal, not live SFU', async () => {
    const calls: Array<{ channel: string; args: unknown[] }> = []
    const api: MeetingCaptureApi = {
      startCapture: async (...args) => {
        calls.push({ channel: 'meetings:startCapture', args })
        return { meeting: capturing() }
      },
      pauseCapture: async () => ({ meeting: capturing() }),
      stopCapture: async () => ({ meeting: capturing() }),
    }
    const started = await applyCaptureIntentViaRpc({
      api,
      workspaceId: 'ws',
      meetingId: 'meeting-1',
      actorId: 'user',
      grant,
      action: 'start',
    })
    expect(started.ok).toBe(true)
    if (!started.ok) throw new Error('expected capture')
    expect(started.meeting.status).toBe('capturing')
    expect(calls[0]?.channel).toBe('meetings:startCapture')
    expect(calls[0]?.args).toEqual(['ws', 'meeting-1', 'user', grant])
  })

  it('rejects a live-looking binding from RPC', async () => {
    const live: Meeting = {
      ...capturing(),
      sourceBinding: {
        provider: 'sfu',
        accountId: 'user',
        remoteType: 'room',
        remoteId: 'room-1',
      },
    }
    const api: MeetingCaptureApi = {
      startCapture: async () => ({ meeting: live }),
      pauseCapture: async () => ({ meeting: live }),
      stopCapture: async () => ({ meeting: live }),
    }
    expect(await applyCaptureIntentViaRpc({
      api,
      workspaceId: 'ws',
      meetingId: 'meeting-1',
      actorId: 'user',
      grant,
      action: 'start',
    })).toEqual({ ok: false, code: 'capture-failed' })
  })
})
