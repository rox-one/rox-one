/**
 * Team messenger data hooks. Channel roster stays on teamChat:* (org store).
 * Message list/send prefer native im:* when the relay reports live; otherwise
 * fall back to the JSON team-chat store (eu-swiss offline / no native addon).
 */
import * as React from 'react'
import type { TeamChannelMessage, TeamChannelView } from '@rox/shared/team-chat'
import type { ImMessageEvent } from '@rox/shared/protocol'
import { imMessageToTeam, imMessagesToTeam } from './im-message-map'
import { useImChannelSubscription, useImMessageListener, useImRelay } from './use-im-relay'

function errorText(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  // Strip transport prefixes ("Error invoking remote method '…': Error: …").
  return raw.replace(/^.*?Error:\s*/s, '').trim() || raw
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
        const result = await window.electronAPI.imListMessages({ channelId, limit: 200 })
        if (v !== version.current) return
        if (result.ok) {
          const messages = imMessagesToTeam(result.messages)
          setState({ loading: false, messages, error: null })
          void window.electronAPI.imMarkRead?.(channelId).catch(() => {})
          return
        }
        // ok:false → fall through to team-chat store
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

  useImMessageListener(channelId, live, (message: ImMessageEvent) => {
    setState((prev) => {
      if (prev.messages.some((m) => m.id === message.id)) return prev
      const seq = (prev.messages.at(-1)?.seq ?? 0) + 1
      return { ...prev, messages: [...prev.messages, imMessageToTeam(message, seq)] }
    })
  })

  return { ...state, reload, relay: status, live }
}

/** Debounced search over messages, transcripts and AI summaries in visible channels. */
export function useTeamSearch(orgId: string | null, query: string) {
  const [state, setState] = React.useState<{ loading: boolean; results: TeamChannelMessage[]; error: string | null }>({ loading: false, results: [], error: null })
  React.useEffect(() => {
    const q = query.trim()
    if (!orgId || q.length < 2) { setState({ loading: false, results: [], error: null }); return }
    let live = true
    setState(prev => ({ ...prev, loading: true }))
    const id = setTimeout(() => {
      window.electronAPI.teamChatSearch(orgId, q)
        .then(results => { if (live) setState({ loading: false, results, error: null }) })
        .catch(error => { if (live) setState({ loading: false, results: [], error: errorText(error) }) })
    }, 200)
    return () => { live = false; clearTimeout(id) }
  }, [orgId, query])
  return state
}

/** Post via im:* when live; always keep team-chat as durable fallback. */
export async function postTeamMessage(channelId: string, text: string, live: boolean): Promise<void> {
  if (live && window.electronAPI.imSendMessage) {
    const result = await window.electronAPI.imSendMessage(channelId, text)
    if (result.ok) return
  }
  await window.electronAPI.teamChatPost(channelId, text)
}

export { errorText as teamChatErrorText }
