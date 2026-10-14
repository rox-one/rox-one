/**
 * Team messenger (Slack-like channels) — phase 1 data model.
 * Host-side store scoped by organization; see plans/messenger-channels.
 */

/** `channel` = topic room (public or private); `group` = ad-hoc private group chat. */
export type TeamChannelKind = 'channel' | 'group'
export type TeamChannelVisibility = 'public' | 'private'
export type TeamChannelRole = 'owner' | 'admin' | 'member'

export interface TeamChannel {
  id: string
  orgId: string
  kind: TeamChannelKind
  visibility: TeamChannelVisibility
  name: string
  topic?: string
  /** The org-wide default room every member belongs to; cannot be left or archived. */
  isDefault?: boolean
  createdBy: string
  createdAt: number
  archivedAt?: number
  lastSeq: number
  lastMessageAt?: number
}

export interface TeamChannelMember {
  channelId: string
  userId: string
  role: TeamChannelRole
  joinedAt: number
  lastReadSeq: number
}

/** Follow a public channel's activity in Лента without joining it. Members may also subscribe. */
export interface TeamChannelSubscription {
  channelId: string
  userId: string
  createdAt: number
}

export interface TeamChannelMessage {
  id: string
  channelId: string
  seq: number
  senderId: string
  text: string
  createdAt: number
  editedAt?: number
  deletedAt?: number
}

export interface TeamChatStoreFile {
  version: 1
  channels: TeamChannel[]
  members: TeamChannelMember[]
  subscriptions: TeamChannelSubscription[]
  messages: TeamChannelMessage[]
}

/** Viewer-shaped channel DTO. Private channels are listed only to members. */
export interface TeamChannelView extends TeamChannel {
  memberCount: number
  memberIds: string[]
  viewerRole?: TeamChannelRole
  viewerSubscribed: boolean
  unreadCount: number
}

export interface CreateTeamChannelInput {
  orgId: string
  name: string
  kind?: TeamChannelKind
  visibility?: TeamChannelVisibility
  topic?: string
  memberIds?: string[]
}

export interface TeamChatActor {
  userId: string
}

export interface ListTeamMessagesInput {
  channelId: string
  beforeSeq?: number
  limit?: number
}
