/**
 * Team messenger store — CONFIG_DIR/team-chat.json.
 *
 * Authority model (phase 1): the caller is the server-verified actor; every
 * operation re-checks durable organization membership through the injected
 * org directory, and channel-level access (private = members only) here.
 * A client-supplied orgId or channelId is never proof of access.
 */

import { existsSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { randomUUID } from 'crypto'
import { atomicWriteFileSync, readJsonFileSync } from '../utils/files.ts'
import { resolveConfigDir } from '../config/paths.ts'
import type {
  CreateTeamChannelInput,
  ListTeamMessagesInput,
  TeamChannel,
  TeamChannelMember,
  TeamCallTranscriptSegment,
  TeamChannelCall,
  TeamChannelMessage,
  TeamChannelView,
  TeamChatActor,
  TeamChatStoreFile,
} from './types.ts'

export const TEAM_CHANNEL_NAME_MAX = 80
export const TEAM_CHANNEL_TOPIC_MAX = 250
export const TEAM_MESSAGE_MAX = 4000
export const TEAM_MESSAGES_PER_CHANNEL_MAX = 5000
export const TEAM_MESSAGES_PAGE_MAX = 200
export const TEAM_DEFAULT_CHANNEL_NAME = 'general'
export const TEAM_TRANSCRIPT_SEGMENTS_MAX = 20_000
export const TEAM_TRANSCRIPT_SEGMENT_TEXT_MAX = 4000
export const TEAM_TRANSCRIPT_TEXT_MAX = 400_000
export const TEAM_SUMMARY_MAX = 20_000

/** LiveKit room for a channel / DM / group (messenger contract v1: `rox-ch-<channelId>`). */
export function teamCallRoomName(channelId: string): string {
  return `rox-ch-${channelId}`
}

/**
 * Messenger contract v1 call event (`content` of a kind-9 message tagged ["rox","call"]).
 * Consumed by Rox Messenger's relay bridge / service-event endpoint (their PRs); tested here
 * so the payload shape stays in lockstep with /workspace contract v1. Null for non-call messages.
 */
export function toMessengerCallEvent(message: TeamChannelMessage, call: TeamChannelCall, opts: { transcriptUrl?: string; summary?: string } = {}):
  | { type: 'call.started'; roomName: string; startedBy: string; ts: number }
  | { type: 'call.ended'; roomName: string; durationSec: number; participants: string[] }
  | { type: 'call.transcript'; roomName: string; transcriptUrl?: string; summary?: string }
  | null {
  if (message.callId !== call.id) return null
  if (message.kind === 'system' && message.event === 'call.started') return { type: 'call.started', roomName: call.roomName, startedBy: call.startedBy, ts: Math.floor(call.startedAt / 1000) }
  if (message.kind === 'system' && message.event === 'call.ended') return { type: 'call.ended', roomName: call.roomName, durationSec: Math.max(0, Math.round(((call.endedAt ?? message.createdAt) - call.startedAt) / 1000)), participants: [...call.everParticipantIds] }
  if (message.kind === 'transcript' || message.kind === 'summary') return { type: 'call.transcript', roomName: call.roomName, ...(opts.transcriptUrl ? { transcriptUrl: opts.transcriptUrl } : {}), ...(opts.summary ? { summary: opts.summary } : {}) }
  return null
}

export class TeamChatError extends Error {
  constructor(readonly code: 'INVALID' | 'FORBIDDEN' | 'NOT_FOUND', message: string) {
    super(message)
    this.name = 'TeamChatError'
  }
}

/** Org directory the store trusts for workspace membership. */
export interface TeamChatOrgDirectory {
  /** Role in the org, or null when the user is not a durable member. */
  roleOf(orgId: string, userId: string): 'owner' | 'admin' | 'member' | null
  memberIds(orgId: string): string[]
}

export interface TeamChatStoreOptions {
  path: string
  orgs: TeamChatOrgDirectory
  now?: () => number
}

const EMPTY = (): TeamChatStoreFile => ({ version: 1, channels: [], members: [], subscriptions: [], messages: [] })

function cleanText(value: unknown, max: number, field: string, required = true): string {
  const text = typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim() : ''
  if (required && !text) throw new TeamChatError('INVALID', `${field} is required`)
  if (text.length > max) throw new TeamChatError('INVALID', `${field} is too long (max ${max})`)
  return text
}

function requireId(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(value)) throw new TeamChatError('INVALID', `${field} is invalid`)
  return value
}

