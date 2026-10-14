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
