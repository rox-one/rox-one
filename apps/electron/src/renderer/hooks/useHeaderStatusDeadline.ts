import { useEffect, useRef, useState } from 'react'
import { createPausableDeadline, type PausableDeadline } from '@/lib/pausable-deadline'

/** Hover, focus, menus and hidden windows pause the same remaining deadline. */
export function useHeaderStatusDeadline(
  id: string | undefined,
  durationMs: number | null,
  active: boolean,
  onElapsed: (id: string) => void,
) {
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || document.visibilityState !== 'hidden')
  const deadline = useRef<PausableDeadline | null>(null)

  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== 'hidden')
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [])

  useEffect(() => {
    if (!id || durationMs === null) return
    const timer = createPausableDeadline({
      durationMs,
      now: () => performance.now(),
      setTimer: (callback, ms) => window.setTimeout(callback, ms),
      clearTimer: timer => window.clearTimeout(timer),
      onElapsed: () => onElapsed(id),
    })
    deadline.current = timer
    return () => {
      timer.dispose()
      if (deadline.current === timer) deadline.current = null
    }
  }, [id, durationMs, onElapsed])

  useEffect(() => {
    deadline.current?.setActive(active && visible)
  }, [id, durationMs, onElapsed, active, visible])
}
