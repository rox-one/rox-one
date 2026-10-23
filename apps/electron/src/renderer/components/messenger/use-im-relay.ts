/**
 * Live native chat-core path (`im:*`) for the messenger surface.
 *
 * Probes `imStatus` on mount and mirrors `onImStatusChanged`. When
 * `mode === 'native'` and `available`, list/send/markRead/subscribe go through
 * im IPC; otherwise callers keep using teamChat:* (JSON store). Offline /
 * reconnecting statuses stay visible so the UI tolerates eu-swiss downtime.
 */
import * as React from 'react'
import type { ImMessageEvent, ImStatusEvent } from '@rox/shared/protocol'

export type ImRelayMode = ImStatusEvent['mode']

export interface ImRelayState {
  status: ImStatusEvent
  /** True when list/send should prefer im:* over teamChat:*. */
  live: boolean
}

const FALLBACK: ImStatusEvent = { available: false, mode: 'fallback', reason: 'not-started' }

export function useImRelay(): ImRelayState {
  const [status, setStatus] = React.useState<ImStatusEvent>(FALLBACK)

  React.useEffect(() => {
    let cancelled = false
    const api = window.electronAPI
    if (!api?.imStatus) {
      setStatus({ available: false, mode: 'fallback', reason: 'not-configured' })
      return
    }
    void api.imStatus().then((next) => {
      if (!cancelled && next) setStatus(next)
    }).catch(() => {
      if (!cancelled) setStatus({ available: false, mode: 'fallback', reason: 'start-failed' })
    })
    const off = api.onImStatusChanged?.((next) => {
      if (next) setStatus(next)
    })
    return () => {
      cancelled = true
      off?.()
    }
  }, [])

  const live = status.mode === 'native' && status.available
  return { status, live }
}

/**
 * Subscribe the native client to a channel while the surface is open.
 * If subscribe resolves after unmount / channel switch, immediately unsubscribe
 * so a late resolve cannot leave a stale subscription.
 */
export function useImChannelSubscription(channelId: string | null, live: boolean): void {
  React.useEffect(() => {
    if (!live || !channelId || !window.electronAPI?.imSubscribeChannel) return
    let cancelled = false
    void window.electronAPI.imSubscribeChannel(channelId).then(() => {
      if (cancelled) {
        void window.electronAPI.imUnsubscribeChannel?.(channelId).catch(() => {})
      }
    }).catch(() => {})
    return () => {
      cancelled = true
      void window.electronAPI.imUnsubscribeChannel?.(channelId).catch(() => {})
    }
  }, [channelId, live])
}


/**
 * Subscribe the native client to many channels (e.g. followed Лента channels).
 * Incremental sync: only subscribe newly added ids and unsubscribe removed ones.
 * Selection / open-channel churn must not tear down unchanged followed subs.
 */
export function useImChannelSubscriptions(channelIds: readonly string[], live: boolean): void {
  const desiredKey = [...new Set(channelIds.filter(Boolean))].sort().join('\0')
  const activeRef = React.useRef(new Set<string>())

  React.useEffect(() => {
    if (!live || !window.electronAPI?.imSubscribeChannel) {
      // Going offline / unavailable: drop tracked set without wire churn if no API.
      const prev = activeRef.current
      activeRef.current = new Set()
      if (window.electronAPI?.imUnsubscribeChannel) {
        for (const id of prev) {
          void window.electronAPI.imUnsubscribeChannel(id).catch(() => {})
        }
      }
      return
    }
    const desired = new Set(desiredKey ? desiredKey.split('\0') : [])
    const active = activeRef.current
    for (const id of desired) {
      if (active.has(id)) continue
      active.add(id)
      void window.electronAPI.imSubscribeChannel(id).catch(() => {
        active.delete(id)
      })
    }
    for (const id of [...active]) {
      if (desired.has(id)) continue
      active.delete(id)
      void window.electronAPI.imUnsubscribeChannel?.(id).catch(() => {})
    }
  }, [desiredKey, live])

  // Unmount: unsubscribe everything this hook still owns.
  React.useEffect(() => {
    return () => {
      const active = activeRef.current
      activeRef.current = new Set()
      for (const id of active) {
        void window.electronAPI.imUnsubscribeChannel?.(id).catch(() => {})
      }
    }
  }, [])
}

export type ImMessageListener = (message: ImMessageEvent) => void

/** Forward `im:message` pushes for one channel (no-op when not live). */
export function useImMessageListener(channelId: string | null, live: boolean, onMessage: ImMessageListener): void {
  const cb = React.useRef(onMessage)
  cb.current = onMessage
  React.useEffect(() => {
    if (!live || !channelId || !window.electronAPI?.onImMessage) return
    return window.electronAPI.onImMessage((message) => {
      if (message?.channelId === channelId) cb.current(message)
    })
  }, [channelId, live])
}
