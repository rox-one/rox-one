import { useCallback, useState } from 'react'

/**
 * Glass motion hooks. They return data attributes only; the CSS in
 * glass.css drives transform/opacity transitions on --ease-spring, so there
 * is no rAF loop and nothing repaints while idle. Reduced motion is handled
 * by the motion tokens (durations → 0), not here.
 */
export type GlassPresence = 'open' | 'closed'

export function glassPresenceAttrs(open: boolean) {
  return { 'data-glass-presence': (open ? 'open' : 'closed') as GlassPresence }
}

export function useGlassPress() {
  const [pressed, setPressed] = useState(false)
  const down = useCallback(() => setPressed(true), [])
  const up = useCallback(() => setPressed(false), [])
  return {
    'data-glass-pressed': pressed ? '' : undefined,
    onPointerDown: down,
    onPointerUp: up,
    onPointerLeave: up,
    onPointerCancel: up,
  }
}
