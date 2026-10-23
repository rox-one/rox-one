/**
 * Team messenger data hooks. Channel roster stays on teamChat:* (org store).
 * Message list/send prefer native im:* when the relay reports live; otherwise
 * fall back to the JSON team-chat store (eu-swiss offline / no native addon).
 *
 * Own sends dual-write via teamChatIngest (preserves relay id + senderId).
 * Inbound im:message also ingests with the remote sender — never teamChatPost
 * (which would stamp actor.userId).
 */
import * as React from 'react'
import type { IngestTeamMessageInput, PostTeamMessageOptions, TeamChannelMessage, TeamChannelView, TeamMessageAttachment } from '@rox/shared/team-chat'
import type { ImMessageEvent } from '@rox/shared/protocol'
import { imMessageToTeam, imMessagesToTeam, mergeLocalEnrichments } from './im-message-map'
import { useImChannelSubscription, useImMessageListener, useImRelay } from './use-im-relay'
import { recordMessengerFeedItem } from '@/platform/messenger-feed-items'
import { listMessengerFeedChannels } from '@/platform/messenger-feed-channels'

function errorText(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  // Strip transport prefixes ("Error invoking remote method '…': Error: …").
  return raw.replace(/^.*?Error:\s*/s, '').trim() || raw
}

function fanOutIfFollowed(message: TeamChannelMessage, channelName?: string): void {
  const followed = listMessengerFeedChannels().some((c) => c.channelId === message.channelId)
  if (!followed) return
  recordMessengerFeedItem({
    channelId: message.channelId,
    messageId: message.id,
    senderId: message.senderId,
    text: message.text,
    at: message.createdAt,
    channelName,
  })
}

export function useTeamChannels(orgId: string | null) {
  const [state, setState] = React.useState<{ loading: boolean; channels: TeamChannelView[]; error: string | null }>({ loading: true, channels: [], error: null })
  const version = React.useRef(0)

  const reload = React.useCallback(async () => {
    if (!orgId) { setState({ loading: false, channels: [], error: null }); return }
    const v = ++version.current
    try {
      const channels = await window.electronAPI.teamChatListChannels(orgId)
      if (v === version.current) setState({ loading: false, channels: Array.isArray(channels) ? channels : [], error: null })
    } catch (error) {
      if (v === version.current) setState(prev => ({ ...prev, loading: false, error: errorText(error) }))
    }
  }, [orgId])

  React.useEffect(() => {
    void reload()
    const off = window.electronAPI.onTeamChatChanged?.((change) => {
      if (change?.orgId === orgId) void reload()
    })
    return () => { version.current++; off?.() }
  }, [orgId, reload])

  return { ...state, reload }
}

export function useTeamMessages(channelId: string | null) {
  const { live, status } = useImRelay()
  const [state, setState] = React.useState<{ loading: boolean; messages: TeamChannelMessage[]; error: string | null }>({ loading: false, messages: [], error: null })
  const version = React.useRef(0)

  useImChannelSubscription(channelId, live)

  const reload = React.useCallback(async () => {
    if (!channelId) { setState({ loading: false, messages: [], error: null }); return }
    const v = ++version.current
    try {
      if (live && window.electronAPI.imListMessages) {
        try {
          const result = await window.electronAPI.imListMessages({ channelId, limit: 200 })
          if (v !== version.current) return
          if (result.ok) {
            let messages = imMessagesToTeam(result.messages)
            // Overlay local dual-write enrichments (reply/thread/attachments) by id.
            try {
              const local = await window.electronAPI.teamChatListMessages({ channelId, limit: 200 })
              if (v !== version.current) return
              messages = mergeLocalEnrichments(messages, local.messages)
            } catch {
              // Local store optional — show pure im list if team-chat read fails.
            }
            setState({ loading: false, messages, error: null })
            void window.electronAPI.imMarkRead?.(channelId).catch(() => {})
            // Keep team-chat unread badges in sync while viewing live (ingest bumps lastSeq).
            void window.electronAPI.teamChatMarkRead?.(channelId).catch(() => {})
            return
          }
          // ok:false → fall through to team-chat store
        } catch {
          // imListMessages threw → same as ok:false; keep thread via team-chat
        }
      }
      const result = await window.electronAPI.teamChatListMessages({ channelId, limit: 200 })
      if (v !== version.current) return
      setState({ loading: false, messages: result.messages, error: null })
      if (result.channel.viewerRole && result.channel.unreadCount > 0) void window.electronAPI.teamChatMarkRead(channelId).catch(() => {})
    } catch (error) {
      if (v === version.current) setState({ loading: false, messages: [], error: errorText(error) })
    }
  }, [channelId, live])

  React.useEffect(() => {
    setState({ loading: Boolean(channelId), messages: [], error: null })
    void reload()
    const off = window.electronAPI.onTeamChatChanged?.((change) => {
      if (change?.channelId === channelId) void reload()
    })
    return () => { version.current++; off?.() }
  }, [channelId, reload])

  // Inbound im:message — UI + sender-preserving ingest (never teamChatPost).
  useImMessageListener(channelId, live, (message: ImMessageEvent) => {
    setState((prev) => {
      if (prev.messages.some((m) => m.id === message.id)) return prev
      const seq = (prev.messages.at(-1)?.seq ?? 0) + 1
      return { ...prev, messages: [...prev.messages, imMessageToTeam(message, seq)] }
    })
    if (!window.electronAPI.teamChatIngest) return
    const input: IngestTeamMessageInput = {
      channelId: message.channelId,
      senderId: message.senderId,
      text: message.text,
      id: message.id,
      createdAt: message.createdAt,
      ...(message.replyToId ? { replyToId: message.replyToId, threadId: message.threadId ?? message.replyToId } : {}),
    }
    void window.electronAPI.teamChatIngest(input).then((stored) => {
      fanOutIfFollowed(stored)
    }).catch(() => {
      // Local durability is best-effort; UI already shows the push.
    })
  })

  return { ...state, reload, relay: status, live }
}