export function createTeamChatStore(options: TeamChatStoreOptions) {
  const now = options.now ?? Date.now

  function load(): TeamChatStoreFile {
    if (!existsSync(options.path)) return EMPTY()
    // Fail closed: an unreadable file must not be overwritten with an empty store.
    const raw = readJsonFileSync<Partial<TeamChatStoreFile>>(options.path)
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid team chat store')
    return {
      version: 1,
      channels: Array.isArray(raw.channels) ? raw.channels : [],
      members: Array.isArray(raw.members) ? raw.members : [],
      subscriptions: Array.isArray(raw.subscriptions) ? raw.subscriptions : [],
      messages: Array.isArray(raw.messages) ? raw.messages : [],
      calls: Array.isArray(raw.calls) ? raw.calls : [],
    }
  }

  function save(store: TeamChatStoreFile): void {
    const dir = dirname(options.path)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    atomicWriteFileSync(options.path, JSON.stringify(store) + '\n')
  }

  function requireOrgMember(orgId: string, actor: TeamChatActor) {
    const role = options.orgs.roleOf(orgId, actor.userId)
    if (!role) throw new TeamChatError('FORBIDDEN', 'Not a member of this organization')
    return role
  }

  function memberOf(store: TeamChatStoreFile, channelId: string, userId: string): TeamChannelMember | undefined {
    return store.members.find(m => m.channelId === channelId && m.userId === userId)
  }

  /** Channel the actor may see: org member, and for private channels a channel member. */
  function visibleChannel(store: TeamChatStoreFile, channelId: string, actor: TeamChatActor): TeamChannel {
    const channel = store.channels.find(c => c.id === channelId)
    if (!channel) throw new TeamChatError('NOT_FOUND', 'Channel not found')
    requireOrgMember(channel.orgId, actor)
    if (channel.visibility === 'private' && !memberOf(store, channel.id, actor.userId)) {
      // Do not reveal private channel existence.
      throw new TeamChatError('NOT_FOUND', 'Channel not found')
    }
    return channel
  }

  function addMember(store: TeamChatStoreFile, channelId: string, userId: string, role: TeamChannelMember['role'], lastReadSeq = 0): void {
    if (memberOf(store, channelId, userId)) return
    store.members.push({ channelId, userId, role, joinedAt: now(), lastReadSeq })
  }

  /** Every org gets one shared default channel; every org member is in it. */
  function ensureDefault(store: TeamChatStoreFile, orgId: string, actor: TeamChatActor): boolean {
    let changed = false
    let channel = store.channels.find(c => c.orgId === orgId && c.isDefault)
    if (!channel) {
      channel = {
        id: randomUUID(), orgId, kind: 'channel', visibility: 'public', name: TEAM_DEFAULT_CHANNEL_NAME,
        isDefault: true, createdBy: actor.userId, createdAt: now(), lastSeq: 0,
      }
      store.channels.push(channel)
      changed = true
    }
    for (const userId of options.orgs.memberIds(orgId)) {
      if (!memberOf(store, channel.id, userId)) {
        addMember(store, channel.id, userId, 'member', channel.lastSeq)
        changed = true
      }
    }
    return changed
  }

  function activeCallOf(store: TeamChatStoreFile, channelId: string): TeamChannelCall | undefined {
    return (store.calls ?? []).find(c => c.channelId === channelId && !c.endedAt)
  }

  function activeCallByRoomName(store: TeamChatStoreFile, roomName: string): { channel: TeamChannel; call: TeamChannelCall } | undefined {
    const call = (store.calls ?? []).find(c => c.roomName === roomName && !c.endedAt)
    if (!call) return undefined
    const channel = store.channels.find(c => c.id === call.channelId)
    if (!channel || channel.archivedAt) return undefined
    return { channel, call }
  }

  /** Append a message of any kind; trims the channel to the retention cap. */
  function appendMessage(store: TeamChatStoreFile, channel: TeamChannel, message: Omit<TeamChannelMessage, 'id' | 'seq' | 'channelId' | 'createdAt'>): TeamChannelMessage {
    channel.lastSeq += 1
    channel.lastMessageAt = now()
    const full: TeamChannelMessage = { id: randomUUID(), channelId: channel.id, seq: channel.lastSeq, createdAt: channel.lastMessageAt, ...message }
    store.messages.push(full)
    const inChannel = store.messages.filter(m => m.channelId === channel.id)
    if (inChannel.length > TEAM_MESSAGES_PER_CHANNEL_MAX) {
      const drop = new Set(inChannel.slice(0, inChannel.length - TEAM_MESSAGES_PER_CHANNEL_MAX).map(m => m.id))
      store.messages = store.messages.filter(m => !drop.has(m.id))
    }
    return full
  }

  /** Call actions need channel membership (room authz = channel membership). */
  function callChannel(store: TeamChatStoreFile, channelIdInput: unknown, actor: TeamChatActor): TeamChannel {
    const channel = visibleChannel(store, requireId(channelIdInput, 'channelId'), actor)
    if (channel.archivedAt) throw new TeamChatError('INVALID', 'Channel is archived')
    if (!memberOf(store, channel.id, actor.userId)) throw new TeamChatError('FORBIDDEN', 'Join the channel to call')
    return channel
  }

  function cleanSegment(value: unknown, fallbackSpeaker: string): TeamCallTranscriptSegment | null {
    if (!value || typeof value !== 'object') return null
    const v = value as Record<string, unknown>
    const text = typeof v.text === 'string' ? v.text.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, TEAM_TRANSCRIPT_SEGMENT_TEXT_MAX) : ''
    if (!text) return null
    const startMs = Number(v.startMs), endMs = Number(v.endMs)
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs < 0 || endMs < startMs) return null
    const speakerId = typeof v.speakerId === 'string' && /^[A-Za-z0-9._:@-]{1,128}$/.test(v.speakerId) ? v.speakerId : fallbackSpeaker
    const speakerName = typeof v.speakerName === 'string' ? v.speakerName.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) : ''
    return { speakerId, ...(speakerName ? { speakerName } : {}), text, startMs: Math.round(startMs), endMs: Math.round(endMs) }
  }

  function formatTranscript(segments: TeamCallTranscriptSegment[]): string {
    const mmss = (ms: number) => `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`
    return segments.map(s => `[${mmss(s.startMs)}] ${s.speakerName || s.speakerId}: ${s.text}`).join('\n').slice(0, TEAM_TRANSCRIPT_TEXT_MAX)
  }

  /** Ends a call: system message + transcript message (if any). Caller saves. */
  function endCall(store: TeamChatStoreFile, channel: TeamChannel, call: TeamChannelCall): void {
    call.endedAt = now()
    call.participantIds = []
    appendMessage(store, channel, { senderId: 'system', kind: 'system', event: 'call.ended', callId: call.id, text: 'call.ended' })
    if (call.transcript.length) {
      const sorted = [...call.transcript].sort((a, b) => a.startMs - b.startMs)
      const msg = appendMessage(store, channel, { senderId: 'system', kind: 'transcript', callId: call.id, text: formatTranscript(sorted) })
      call.transcriptMessageId = msg.id
    }
  }

  /** Client DTO: the live transcript stays on the host (only its size is shared). */
  function callDto(call: TeamChannelCall): TeamChannelCall {
    return { ...call, participantIds: [...call.participantIds], everParticipantIds: [...call.everParticipantIds], transcript: [], transcriptSegments: call.transcript.length }
  }

  function lastMessageOf(store: TeamChatStoreFile, channelId: string, canSee: boolean): Pick<TeamChannelView, 'lastMessage' | 'messageCount'> {
    if (!canSee) return {}
    let last: TeamChannelMessage | undefined
    let count = 0
    for (const m of store.messages) {
      if (m.channelId !== channelId || m.deletedAt) continue
      last = m
      if (m.kind !== 'system') count++
    }
    if (!last) return { messageCount: 0 }
    const m = last
    return { messageCount: count, lastMessage: { senderId: m.senderId, text: m.text.slice(0, 140), ...(m.kind ? { kind: m.kind } : {}), ...(m.event ? { event: m.event } : {}), createdAt: m.createdAt } }
  }

  function toView(store: TeamChatStoreFile, channel: TeamChannel, userId: string): TeamChannelView {
    const members = store.members.filter(m => m.channelId === channel.id)
    const viewer = members.find(m => m.userId === userId)
    return {
      ...channel,
      memberCount: members.length,
      memberIds: members.map(m => m.userId),
      ...(viewer ? { viewerRole: viewer.role } : {}),
      viewerSubscribed: store.subscriptions.some(s => s.channelId === channel.id && s.userId === userId),
      unreadCount: viewer ? Math.max(0, channel.lastSeq - viewer.lastReadSeq) : 0,
      ...(activeCallOf(store, channel.id) ? { activeCall: callDto(activeCallOf(store, channel.id)!) } : {}),
      ...(lastMessageOf(store, channel.id, viewer !== undefined || channel.visibility === 'public')),
    }
  }

  /** postMessage plus the channel's orgId (avoids a second store load for the change event). */
  function postMessageWithOrg(channelIdInput: unknown, textInput: unknown, actor: TeamChatActor): { message: TeamChannelMessage; orgId: string } {
    const store = load()
    const channel = visibleChannel(store, requireId(channelIdInput, 'channelId'), actor)
    if (channel.archivedAt) throw new TeamChatError('INVALID', 'Channel is archived')
    const member = memberOf(store, channel.id, actor.userId)
    if (!member) throw new TeamChatError('FORBIDDEN', 'Join the channel to post')
    const text = cleanText(textInput, TEAM_MESSAGE_MAX, 'text')
    channel.lastSeq += 1
    channel.lastMessageAt = now()
    const message: TeamChannelMessage = { id: randomUUID(), channelId: channel.id, seq: channel.lastSeq, senderId: actor.userId, text, createdAt: channel.lastMessageAt }
    store.messages.push(message)
    member.lastReadSeq = channel.lastSeq
    const inChannel = store.messages.filter(m => m.channelId === channel.id)
    if (inChannel.length > TEAM_MESSAGES_PER_CHANNEL_MAX) {
      const drop = new Set(inChannel.slice(0, inChannel.length - TEAM_MESSAGES_PER_CHANNEL_MAX).map(m => m.id))
      store.messages = store.messages.filter(m => !drop.has(m.id))
    }
    save(store)
    return { message, orgId: channel.orgId }
  }

  function canManage(store: TeamChatStoreFile, channel: TeamChannel, actor: TeamChatActor): boolean {
    const member = memberOf(store, channel.id, actor.userId)
    if (member && member.role !== 'member') return true
    const orgRole = options.orgs.roleOf(channel.orgId, actor.userId)
    return orgRole === 'owner' || orgRole === 'admin'
  }

  return {
    path: options.path,

    listChannels(orgIdInput: unknown, actor: TeamChatActor): TeamChannelView[] {
      const orgId = requireId(orgIdInput, 'orgId')
      requireOrgMember(orgId, actor)
      const store = load()
      if (ensureDefault(store, orgId, actor)) save(store)
      return store.channels
        .filter(c => c.orgId === orgId && !c.archivedAt)
        .filter(c => c.visibility === 'public' || memberOf(store, c.id, actor.userId))
        .map(c => toView(store, c, actor.userId))
        .sort((a, b) => Number(b.isDefault ?? false) - Number(a.isDefault ?? false) || (b.lastMessageAt ?? b.createdAt) - (a.lastMessageAt ?? a.createdAt))
    },

    createChannel(input: CreateTeamChannelInput, actor: TeamChatActor): TeamChannelView {
      const orgId = requireId(input?.orgId, 'orgId')
      requireOrgMember(orgId, actor)
      const kind = input.kind === 'group' ? 'group' : 'channel'
      // Group chats are always private; channels default to public.
      const visibility = kind === 'group' ? 'private' : input.visibility === 'private' ? 'private' : 'public'
      const name = cleanText(input.name, TEAM_CHANNEL_NAME_MAX, 'name')
      const topic = cleanText(input.topic, TEAM_CHANNEL_TOPIC_MAX, 'topic', false)
      const store = load()
      ensureDefault(store, orgId, actor)
      if (kind === 'channel' && store.channels.some(c => c.orgId === orgId && c.kind === 'channel' && !c.archivedAt && c.name.toLowerCase() === name.toLowerCase())) {
        throw new TeamChatError('INVALID', 'A channel with this name already exists')
      }
      const channel: TeamChannel = {
        id: randomUUID(), orgId, kind, visibility, name, ...(topic ? { topic } : {}),
        createdBy: actor.userId, createdAt: now(), lastSeq: 0,
      }
      store.channels.push(channel)
      addMember(store, channel.id, actor.userId, 'owner')
      const orgMembers = new Set(options.orgs.memberIds(orgId))
      for (const userId of Array.isArray(input.memberIds) ? input.memberIds : []) {
        // Only durable org members can be added (external guests come in phase 3 via signed links).
        if (typeof userId === 'string' && orgMembers.has(userId)) addMember(store, channel.id, userId, 'member')
      }
      save(store)
      return toView(store, channel, actor.userId)
    },

    joinChannel(channelIdInput: unknown, actor: TeamChatActor): TeamChannelView {
      const store = load()
      const channel = visibleChannel(store, requireId(channelIdInput, 'channelId'), actor)
      if (channel.archivedAt) throw new TeamChatError('INVALID', 'Channel is archived')
      if (channel.visibility !== 'public') throw new TeamChatError('FORBIDDEN', 'Private channels require an invite')
      addMember(store, channel.id, actor.userId, 'member', channel.lastSeq)
      save(store)
      return toView(store, channel, actor.userId)
    },

    /** Returns the channel's own orgId so callers broadcast to the right org. */
    leaveChannel(channelIdInput: unknown, actor: TeamChatActor): { orgId: string } {
      const store = load()
      const channel = visibleChannel(store, requireId(channelIdInput, 'channelId'), actor)
      if (channel.isDefault) throw new TeamChatError('INVALID', 'The default channel cannot be left')
      store.members = store.members.filter(m => !(m.channelId === channel.id && m.userId === actor.userId))
      if (channel.visibility === 'private') {
        store.subscriptions = store.subscriptions.filter(s => !(s.channelId === channel.id && s.userId === actor.userId))
      }
      // Leaving the channel revokes call access: drop out of the live call.
      const call = activeCallOf(store, channel.id)
      if (call?.participantIds.includes(actor.userId)) {
        call.participantIds = call.participantIds.filter(id => id !== actor.userId)
        if (!call.participantIds.length) endCall(store, channel, call)
      }
      save(store)
      return { orgId: channel.orgId }
    },

    addMembers(channelIdInput: unknown, userIds: unknown, actor: TeamChatActor): TeamChannelView {
      const store = load()
      const channel = visibleChannel(store, requireId(channelIdInput, 'channelId'), actor)
      if (!memberOf(store, channel.id, actor.userId)) throw new TeamChatError('FORBIDDEN', 'Join the channel first')
      const orgMembers = new Set(options.orgs.memberIds(channel.orgId))
      for (const userId of Array.isArray(userIds) ? userIds : []) {
        if (typeof userId === 'string' && orgMembers.has(userId)) addMember(store, channel.id, userId, 'member', 0)
      }
      save(store)
      return toView(store, channel, actor.userId)
    },

    setSubscribed(channelIdInput: unknown, subscribed: unknown, actor: TeamChatActor): TeamChannelView {
      const store = load()
      const channel = visibleChannel(store, requireId(channelIdInput, 'channelId'), actor)
      if (subscribed === true && channel.archivedAt) throw new TeamChatError('INVALID', 'Channel is archived')
      store.subscriptions = store.subscriptions.filter(s => !(s.channelId === channel.id && s.userId === actor.userId))
      if (subscribed === true) store.subscriptions.push({ channelId: channel.id, userId: actor.userId, createdAt: now() })
      save(store)
      return toView(store, channel, actor.userId)
    },

    /** Returns the channel's own orgId so callers broadcast to the right org. */
    archiveChannel(channelIdInput: unknown, actor: TeamChatActor): { orgId: string } {
      const store = load()
      const channel = visibleChannel(store, requireId(channelIdInput, 'channelId'), actor)
      if (channel.isDefault) throw new TeamChatError('INVALID', 'The default channel cannot be archived')
      if (!canManage(store, channel, actor)) throw new TeamChatError('FORBIDDEN', 'Only channel or org admins can archive')
      channel.archivedAt = now()
      const liveCall = activeCallOf(store, channel.id)
      if (liveCall) endCall(store, channel, liveCall)
      save(store)
      return { orgId: channel.orgId }
    },

    listMessages(input: ListTeamMessagesInput, actor: TeamChatActor): { channel: TeamChannelView; messages: TeamChannelMessage[] } {
      const store = load()
      const channel = visibleChannel(store, requireId(input?.channelId, 'channelId'), actor)
      const limit = Math.min(Math.max(1, Number(input.limit) || 50), TEAM_MESSAGES_PAGE_MAX)
      const before = Number.isFinite(input.beforeSeq) ? Number(input.beforeSeq) : Infinity
      const messages = store.messages
        .filter(m => m.channelId === channel.id && m.seq < before && !m.deletedAt)
        .sort((a, b) => a.seq - b.seq)
        .slice(-limit)
      return { channel: toView(store, channel, actor.userId), messages }
    },

    postMessage(channelIdInput: unknown, textInput: unknown, actor: TeamChatActor): TeamChannelMessage {
      return postMessageWithOrg(channelIdInput, textInput, actor).message
    },

    postMessageWithOrg,

    /**
     * Join (or start) the channel's call. Returns the room to connect to; the
     * token is minted by the caller only after this membership check passes.
     */
    joinCall(channelIdInput: unknown, actor: TeamChatActor): { call: TeamChannelCall; orgId: string; started: boolean } {
      const store = load()
      const channel = callChannel(store, channelIdInput, actor)
      store.calls ??= []
      let call = activeCallOf(store, channel.id)
      let started = false
      if (!call) {
        call = { id: randomUUID(), channelId: channel.id, roomName: teamCallRoomName(channel.id), startedBy: actor.userId,
          startedAt: now(), participantIds: [], everParticipantIds: [], transcript: [] }
        store.calls.push(call)
        appendMessage(store, channel, { senderId: actor.userId, kind: 'system', event: 'call.started', callId: call.id, text: 'call.started' })
        started = true
      }
      if (!call.participantIds.includes(actor.userId)) call.participantIds.push(actor.userId)
      if (!call.everParticipantIds.includes(actor.userId)) call.everParticipantIds.push(actor.userId)
      // Keep at most 50 ended calls of history per channel.
      const ended = store.calls.filter(c => c.channelId === channel.id && c.endedAt)
      if (ended.length > 50) {
        const drop = new Set(ended.slice(0, ended.length - 50).map(c => c.id))
        store.calls = store.calls.filter(c => !drop.has(c.id))
      }
      save(store)
      return { call, orgId: channel.orgId, started }
    },

    /** Leave the call; the last participant out ends it and posts the transcript. */
    leaveCall(channelIdInput: unknown, actor: TeamChatActor): { orgId: string; call: TeamChannelCall | null; ended: boolean } {
      const store = load()
      const channel = visibleChannel(store, requireId(channelIdInput, 'channelId'), actor)
      const call = activeCallOf(store, channel.id)
      if (!call) return { orgId: channel.orgId, call: null, ended: false }
      call.participantIds = call.participantIds.filter(id => id !== actor.userId)
      const ended = call.participantIds.length === 0
      if (ended) endCall(store, channel, call)
      save(store)
      return { orgId: channel.orgId, call, ended }
    },

    /** Replace the live participant list from the LiveKit room roster (members only). */
    syncCallParticipants(channelIdInput: unknown, participantIds: unknown, actor: TeamChatActor): { orgId: string; call: TeamChannelCall | null } {
      const store = load()
      const channel = callChannel(store, channelIdInput, actor)
      const call = activeCallOf(store, channel.id)
      if (!call || !Array.isArray(participantIds)) return { orgId: channel.orgId, call: call ?? null }
      // Client must only call this after ParticipantDisconnected with the remaining room ids.
      // Sync never adds anyone (joinCall is the only admission); a partial roster would
      // otherwise drop peers who joinCall'd but are not yet visible to this client.
      const seen = new Set(participantIds.filter((id): id is string => typeof id === 'string'))
      if (!call.participantIds.includes(actor.userId)) return { orgId: channel.orgId, call }
      const ids = call.participantIds.filter(id => id === actor.userId || seen.has(id))
      call.participantIds = ids
      save(store)
      return { orgId: channel.orgId, call }
    },

    /** Add final transcript segments (from the LiveKit transcriber) to the active call. */
    appendCallTranscript(channelIdInput: unknown, callIdInput: unknown, segmentsInput: unknown, actor: TeamChatActor): { orgId: string; added: number } {
      const store = load()
      const channel = callChannel(store, channelIdInput, actor)
      const callId = requireId(callIdInput, 'callId')
      const call = (store.calls ?? []).find(c => c.id === callId && c.channelId === channel.id)
      if (!call) throw new TeamChatError('NOT_FOUND', 'Call not found')
      if (call.endedAt) throw new TeamChatError('INVALID', 'Call has ended')
      // Only people who joined this call may add to its transcript (late chunks after leaving are fine).
      if (!call.everParticipantIds.includes(actor.userId)) throw new TeamChatError('FORBIDDEN', 'Not in this call')
      const maxMs = Math.max(0, now() - call.startedAt) + 60_000
      const segments = (Array.isArray(segmentsInput) ? segmentsInput : []).slice(0, 500)
        .map(v => cleanSegment(v, actor.userId)).filter((v): v is TeamCallTranscriptSegment => !!v)
        // Each participant transcribes only their own microphone: no speaking for others.
        .map(v => ({ ...v, speakerId: actor.userId }))
        .filter(v => v.startMs <= maxMs)
        .map(v => ({ ...v, endMs: Math.min(v.endMs, maxMs) }))
      // Idempotent: the same segment can arrive from several windows.
      const key = (s: TeamCallTranscriptSegment) => `${s.speakerId}|${s.startMs}|${s.text}`
      const seen = new Set(call.transcript.map(key))
      let added = 0
      for (const seg of segments) {
        if (call.transcript.length >= TEAM_TRANSCRIPT_SEGMENTS_MAX) break
        if (seen.has(key(seg))) continue
        seen.add(key(seg)); call.transcript.push(seg); added++
      }
      if (added) save(store)
      return { orgId: channel.orgId, added }
    },

    /** Host-internal: post the AI summary for an ended call (no actor; once). Returns false if already posted. */
    postCallSummaryAsSystem(channelIdInput: unknown, callIdInput: unknown, summaryInput: unknown): boolean {
      const store = load()
      const channelId = requireId(channelIdInput, 'channelId')
      const channel = store.channels.find(c => c.id === channelId)
      if (!channel || channel.archivedAt) return false
      const call = (store.calls ?? []).find(c => c.id === requireId(callIdInput, 'callId') && c.channelId === channel.id)
      if (!call || !call.endedAt || call.summaryMessageId) return false
      const text = cleanText(summaryInput, TEAM_SUMMARY_MAX, 'summary')
      call.summaryMessageId = appendMessage(store, channel, { senderId: 'system', kind: 'summary', callId: call.id, text }).id
      save(store)
      return true
    },

    /**
     * Authoritative end from LiveKit `room_finished` (last leave RPC lost / empty timeout).
     * Idempotent: a second call for an already-ended room is a no-op.
     * No actor — LiveKit is the authority after JWT verification upstream.
     */
    endCallByRoomName(roomNameInput: unknown): { orgId: string; channelId: string; call: TeamChannelCall | null; ended: boolean } {
      const roomName = cleanText(roomNameInput, 200, 'roomName')
      const store = load()
      const hit = activeCallByRoomName(store, roomName)
      if (!hit) {
        // Already ended (or unknown room): surface the latest matching call if any.
        const ended = (store.calls ?? []).filter(c => c.roomName === roomName && c.endedAt).sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))[0]
        const channel = ended ? store.channels.find(c => c.id === ended.channelId) : undefined
        return { orgId: channel?.orgId ?? '', channelId: channel?.id ?? '', call: ended ?? null, ended: false }
      }
      endCall(store, hit.channel, hit.call)
      save(store)
      return { orgId: hit.channel.orgId, channelId: hit.channel.id, call: hit.call, ended: true }
    },

    /**
     * LiveKit `participant_left`: drop that identity from the live roster.
     * When the roster is empty, end the call (faster than waiting for room_finished).
     * Idempotent for unknown rooms / already-left identities.
     */
    applyLiveKitParticipantLeft(roomNameInput: unknown, identityInput: unknown): { orgId: string; channelId: string; call: TeamChannelCall | null; ended: boolean } {
      const roomName = cleanText(roomNameInput, 200, 'roomName')
      const identity = requireId(identityInput, 'identity')
      const store = load()
      const hit = activeCallByRoomName(store, roomName)
      if (!hit) {
        const ended = (store.calls ?? []).filter(c => c.roomName === roomName && c.endedAt).sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))[0]
        const channel = ended ? store.channels.find(c => c.id === ended.channelId) : undefined
        return { orgId: channel?.orgId ?? '', channelId: channel?.id ?? '', call: ended ?? null, ended: false }
      }
      const before = hit.call.participantIds.length
      hit.call.participantIds = hit.call.participantIds.filter(id => id !== identity)
      if (hit.call.participantIds.length === before) {
        // Identity was not on our roster (never joinCall'd, or already left via RPC) — leave state as-is.
        return { orgId: hit.channel.orgId, channelId: hit.channel.id, call: hit.call, ended: false }
      }
      const ended = hit.call.participantIds.length === 0
      if (ended) endCall(store, hit.channel, hit.call)
      save(store)
      return { orgId: hit.channel.orgId, channelId: hit.channel.id, call: hit.call, ended }
    },

    /** Calls of a channel, newest first (visible channels only). */
    listCalls(channelIdInput: unknown, actor: TeamChatActor): TeamChannelCall[] {
      const store = load()
      const channel = visibleChannel(store, requireId(channelIdInput, 'channelId'), actor)
      return (store.calls ?? []).filter(c => c.channelId === channel.id).sort((a, b) => b.startedAt - a.startedAt).map(callDto)
    },

    /** Case-insensitive search over messages, transcripts and summaries in the actor's visible channels. */
    searchMessages(orgIdInput: unknown, queryInput: unknown, actor: TeamChatActor): TeamChannelMessage[] {
      const orgId = requireId(orgIdInput, 'orgId')
      requireOrgMember(orgId, actor)
      const q = cleanText(queryInput, 200, 'query').toLowerCase()
      const store = load()
      const visible = new Set(store.channels
        .filter(c => c.orgId === orgId && (c.visibility === 'public' || memberOf(store, c.id, actor.userId)))
        .map(c => c.id))
      return store.messages
        .filter(m => visible.has(m.channelId) && !m.deletedAt && m.kind !== 'system' && m.text.toLowerCase().includes(q))
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 100)
    },

    markRead(channelIdInput: unknown, actor: TeamChatActor): void {
      const store = load()
      const channel = visibleChannel(store, requireId(channelIdInput, 'channelId'), actor)
      const member = memberOf(store, channel.id, actor.userId)
      if (!member || member.lastReadSeq === channel.lastSeq) return
      member.lastReadSeq = channel.lastSeq
      save(store)
    },
  }
}

export type TeamChatStore = ReturnType<typeof createTeamChatStore>

let defaultStore: TeamChatStore | null = null

/** Host store wired to CONFIG_DIR and the local org directory (orgs.json). */
export function getTeamChatStore(orgs: TeamChatOrgDirectory): TeamChatStore {
  defaultStore ??= createTeamChatStore({ path: join(resolveConfigDir(), 'team-chat.json'), orgs })
  return defaultStore
}
