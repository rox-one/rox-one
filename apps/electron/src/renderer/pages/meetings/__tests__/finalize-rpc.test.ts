import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Meeting } from '@craft-agent/core/meetings'
import { buildMeetingImportGrant } from '../import-rpc'
import {
  finalizeMeetingViaRpc,
  i18nKeyForFinalizeError,
  type MeetingFinalizeApi,
} from '../finalize-rpc'

const grant = buildMeetingImportGrant({ workspaceId: 'ws', actorId: 'user' })

function completed(remoteType: 'import-intent' | 'capture-intent'): Meeting {
  return {
    schemaVersion: 1,
    workspaceId: 'ws',
    meetingId: 'meeting-1',
    entityId: 'call:meeting-1',
    revision: 3,
    status: 'completed',
    title: 'локальная',
    createdAt: 1,
    updatedAt: 3,
    archiveGranted: false,
    sourceBinding: {
      provider: 'native-journal',
      accountId: 'user',
      remoteType,
      remoteId: 'meeting-1',
    },
  }
}

describe('meetings finalize RPC client', () => {
  it('maps finalize fail-closed codes without claiming mic', () => {
    expect(i18nKeyForFinalizeError('grant-required')).toBe('meetings.grantRequired')
    expect(i18nKeyForFinalizeError('archive-denied')).toBe('meetings.archiveDenied')
    expect(i18nKeyForFinalizeError('finalize-failed')).toBe('meetings.finalizeFailed')
    expect(i18nKeyForFinalizeError('finalize-not-ready')).toBe('meetings.finalizeNotReady')
    expect(i18nKeyForFinalizeError('capture-in-progress')).toBe('meetings.finalizeNotReady')
    expect(i18nKeyForFinalizeError('archive-denied')).not.toBe('meetings.capabilityDenied')
  })

  it('does not call finalizeMeeting without api, meeting, or grant', async () => {
    const calls: unknown[] = []
    const api: MeetingFinalizeApi = {
      finalizeMeeting: async (...args) => {
        calls.push(args)
        return { meeting: completed('import-intent') }
      },
    }
    expect(await finalizeMeetingViaRpc({
      api: null,
      workspaceId: 'ws',
      meetingId: 'meeting-1',
      actorId: 'user',
      grant,
    })).toEqual({ ok: false, code: 'rpc-unavailable' })
    expect(await finalizeMeetingViaRpc({
      api,
      workspaceId: 'ws',
      meetingId: null,
      actorId: 'user',
      grant,
    })).toEqual({ ok: false, code: 'meeting-required' })
    expect(await finalizeMeetingViaRpc({
      api,
      workspaceId: 'ws',
      meetingId: 'meeting-1',
      actorId: 'user',
      grant: null,
    })).toEqual({ ok: false, code: 'grant-required' })
    expect(calls).toEqual([])
  })

  it('finalize goes through RPC and stays native-journal completed', async () => {
    const calls: Array<{ channel: string; args: unknown[] }> = []
    const api: MeetingFinalizeApi = {
      finalizeMeeting: async (...args) => {
        calls.push({ channel: 'meetings:finalize', args })
        return { meeting: completed('import-intent') }
      },
    }
    const result = await finalizeMeetingViaRpc({
      api,
      workspaceId: 'ws',
      meetingId: 'meeting-1',
      actorId: 'user',
      grant,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected finalize')
    expect(result.meeting.status).toBe('completed')
    expect(calls[0]?.channel).toBe('meetings:finalize')
    expect(calls[0]?.args).toEqual(['ws', 'meeting-1', 'user', grant])
  })

  it('rejects a live-looking SFU binding from RPC', async () => {
    const live: Meeting = {
      ...completed('import-intent'),
      sourceBinding: {
        provider: 'sfu',
        accountId: 'user',
        remoteType: 'room',
        remoteId: 'room-1',
      },
    }
    const api: MeetingFinalizeApi = {
      finalizeMeeting: async () => ({ meeting: live }),
    }
    expect(await finalizeMeetingViaRpc({
      api,
      workspaceId: 'ws',
      meetingId: 'meeting-1',
      actorId: 'user',
      grant,
    })).toEqual({ ok: false, code: 'finalize-failed' })
  })

  it('wires MeetingsPage through finalize RPC, not invented ASR text', () => {
    const page = readFileSync(join(__dirname, '../../MeetingsPage.tsx'), 'utf8')
    expect(page).toContain('finalizeMeetingViaRpc')
    expect(page).toContain('meetings.finalizeIntent')
    expect(page).toContain('meetings.transcriptNone')
    expect(page).toContain('meetings-finalize')
    expect(page).not.toContain('segment.upsert')
    expect(page).not.toContain('webkitSpeechRecognition')
  })
})
