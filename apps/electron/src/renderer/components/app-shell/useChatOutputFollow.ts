import * as React from 'react'
import { followChatOutput } from './chat-scroll'

interface ChatScrollOwner { readonly sessionId: string; readonly viewport: HTMLDivElement }
/** Queued output follows only its committed session/viewport incarnation, including A→B→A. */
export function useChatOutputFollow(sessionId: string | undefined, viewportRef: React.RefObject<HTMLDivElement | null>,
  focusedRef: React.MutableRefObject<boolean>, stickRef: React.MutableRefObject<boolean>) {
  const ownerRef = React.useRef<ChatScrollOwner | null>(null)
  React.useLayoutEffect(() => {
    const viewport = viewportRef.current
    const current = ownerRef.current
    if (current?.sessionId !== sessionId || current?.viewport !== viewport) {
      ownerRef.current = sessionId && viewport ? { sessionId, viewport } : null
    }
  })
  React.useLayoutEffect(() => () => { ownerRef.current = null }, [])
  const capture = React.useCallback(() => ownerRef.current, [])
  const owns = React.useCallback((owner: ChatScrollOwner | null): owner is ChatScrollOwner =>
    !!owner && ownerRef.current === owner && viewportRef.current === owner.viewport && owner.viewport.isConnected, [viewportRef])
  const follow = React.useCallback((owner: ChatScrollOwner | null) => {
    if (!owns(owner)) return false
    return followChatOutput(owner.viewport, {
      // Preserve the current policy: unfocused panels follow instantly, focused readers control stickiness.
      stickToBottom: !focusedRef.current || stickRef.current,
      focused: focusedRef.current,
      reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      documentVisible: document.visibilityState === 'visible',
    })
  }, [owns, focusedRef, stickRef])
  return { capture, follow, owns }
}
