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

/** `text` = user message; `system` = call started/ended; `transcript` / `summary` = call outputs. */
export type TeamChannelMessageKind = 'text' | 'system' | 'transcript' | 'summary'

/** Local or media attachment on a messenger message (MinIO may be down). */
export interface TeamMessageAttachment {
  id: string
  name: string
  mimeType?: string
  size?: number
  /** Present when media upload succeeded; absent when pending/unavailable. */
  url?: string
  status?: 'ready' | 'pending' | 'unavailable'
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
  /** Absent on phase-1 messages (= `text`). */
  kind?: TeamChannelMessageKind
  /** Call this message belongs to (system / transcript / summary). */
  callId?: string
  /** `system` messages: machine-readable event; the UI localizes it. */
  event?: 'call.started' | 'call.ended'
  /** Parent message id when this is a thread reply (Slack-like). */
  replyToId?: string
  /** Root message id of the thread (equals replyToId for first-level replies). */
  threadId?: string
  /** File/media attachments; empty when none. */
  attachments?: TeamMessageAttachment[]
}

/**
 * Ingest a remote (or own-send dual-write) message while preserving `senderId`.
 * Unlike postMessage, never stamps the local actor as the author.
 */
export interface IngestTeamMessageInput {
  channelId: string
  senderId: string
  text: string
  /** Remote/relay id — used for idempotency when present. */
  id?: string
  createdAt?: number
  kind?: TeamChannelMessageKind
  replyToId?: string
  threadId?: string
  attachments?: TeamMessageAttachment[]
}

/** Optional fields for a local actor post (own send). */
export interface PostTeamMessageOptions {
  replyToId?: string
  threadId?: string
  attachments?: TeamMessageAttachment[]
}

export interface TeamCallTranscriptSegment {
  /** LiveKit participant identity (= Rox user id). */
  speakerId: string
  speakerName?: string
  text: string
  /** ms since call start. */
  startMs: number
  endMs: number
}

/** A LiveKit call bound to one channel or group chat (room = `rox-ch-<channelId>`, see teamCallRoomName). */
export interface TeamChannelCall {
  id: string
  channelId: string
  roomName: string
  startedBy: string
  startedAt: number
  endedAt?: number
  /** Users currently in the call, as known to this host. */
  participantIds: string[]
  /** Every user who joined at any point. */
  everParticipantIds: string[]
  /** Live transcript accumulated during the call; folded into a message at the end. */
  transcript: TeamCallTranscriptSegment[]
  transcriptMessageId?: string
  summaryMessageId?: string
  /** DTO only: number of live transcript segments held by the host (`transcript` is not sent to clients). */
  transcriptSegments?: number
}

export interface TeamChatStoreFile {
  version: 1
  channels: TeamChannel[]
  members: TeamChannelMember[]
  subscriptions: TeamChannelSubscription[]
  messages: TeamChannelMessage[]
  /** Added with calls; absent in phase-1 files. */
  calls?: TeamChannelCall[]
}

/** Viewer-shaped channel DTO. Private channels are listed only to members. */
export interface TeamChannelView extends TeamChannel {
  memberCount: number
  memberIds: string[]
  viewerRole?: TeamChannelRole
  viewerSubscribed: boolean
  unreadCount: number
  /** The live call in this channel, if any. */
  activeCall?: TeamChannelCall
  /** Retained, non-deleted, non-system messages in the channel (visible to the viewer). */
  messageCount?: number
  /** Latest visible message, for the channel list preview (text clipped to 140 chars). */
  lastMessage?: { senderId: string; text: string; kind?: TeamChannelMessageKind; event?: TeamChannelMessage['event']; createdAt: number }
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
