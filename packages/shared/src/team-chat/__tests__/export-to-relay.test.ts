import { describe, expect, test } from 'bun:test'
import { exportTeamChatToRelay, TeamChatExportError } from '../export-to-relay.ts'
import type { TeamChatStoreFile } from '../types.ts'

const NOW = 1_700_000_000_000

function sample(): TeamChatStoreFile {
  return {
    version: 1,
    channels: [
      {
        id: 'ch-1',
        orgId: 'org-1',
        kind: 'channel',
        visibility: 'public',
        name: 'general',
        createdBy: 'u1',
        createdAt: 100,
        lastSeq: 2,
      },
    ],
    members: [{ channelId: 'ch-1', userId: 'u1', role: 'owner', joinedAt: 100, lastReadSeq: 2 }],
    subscriptions: [{ channelId: 'ch-1', userId: 'u2', createdAt: 150 }],
    messages: [
      { id: 'm1', channelId: 'ch-1', seq: 1, senderId: 'u1', text: 'hello', createdAt: 200, kind: 'text' },
      {
        id: 'm2',
        channelId: 'ch-1',
        seq: 2,
        senderId: 'u1',
        text: '',
        createdAt: 300,
        kind: 'system',
        callId: 'call-1',
        event: 'call.started',
      },
      {
        id: 'm3',
        channelId: 'ch-1',
        seq: 3,
        senderId: 'u1',
        text: '',
        createdAt: 400,
        kind: 'system',
        callId: 'call-1',
        event: 'call.ended',
      },
    ],
    calls: [
      {
        id: 'call-1',
        channelId: 'ch-1',
        roomName: 'rox-ch-ch-1',
        startedBy: 'u1',
        startedAt: 300,
        endedAt: 400,
        participantIds: [],
        everParticipantIds: ['u1', 'u2'],
        transcript: [],
      },
    ],
  }
}

describe('exportTeamChatToRelay', () => {
  test('maps channels, members, text messages and call service events', () => {
    const manifest = exportTeamChatToRelay(sample(), { now: () => NOW })
    expect(manifest.version).toBe(1)
    expect(manifest.source).toBe('team-chat.json')
    expect(manifest.exportedAt).toBe(NOW)
    expect(manifest.channels).toEqual([
      {
        channelId: 'ch-1',
        orgId: 'org-1',
        name: 'general',
        kind: 'channel',
        visibility: 'public',
        createdAt: 100,
      },
    ])
    expect(manifest.members[0]).toMatchObject({ channelId: 'ch-1', userId: 'u1', role: 'owner' })
    expect(manifest.subscriptions[0]).toMatchObject({ channelId: 'ch-1', userId: 'u2', createdAt: 150 })
    expect(manifest.messages).toEqual([
      { channelId: 'ch-1', localId: 'm1', senderId: 'u1', text: 'hello', createdAt: 200, seq: 1 },
    ])
    expect(manifest.serviceEvents.map((e) => e.type)).toEqual(['call.started', 'call.ended'])
    expect(manifest.serviceEvents[0]).toMatchObject({
      channelId: 'ch-1',
      callId: 'call-1',
      roomName: 'rox-ch-ch-1',
      type: 'call.started',
    })
    expect(manifest.serviceEvents[1]).toMatchObject({
      type: 'call.ended',
      durationSec: 0,
      participants: ['u1', 'u2'],
    })
    expect(manifest.stats).toEqual({
      channelCount: 1,
      memberCount: 1,
      messageCount: 1,
      serviceEventCount: 2,
      skippedMessages: 0,
    })
  })

  test('rejects a non-object root', () => {
    expect(() => exportTeamChatToRelay(null)).toThrow(TeamChatExportError)
  })
})
