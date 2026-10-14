/**
 * Team messenger data hooks over teamChat:* RPC. Real host data only: the
 * server filters by org membership and private-channel membership, and
 * teamChat:changed (ids only) triggers a refetch.
 */
import * as React from 'react'
import type { TeamChannelMessage, TeamChannelView } from '@rox/shared/team-chat'

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
  const [state, setState] = React.useState<{ loading: boolean; messages: TeamChannelMessage[]; error: string | null }>({ loading: false, messages: [], error: null })
  const version = React.useRef(0)

  const reload = React.useCallback(async () => {
    if (!channelId) { setState({ loading: false, messages: [], error: null }); return }
    const v = ++version.current
    try {
      const result = await window.electronAPI.teamChatListMessages({ channelId, limit: 200 })
      if (v !== version.current) return
      setState({ loading: false, messages: result.messages, error: null })
      if (result.channel.viewerRole && result.channel.unreadCount > 0) void window.electronAPI.teamChatMarkRead(channelId).catch(() => {})
    } catch (error) {
      if (v === version.current) setState({ loading: false, messages: [], error: errorText(error) })
    }
  }, [channelId])

  React.useEffect(() => {
    setState({ loading: Boolean(channelId), messages: [], error: null })
    void reload()
    const off = window.electronAPI.onTeamChatChanged?.((change) => {
      if (change?.channelId === channelId) void reload()
    })
    return () => { version.current++; off?.() }
  }, [channelId, reload])

  return { ...state, reload }
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

export { errorText as teamChatErrorText }
