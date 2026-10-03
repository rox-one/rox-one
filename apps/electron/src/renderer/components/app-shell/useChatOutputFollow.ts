import * as React from 'react'
import { followChatOutput } from './chat-scroll'

interface ChatScrollOwner { readonly sessionId: string; readonly viewport: HTMLDivElement }
/** Queued output follows only its committed session/viewport incarnation, including A→B→A. */
export function useChatOutputFollow(sessionId: string | undefined, viewportRef: React.RefObject<HTMLDivElement | null>,
  focusedRef: React.MutableRefObject<boolean>, stickRef: React.MutableRefObject<boolean>) {
  const ownerRef = React.useRef<ChatScrollOwner | null>(null)
  const outputMotionRef = React.useRef<{ sessionId: string; viewport: HTMLDivElement; top: number } | null>(null)
  const begin = React.useCallback((top = viewportRef.current?.scrollTop ?? 0) => {
    const viewport = viewportRef.current
    if (sessionId && viewport) outputMotionRef.current = { sessionId, viewport, top }
  }, [sessionId, viewportRef])
  const interrupt = React.useCallback(() => {
    const motion = outputMotionRef.current
    outputMotionRef.current = null
    stickRef.current = false
    // Stop an owned smooth animation before a reader gesture or explicit search jump.
    if (motion && motion.viewport === viewportRef.current && motion.viewport.isConnected) {
      motion.viewport.scrollTo({ top: motion.viewport.scrollTop, behavior: 'instant' })
    }
  }, [viewportRef, stickRef])
  const ownsScroll = React.useCallback((viewport: HTMLDivElement) => {
    const motion = outputMotionRef.current
    if (!motion || motion.sessionId !== ownerRef.current?.sessionId || motion.viewport !== viewport) return false
    // Native scroll events from our own follow must not turn off stickiness mid-animation.
    // A backwards scroll (including a scrollbar/programmatic history jump) hands it to the reader.
    if (viewport.scrollTop + 1 < motion.top) { outputMotionRef.current = null; return false }
    motion.top = viewport.scrollTop
    return true
  }, [])
  React.useLayoutEffect(() => {
    const viewport = viewportRef.current
    const current = ownerRef.current
    if (current?.sessionId !== sessionId || current?.viewport !== viewport) {
      ownerRef.current = sessionId && viewport ? { sessionId, viewport } : null
    }
  })
  React.useLayoutEffect(() => () => { ownerRef.current = null; outputMotionRef.current = null }, [])
  const capture = React.useCallback(() => ownerRef.current, [])
  const owns = React.useCallback((owner: ChatScrollOwner | null): owner is ChatScrollOwner =>
    !!owner && ownerRef.current === owner && viewportRef.current === owner.viewport && owner.viewport.isConnected, [viewportRef])
  const follow = React.useCallback((owner: ChatScrollOwner | null) => {
    if (!owns(owner)) return false
    const previousTop = owner.viewport.scrollTop
    const followed = followChatOutput(owner.viewport, {
      // Preserve the current policy: unfocused panels follow instantly, focused readers control stickiness.
      stickToBottom: !focusedRef.current || stickRef.current,
      focused: focusedRef.current,
      reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      documentVisible: document.visibilityState === 'visible',
    })
    if (followed) begin(previousTop)
    return followed
  }, [owns, focusedRef, stickRef, begin])
  return { capture, follow, owns, begin, ownsScroll, interrupt }
}
