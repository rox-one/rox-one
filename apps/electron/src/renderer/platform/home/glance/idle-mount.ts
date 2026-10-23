/**
 * Mount policy for Glance cards:
 * 1. Near the viewport (rootMargin) → mount immediately for first paint.
 * 2. Off-screen → mount on requestIdleCallback (or a short timeout fallback)
 *    so scrolling later does not hitch on a cold chunk.
 */
import { useEffect, useRef, useState, type RefObject } from 'react'

const NEAR_MARGIN = '200px 0px'
/** Cap how long an off-screen card waits for idle before we force-mount it. */
const IDLE_TIMEOUT_MS = 1_500

function scheduleIdle(cb: () => void): () => void {
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(cb, { timeout: IDLE_TIMEOUT_MS })
    return () => cancelIdleCallback(id)
  }
  const id = window.setTimeout(cb, IDLE_TIMEOUT_MS)
  return () => window.clearTimeout(id)
}

/**
 * Returns `[ref, ready]`. Attach `ref` to the card body; render the real widget
 * only when `ready` is true (skeleton otherwise).
 */
export function useNearViewport<T extends HTMLElement>(): [RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null)
  const [ready, setReady] = useState(typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    if (ready) return
    const el = ref.current
    if (!el) return
    let cancelled = false
    let cancelIdle: (() => void) | null = null
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return
        cancelled = true
        cancelIdle?.()
        setReady(true)
        io.disconnect()
      },
      { rootMargin: NEAR_MARGIN },
    )
    io.observe(el)
    // Off-screen cards: mount during browser idle so cold chunks warm up.
    cancelIdle = scheduleIdle(() => {
      if (cancelled) return
      setReady(true)
      io.disconnect()
    })
    return () => {
      cancelled = true
      cancelIdle?.()
      io.disconnect()
    }
  }, [ready])
  return [ref, ready]
}
