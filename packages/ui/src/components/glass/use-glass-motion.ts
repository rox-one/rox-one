import { useCallback, useState, type FocusEventHandler, type KeyboardEvent, type KeyboardEventHandler, type PointerEvent, type PointerEventHandler } from 'react'

/**
 * Glass motion hooks. They return attributes only; glass.css drives
 * transform/opacity transitions on --ease-spring, so there is no rAF loop and
 * nothing repaints while idle. Reduced motion is handled by the motion tokens.
 */
export type GlassPresence = 'open' | 'closed'

/** A closed surface is hidden (visibility) and `inert`: out of tab order and the a11y tree. */
export function glassPresenceAttrs(open: boolean): { 'data-glass-presence': GlassPresence; inert?: '' } {
  return open ? { 'data-glass-presence': 'open' } : { 'data-glass-presence': 'closed', inert: '' }
}

export interface GlassPressHandlers<T extends Element = HTMLElement> {
  onPointerDown?: PointerEventHandler<T>
  onPointerUp?: PointerEventHandler<T>
  onPointerLeave?: PointerEventHandler<T>
  onPointerCancel?: PointerEventHandler<T>
  onKeyDown?: KeyboardEventHandler<T>
  onKeyUp?: KeyboardEventHandler<T>
  onBlur?: FocusEventHandler<T>
}

/** Keys that activate a button; the press state mirrors the pointer press. */
export function isGlassPressKey(key: string): boolean {
  return key === ' ' || key === 'Enter'
}

/** Press spring for pointer and keyboard (Space/Enter). Composes the consumer's handlers (theirs run first). */
export function useGlassPress<T extends Element = HTMLElement>(handlers: GlassPressHandlers<T> = {}) {
  const [pressed, setPressed] = useState(false)
  const { onPointerDown, onPointerUp, onPointerLeave, onPointerCancel, onKeyDown, onKeyUp, onBlur } = handlers
  const down = useCallback((e: PointerEvent<T>) => { onPointerDown?.(e); setPressed(true) }, [onPointerDown])
  const up = useCallback((e: PointerEvent<T>) => { onPointerUp?.(e); setPressed(false) }, [onPointerUp])
  const leave = useCallback((e: PointerEvent<T>) => { onPointerLeave?.(e); setPressed(false) }, [onPointerLeave])
  const cancel = useCallback((e: PointerEvent<T>) => { onPointerCancel?.(e); setPressed(false) }, [onPointerCancel])
  const keyDown = useCallback((e: KeyboardEvent<T>) => {
    onKeyDown?.(e)
    if (!e.repeat && isGlassPressKey(e.key)) setPressed(true)
  }, [onKeyDown])
  const keyUp = useCallback((e: KeyboardEvent<T>) => {
    onKeyUp?.(e)
    if (isGlassPressKey(e.key)) setPressed(false)
  }, [onKeyUp])
  const blur = useCallback<FocusEventHandler<T>>((e) => { onBlur?.(e); setPressed(false) }, [onBlur])
  return {
    'data-glass-pressed': pressed ? '' : undefined,
    onPointerDown: down,
    onPointerUp: up,
    onPointerLeave: leave,
    onPointerCancel: cancel,
    onKeyDown: keyDown,
    onKeyUp: keyUp,
    onBlur: blur,
  }
}
