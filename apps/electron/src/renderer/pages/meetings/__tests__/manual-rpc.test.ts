import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Meeting } from '@craft-agent/core/meetings'
import { buildMeetingImportGrant } from '../import-rpc'
import {
  addManualNoteViaRpc,
  correctSegmentViaRpc,
  i18nKeyForManualError,
  type MeetingManualApi,
} from '../manual-rpc'

const grant = buildMeetingImportGrant({ workspaceId: 'ws', actorId: 'user' })

function native(status: Meeting['status'] = 'finalizing'): Meeting {
  return {
    schemaVersion: 1,
    workspaceId: 'ws',
    meetingId: 'meeting-1',
    entityId: 'call:meeting-1',
    revision: 3,
    status,
    title: 'локальная',
    createdAt: 1,
    updatedAt: 3,
    archiveGranted: false,
    sourceBinding: {
      provider: 'native-journal',
      accountId: 'user',
      remoteType: 'import-intent',
      remoteId: 'meeting-1',
    },
  }
}

describe('meetings manual note / correction RPC client', () => {
  it('maps fail-closed codes without claiming mic', () => {
    expect(i18nKeyForManualError('grant-required')).toBe('meetings.grantRequired')
    expect(i18nKeyForManualError('archive-denied')).toBe('meetings.archiveDenied')
    expect(i18nKeyForManualError('note-empty')).toBe('meetings.noteEmpty')
    expect(i18nKeyForManualError('correction-empty')).toBe('meetings.correctionEmpty')
    expect(i18nKeyForManualError('note-not-ready')).toBe('meetings.manualNoteNotReady')
    expect(i18nKeyForManualError('correct-not-ready')).toBe('meetings.correctNotReady')
    expect(i18nKeyForManualError('archive-denied')).not.toBe('meetings.capabilityDenied')
  })

  it('does not call RPCs without api, meeting, grant, or text', async () => {
    const calls: unknown[] = []
    const api: MeetingManualApi = {
      addManualNote: async (...args) => {
        calls.push(['note', args])
        return { meeting: native() }
      },
      correctSegment: async (...args) => {
        calls.push(['correct', args])
        return { meeting: native() }
      },
    }
    expect(await addManualNoteViaRpc({
      api: null,
      workspaceId: 'ws',
      meetingId: 'meeting-1',
      actorId: 'user',
      grant,
      spec: { noteId: 'n1', text: 'правка' },
    })).toEqual({ ok: false, code: 'rpc-unavailable' })
    expect(await addManualNoteViaRpc({
      api,
      workspaceId: 'ws',
      meetingId: null,
      actorId: 'user',
      grant,
      spec: { noteId: 'n1', text: 'правка' },
    })).toEqual({ ok: false, code: 'meeting-required' })
    expect(await addManualNoteViaRpc({
      api,
      workspaceId: 'ws',
      meetingId: 'meeting-1',
      actorId: 'user',
      grant: null,
      spec: { noteId: 'n1', text: 'правка' },
    })).toEqual({ ok: false, code: 'grant-required' })
    expect(await addManualNoteViaRpc({
      api,
      workspaceId: 'ws',
      meetingId: 'meeting-1',
      actorId: 'user',
      grant,
      spec: { noteId: 'n1', text: '  ' },
    })).toEqual({ ok: false, code: 'note-empty' })
    expect(await correctSegmentViaRpc({
      api,
      workspaceId: 'ws',
      meetingId: 'meeting-1',
      actorId: 'user',
      grant,
      spec: null,
    })).toEqual({ ok: false, code: 'correction-empty' })
    expect(calls).toEqual([])
  })

  it('note and correction go through RPC and stay native-journal', async () => {
    const calls: Array<{ channel: string; args: unknown[] }> = []
    const api: MeetingManualApi = {
      addManualNote: async (...args) => {
        calls.push({ channel: 'meetings:addManualNote', args })
        return { meeting: native() }
      },
      correctSegment: async (...args) => {
        calls.push({ channel: 'meetings:correctSegment', args })
        return { meeting: native() }
      },
    }
    const noteSpec = { noteId: 'n1', text: 'правка' }
    const note = await addManualNoteViaRpc({
      api,
      workspaceId: 'ws',
      meetingId: 'meeting-1',
      actorId: 'user',
      grant,
      spec: noteSpec,
    })
    expect(note.ok).toBe(true)
    const correctionSpec = { segmentId: 's1', replacement: 'исправление' }
    const correction = await correctSegmentViaRpc({
      api,
      workspaceId: 'ws',
      meetingId: 'meeting-1',
      actorId: 'user',
      grant,
      spec: correctionSpec,
    })
    expect(correction.ok).toBe(true)
    expect(calls[0]?.channel).toBe('meetings:addManualNote')
    expect(calls[1]?.channel).toBe('meetings:correctSegment')
    expect(calls[0]?.args).toEqual(['ws', 'meeting-1', 'user', grant, noteSpec])
    expect(calls[1]?.args).toEqual(['ws', 'meeting-1', 'user', grant, correctionSpec])
  })

  it('rejects a live-looking SFU binding from RPC', async () => {
    const live: Meeting = {
      ...native(),
      sourceBinding: {
        provider: 'sfu',
        accountId: 'user',
        remoteType: 'room',
        remoteId: 'room-1',
      },
    }
    const api: MeetingManualApi = {
      addManualNote: async () => ({ meeting: live }),
      correctSegment: async () => ({ meeting: live }),
    }
    expect(await addManualNoteViaRpc({
      api,
      workspaceId: 'ws',
      meetingId: 'meeting-1',
      actorId: 'user',
      grant,
      spec: { noteId: 'n1', text: 'правка' },
    })).toEqual({ ok: false, code: 'note-failed' })
    expect(await correctSegmentViaRpc({
      api,
      workspaceId: 'ws',
      meetingId: 'meeting-1',
      actorId: 'user',
      grant,
      spec: { segmentId: 's1', replacement: 'исправление' },
    })).toEqual({ ok: false, code: 'correct-failed' })
  })

  it('wires MeetingsPage through manual RPCs, not invented ASR text', () => {
    const page = readFileSync(join(__dirname, '../../MeetingsPage.tsx'), 'utf8')
    expect(page).toContain('addManualNoteViaRpc')
    expect(page).toContain('correctSegmentViaRpc')
    expect(page).toContain('meetings.addManualNoteIntent')
    expect(page).toContain('meetings.correctIntent')
    expect(page).toContain('meetings-add-manual-note')
    expect(page).toContain('meetings-correct-segment')
    expect(page).not.toContain('segment.upsert')
    expect(page).not.toContain('webkitSpeechRecognition')
  })
})
