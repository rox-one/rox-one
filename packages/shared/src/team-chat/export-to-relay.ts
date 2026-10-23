/**
 * One-off export of CONFIG_DIR/team-chat.json (PR #2017 local store) into a
 * relay-ready migration manifest for Rox Messenger.
 *
 * Pure / no I/O besides the caller-supplied file contents. The CLI wrapper
 * (`scripts/messenger/export-team-chat.ts`) reads the file and writes JSON.
 *
 * The manifest is additive: channels keep their existing ids so LiveKit rooms
 * (`rox-ch-<channelId>`) and Calls stay aligned with messenger-contract v1.1.
 * Messages become kind-9 stream drafts; call system/transcript rows become
 * service-event drafts matching POST /v1/im/channels/:id/service-events.
 */

import { toMessengerCallEvent } from './storage.ts'
import type {
  TeamChannel,
  TeamChannelCall,
  TeamChannelMember,
  TeamChannelMessage,
  TeamChannelSubscription,
  TeamChatStoreFile,
} from './types.ts'

export const TEAM_CHAT_EXPORT_VERSION = 1 as const

export interface TeamChatRelayExportChannel {
  channelId: string
  orgId: string
  name: string
  kind: TeamChannel['kind']
  visibility: TeamChannel['visibility']
  topic?: string
  createdAt: number
  archivedAt?: number
}

export interface TeamChatRelayExportMember {
  channelId: string
  userId: string
  role: TeamChannelMember['role']
}

export interface TeamChatRelayExportSubscription {
  channelId: string
  userId: string
  createdAt: number
}

/** Unsigned kind-9 draft the importer signs with the user's relay key. */
export interface TeamChatRelayExportMessageDraft {
  channelId: string
  localId: string
  senderId: string
  text: string
  createdAt: number
  /** Original seq in team-chat.json, for stable re-runs. */
  seq: number
}

/** Body for POST /v1/im/channels/:channelId/service-events (contract v1.1). */
export interface TeamChatRelayExportServiceEventDraft {
  channelId: string
  type: 'call.started' | 'call.ended' | 'call.transcript'
  roomName: string
  callId: string
  ts?: number
  durationSec?: number
  participants?: string[]
  transcriptUrl?: string
  summary?: string
}

export interface TeamChatRelayExportManifest {
  version: typeof TEAM_CHAT_EXPORT_VERSION
  source: 'team-chat.json'
  exportedAt: number
  channels: TeamChatRelayExportChannel[]
  members: TeamChatRelayExportMember[]
  subscriptions: TeamChatRelayExportSubscription[]
  messages: TeamChatRelayExportMessageDraft[]
  serviceEvents: TeamChatRelayExportServiceEventDraft[]
  stats: {
    channelCount: number
    memberCount: number
    messageCount: number
    serviceEventCount: number
    skippedMessages: number
  }
}

export class TeamChatExportError extends Error {
  constructor(readonly code: 'INVALID', message: string) {
    super(message)
    this.name = 'TeamChatExportError'
  }
}

function asStore(raw: unknown): TeamChatStoreFile {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TeamChatExportError('INVALID', 'team-chat.json root must be an object')
  }
  const o = raw as Partial<TeamChatStoreFile>
  return {
    version: 1,
    channels: Array.isArray(o.channels) ? o.channels : [],
    members: Array.isArray(o.members) ? o.members : [],
    subscriptions: Array.isArray(o.subscriptions) ? o.subscriptions : [],
    messages: Array.isArray(o.messages) ? o.messages : [],
    calls: Array.isArray(o.calls) ? o.calls : [],
  }
}

function callById(calls: TeamChannelCall[]): Map<string, TeamChannelCall> {
  const map = new Map<string, TeamChannelCall>()
  for (const call of calls) {
    if (call && typeof call.id === 'string') map.set(call.id, call)
  }
  return map
}

/**
 * Convert a parsed team-chat.json document into a relay migration manifest.
 * Idempotent: re-running on the same file yields the same channel/message ids.
 */
