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
  VIEWER_WATCH_HEARTBEAT_MS,
  type SessionActivityState,
  type ViewerIdentity,
} from '@/lib/session-presence'

/** Live viewers + typing actors for one session. */
export function useSessionActivityState(sessionId: string): SessionActivityState {
  const activity = useAtomValue(sessionActivityMapAtom)
  return activity.get(sessionId) ?? EMPTY_SESSION_ACTIVITY
}

/** The local viewer's identity, from the Rox cloud account snapshot. */
export function useViewerIdentity(): ViewerIdentity {
  const { account, connected } = useRoxCloudAccount()
  return React.useMemo(() => ({
    accountId: connected && account ? account.user.id : null,
    username: connected && account ? account.user.handle : null,
    displayName: connected && account ? account.user.name ?? account.user.email : null,
  }), [account, connected])
}

/**
 * Register the local connection as a viewer of `sessionId` for its lifetime,
 * so the server can broadcast live presence to other collaborators.
 *
 * Server viewer entries expire after {@link SESSION_VIEWER_TTL_MS} (5 min), so
 * the initial `watchSession` is not enough: it is re-sent as a heartbeat well
 * under the TTL, and the interval is torn down on session change/unmount.
 */
export function useSessionViewerWatch(sessionId: string | null | undefined): void {
  React.useEffect(() => {
    if (!sessionId) return
    const command = (type: 'watchSession' | 'unwatchSession') => {
      void window.electronAPI.sessionCommand(sessionId, { type }).catch(() => {})
    }
    command('watchSession')
    const heartbeat = setInterval(() => command('watchSession'), VIEWER_WATCH_HEARTBEAT_MS)
    return () => {
      clearInterval(heartbeat)
      command('unwatchSession')
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
  const sessionIdRef = React.useRef<string | null | undefined>(sessionId)
  sessionIdRef.current = sessionId
  // The session that received the outstanding `true`. The `false` must go to
  // that same session: on a switch the render advances `sessionIdRef` to the
  // next session *before* the cleanup runs, so resolving the target at send
  // time would clear the wrong (new) session and orphan the old one.
  const typingSessionRef = React.useRef<string | null | undefined>(null)
  const beaconRef = React.useRef<TypingBeacon | null>(null)
  if (!beaconRef.current) {
    beaconRef.current = new TypingBeacon((typing) => {
      if (typing) typingSessionRef.current = sessionIdRef.current
      const target = typingSessionRef.current
      if (!typing) typingSessionRef.current = null
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