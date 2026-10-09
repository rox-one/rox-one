/**
 * useSessionPresence — live collaboration hooks for the chat surface (a2.1–a2.4).
 *
 * Reads the ephemeral activity map (populated by the `session_presence` /
 * `session_typing` event branches in App.tsx), registers the current
 * connection as a viewer while a session is open, and emits throttled
 * `setTyping` beacons from the composer.
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { sessionActivityMapAtom } from '@/atoms/sessions'
import { useRoxCloudAccount } from '@/hooks/useRoxCloudAccount'
import {
  EMPTY_SESSION_ACTIVITY,
  TypingBeacon,
  resolveViewerIdentity,
  type SessionActivityState,
  type ViewerIdentity,
} from '@/lib/session-presence'

/** Live viewers + typing actors for one session. */
export function useSessionActivityState(sessionId: string): SessionActivityState {
  const activity = useAtomValue(sessionActivityMapAtom)
  return activity.get(sessionId) ?? EMPTY_SESSION_ACTIVITY
}

/** The local viewer's identity, from the server self actor id + cloud account. */
export function useViewerIdentity(): ViewerIdentity {
  const { account, connected } = useRoxCloudAccount()
  const [serverActorId, setServerActorId] = React.useState<string | null>(null)
  React.useEffect(() => {
    let cancelled = false
    const load = () => {
      void window.electronAPI?.identityGetState?.()
        .then(state => { if (!cancelled) setServerActorId(state?.sessionActorId ?? null) })
        .catch(() => { if (!cancelled) setServerActorId(null) })
    }
    load()
    const off = window.electronAPI?.onIdentityChanged?.(load)
    return () => {
      cancelled = true
      off?.()
    }
  }, [])
  return React.useMemo(() => resolveViewerIdentity({
    serverActorId,
    accountId: connected && account ? account.user.id : null,
    username: connected && account ? account.user.handle : null,
    displayName: connected && account ? account.user.name ?? account.user.email : null,
  }), [account, connected, serverActorId])
}

/**
 * Register the local connection as a viewer of `sessionId` for its lifetime,
 * so the server can broadcast live presence to other collaborators.
 */
export function useSessionViewerWatch(sessionId: string | null | undefined): void {
  React.useEffect(() => {
    if (!sessionId) return
    void window.electronAPI.sessionCommand(sessionId, { type: 'watchSession' }).catch(() => {})
    return () => {
      void window.electronAPI.sessionCommand(sessionId, { type: 'unwatchSession' }).catch(() => {})
    }
  }, [sessionId])
}

export interface SessionTypingBeacon {
  /** Notify the server that the local user is typing (throttled). */
  notifyTyping: () => void
  /** Clear the local typing flag (send/blur/unmount). */
  clearTyping: () => void
}

/**
 * Throttled `setTyping` beacons. One `true` per {@link TYPING_BEACON_INTERVAL_MS}
 * while the user types, one `false` on clear; the beacon is cleared on unmount.
 */
export function useSessionTypingBeacon(sessionId: string | null | undefined): SessionTypingBeacon {
  const sessionIdRef = React.useRef(sessionId)
  sessionIdRef.current = sessionId
  const beaconRef = React.useRef<TypingBeacon | null>(null)
  if (!beaconRef.current) {
    beaconRef.current = new TypingBeacon((typing) => {
      const target = sessionIdRef.current
      if (!target) return
      void window.electronAPI.sessionCommand(target, { type: 'setTyping', typing }).catch(() => {})
    })
  }
  // Clear the outstanding `true` when the session changes or the composer unmounts.
  React.useEffect(() => () => { beaconRef.current?.clear() }, [sessionId])

  const notifyTyping = React.useCallback(() => { beaconRef.current?.notify() }, [])
  const clearTyping = React.useCallback(() => { beaconRef.current?.clear() }, [])
  return { notifyTyping, clearTyping }
}