/**
 * Debounced search: prefer im:* (chat-core FTS) when live; else team-chat store.
 */
export function useTeamSearch(orgId: string | null, query: string) {
  const { live } = useImRelay()
  const [state, setState] = React.useState<{ loading: boolean; results: TeamChannelMessage[]; error: string | null }>({ loading: false, results: [], error: null })
  React.useEffect(() => {
    const q = query.trim()
    if (!orgId || q.length < 2) { setState({ loading: false, results: [], error: null }); return }
    let alive = true
    setState(prev => ({ ...prev, loading: true }))
    const id = setTimeout(() => {
      void (async () => {
        try {
          if (live && window.electronAPI.imSearchMessages) {
            try {
              const result = await window.electronAPI.imSearchMessages(q, { limit: 50 })
              if (!alive) return
              if (result.ok) {
                setState({ loading: false, results: imMessagesToTeam(result.messages), error: null })
                return
              }
            } catch {
              // fall through
            }
          }
          const results = await window.electronAPI.teamChatSearch(orgId, q)
          if (alive) setState({ loading: false, results, error: null })
        } catch (error) {
          if (alive) setState({ loading: false, results: [], error: errorText(error) })
        }
      })()
    }, 200)
    return () => { alive = false; clearTimeout(id) }
  }, [orgId, query, live])
  return state
}

export interface PostTeamMessageInput extends PostTeamMessageOptions {
  /** Used when im send returns a MessageRef without senderId. */
  selfUserId?: string
  channelName?: string
}

/**
 * Post via im:* when live, then dual-write via teamChatIngest (preserve id/sender).
 * imSendMessage throw / ok:false falls through to teamChatPost alone.
 */
export async function postTeamMessage(
  channelId: string,
  text: string,
  live: boolean,
  opts: PostTeamMessageInput = {},
): Promise<TeamChannelMessage | void> {
  const postOpts: PostTeamMessageOptions = {}
  if (opts.replyToId) postOpts.replyToId = opts.replyToId
  if (opts.threadId) postOpts.threadId = opts.threadId
  if (opts.attachments) postOpts.attachments = opts.attachments

  if (live && window.electronAPI.imSendMessage) {
    try {
      const result = await window.electronAPI.imSendMessage(channelId, text)
      if (result.ok) {
        const msg = result.message
        const senderId =
          msg.senderId && msg.senderId !== 'self'
            ? msg.senderId
            : (opts.selfUserId || '')
        if (window.electronAPI.teamChatIngest && senderId) {
          try {
            const stored = await window.electronAPI.teamChatIngest({
              channelId,
              senderId,
              text: msg.text || text,
              id: msg.id,
              createdAt: msg.createdAt,
              ...postOpts,
              ...(msg.replyToId ? { replyToId: msg.replyToId, threadId: msg.threadId ?? msg.replyToId } : {}),
            })
            fanOutIfFollowed(stored, opts.channelName)
            return stored
          } catch {
            // im already delivered; local durability is best-effort
          }
        } else {
          // No trustworthy remote sender — fall through to actor-stamped post.
          try {
            const stored = await window.electronAPI.teamChatPost(channelId, text, Object.keys(postOpts).length ? postOpts : undefined)
            fanOutIfFollowed(stored, opts.channelName)
            return stored
          } catch {
            return
          }
        }
        return
      }
    } catch {
      // fall through to team-chat
    }
  }
  const stored = await window.electronAPI.teamChatPost(channelId, text, Object.keys(postOpts).length ? postOpts : undefined)
  fanOutIfFollowed(stored, opts.channelName)
  return stored
}

export { errorText as teamChatErrorText }
export type { TeamMessageAttachment }
