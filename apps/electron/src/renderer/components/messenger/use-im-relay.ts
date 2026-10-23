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
    // Pair exactly one unsub per successful subscribe bump (shared ImService refcount).
    // If cleanup runs before settle, only .then releases; if after, only cleanup releases.
    let cancelled = false
    let bumped = false
    let released = false
    const release = () => {
      if (released) return
      released = true
      void window.electronAPI.imUnsubscribeChannel?.(channelId).catch(() => {})
    }
    void window.electronAPI.imSubscribeChannel(channelId).then(() => {
      bumped = true
      if (cancelled) release()
    }).catch(() => {})
    return () => {
      cancelled = true
      if (bumped) release()
    }
  }, [channelId, live])
}


/**
 * After `imSubscribeChannel` resolves: keep the native sub only if this hook
 * still desires the id (active is claimed only after settle).
 */
export function keepSubscriptionAfterResolve(
  id: string,
  desired: ReadonlySet<string>,
  active: ReadonlySet<string>,
): boolean {
  return desired.has(id) && active.has(id)
}

/**
 * Late-resolve disposition for a multi-hook subscribe attempt.
 * `pendingGen === attemptGen` → attempt still owns the in-flight slot (activate).
 * Otherwise the effect already cancelled/superseded it → unsubscribe once to
 * release the bump (effect must NOT have unsubscribed a still-pending attempt).
 */
export function lateSubscribeDisposition(
  attemptGen: number,
  pendingGen: number | undefined,
): 'activate' | 'unsubscribe' {
  return pendingGen === attemptGen ? 'activate' : 'unsubscribe'
}

/**
 * Pure followed-channel sync step over **settled** active ids only.
 * `live=false` clears active (unsubscribe all) but does **not** empty desired —
 * caller keeps desired so a later `live=true` without desiredKey change still
 * subscribes. Subscribe candidates are returned without optimistic active.add;
 * the hook tracks pending attempts and claims active only after resolve.
 */
export function nextSubscriptionActions(
  desiredIds: readonly string[],
  activeIds: ReadonlySet<string>,
  live: boolean,
): { subscribe: string[]; unsubscribe: string[]; nextActive: Set<string> } {
  const desired = new Set(desiredIds.filter(Boolean))
  if (!live) {
    return { subscribe: [], unsubscribe: [...activeIds], nextActive: new Set() }
  }
  const nextActive = new Set(activeIds)
  const subscribe: string[] = []
  const unsubscribe: string[] = []
  for (const id of [...nextActive]) {
    if (desired.has(id)) continue
    nextActive.delete(id)
    unsubscribe.push(id)
  }
  for (const id of desired) {
    if (nextActive.has(id)) continue
    subscribe.push(id)
  }
  return { subscribe, unsubscribe, nextActive }
}

/**
 * Subscribe the native client to many channels (e.g. followed Лента channels).
 * Incremental sync: only subscribe newly added ids and unsubscribe removed ones.
 * desiredRef tracks roster intent even while offline; live only gates wire I/O.
 * In-flight attempts use a per-id generation: cancel clears pending without
 * unsub; .then releases the bump once so shared refcount is not double-decremented.
 */
export function useImChannelSubscriptions(channelIds: readonly string[], live: boolean): void {
  const desiredKey = [...new Set(channelIds.filter(Boolean))].sort().join('\0')
  const activeRef = React.useRef(new Set<string>())
  const desiredRef = React.useRef(new Set<string>())
  /** In-flight subscribe attempts: id → generation. Cancel by deleting the entry. */
  const pendingRef = React.useRef(new Map<string, number>())
  const attemptGenRef = React.useRef(0)

  React.useEffect(() => {
    const desiredIds = desiredKey ? desiredKey.split('\0') : []
    // Always keep desired in sync with the roster key (including while !live).
    desiredRef.current = new Set(desiredIds)

    const canWire = live && Boolean(window.electronAPI?.imSubscribeChannel)
    const { subscribe, unsubscribe, nextActive } = nextSubscriptionActions(
      desiredIds,
      activeRef.current,
      canWire,
    )
    activeRef.current = nextActive

    // Settled actives no longer desired: one unsub each (owns a bump).
    for (const id of unsubscribe) {
      void window.electronAPI?.imUnsubscribeChannel?.(id).catch(() => {})
    }

    // Cancel in-flight attempts no longer desired — do NOT unsub here; the
    // attempt's .then releases the bump once (avoids shared-refcount -2).
    for (const id of [...pendingRef.current.keys()]) {
      if (desiredRef.current.has(id)) continue
      pendingRef.current.delete(id)
    }

    if (!canWire) {
      // live=false / no API: invalidate all pending (then compensates) — actives
      // already cleared+unsubscribed via nextSubscriptionActions above.
      pendingRef.current.clear()
      return
    }

    for (const id of subscribe) {
      if (pendingRef.current.has(id) || activeRef.current.has(id)) continue
      const gen = ++attemptGenRef.current
      pendingRef.current.set(id, gen)
      void window.electronAPI.imSubscribeChannel(id).then(() => {
        const disposition = lateSubscribeDisposition(gen, pendingRef.current.get(id))
        if (disposition === 'unsubscribe') {
          // Cancelled/superseded while in-flight — release this attempt's bump only.
          void window.electronAPI.imUnsubscribeChannel?.(id).catch(() => {})
          return
        }
        pendingRef.current.delete(id)
        if (!desiredRef.current.has(id)) {
          void window.electronAPI.imUnsubscribeChannel?.(id).catch(() => {})
          return
        }
        activeRef.current.add(id)
      }).catch(() => {
        if (pendingRef.current.get(id) === gen) pendingRef.current.delete(id)
      })
    }
  }, [desiredKey, live])

  // Unmount: invalidate pending (then releases bumps) + unsub settled actives.
  React.useEffect(() => {
    return () => {
      pendingRef.current.clear()
      const prev = [...activeRef.current]
      activeRef.current.clear()
      desiredRef.current = new Set()
      for (const id of prev) {
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