export function exportTeamChatToRelay(
  raw: unknown,
  opts: { now?: () => number } = {},
): TeamChatRelayExportManifest {
  const store = asStore(raw)
  const now = opts.now ?? Date.now
  const calls = callById(store.calls ?? [])

  const channels: TeamChatRelayExportChannel[] = []
  for (const ch of store.channels) {
    if (!ch || typeof ch.id !== 'string' || typeof ch.orgId !== 'string') continue
    channels.push({
      channelId: ch.id,
      orgId: ch.orgId,
      name: typeof ch.name === 'string' ? ch.name : 'channel',
      kind: ch.kind === 'group' ? 'group' : 'channel',
      visibility: ch.visibility === 'private' ? 'private' : 'public',
      ...(typeof ch.topic === 'string' && ch.topic ? { topic: ch.topic } : {}),
      createdAt: typeof ch.createdAt === 'number' ? ch.createdAt : 0,
      ...(typeof ch.archivedAt === 'number' ? { archivedAt: ch.archivedAt } : {}),
    })
  }

  const members: TeamChatRelayExportMember[] = []
  for (const m of store.members) {
    if (!m || typeof m.channelId !== 'string' || typeof m.userId !== 'string') continue
    members.push({
      channelId: m.channelId,
      userId: m.userId,
      role: m.role === 'owner' || m.role === 'admin' ? m.role : 'member',
    })
  }

  const subscriptions: TeamChatRelayExportSubscription[] = []
  for (const s of store.subscriptions) {
    if (!s || typeof s.channelId !== 'string' || typeof s.userId !== 'string') continue
    subscriptions.push({
      channelId: s.channelId,
      userId: s.userId,
      createdAt: typeof s.createdAt === 'number' ? s.createdAt : 0,
    })
  }

  const messages: TeamChatRelayExportMessageDraft[] = []
  const serviceEvents: TeamChatRelayExportServiceEventDraft[] = []
  let skippedMessages = 0

  for (const msg of store.messages) {
    if (!msg || typeof msg.channelId !== 'string' || typeof msg.id !== 'string') {
      skippedMessages += 1
      continue
    }
    if (msg.kind === 'system' || msg.kind === 'transcript' || msg.kind === 'summary') {
      const call = typeof msg.callId === 'string' ? calls.get(msg.callId) : undefined
      if (!call) {
        skippedMessages += 1
        continue
      }
      const mapped = toMessengerCallEvent(msg, call)
      if (!mapped) {
        skippedMessages += 1
        continue
      }
      const draft: TeamChatRelayExportServiceEventDraft = {
        channelId: msg.channelId,
        type: mapped.type,
        roomName: mapped.roomName,
        callId: call.id,
      }
      if (mapped.type === 'call.started') draft.ts = mapped.ts
      if (mapped.type === 'call.ended') {
        draft.durationSec = mapped.durationSec
        draft.participants = mapped.participants
      }
      if (mapped.type === 'call.transcript') {
        if (mapped.transcriptUrl) draft.transcriptUrl = mapped.transcriptUrl
        if (mapped.summary) draft.summary = mapped.summary
        else if (typeof msg.text === 'string' && msg.text) draft.summary = msg.text
      }
      serviceEvents.push(draft)
      continue
    }
    // text (default) messages
    messages.push({
      channelId: msg.channelId,
      localId: msg.id,
      senderId: typeof msg.senderId === 'string' ? msg.senderId : '',
      text: typeof msg.text === 'string' ? msg.text : '',
      createdAt: typeof msg.createdAt === 'number' ? msg.createdAt : 0,
      seq: typeof msg.seq === 'number' ? msg.seq : 0,
    })
  }

  return {
    version: TEAM_CHAT_EXPORT_VERSION,
    source: 'team-chat.json',
    exportedAt: now(),
    channels,
    members,
    subscriptions,
    messages,
    serviceEvents,
    stats: {
      channelCount: channels.length,
      memberCount: members.length,
      messageCount: messages.length,
      serviceEventCount: serviceEvents.length,
      skippedMessages,
    },
  }
}

/** Narrow helper for tests / CLIs that already hold a typed store. */
export function exportTeamChatStore(
  store: TeamChatStoreFile,
  opts?: { now?: () => number },
): TeamChatRelayExportManifest {
  return exportTeamChatToRelay(store, opts)
}
