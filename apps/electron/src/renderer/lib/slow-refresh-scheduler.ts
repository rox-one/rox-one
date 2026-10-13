/**
 * One slow-refresh clock for Rox Cloud and mail status (#1579).
 * Pauses when the document is hidden. Surfaces that are inactive should
 * unsubscribe (useEffectiveVisible) rather than keep a private setInterval.
 */

export const SLOW_REFRESH_MS = 60_000

export interface SlowRefreshClock {
  now: () => number
  setTimeout: (fn: () => void, ms: number) => unknown
  clearTimeout: (id: unknown) => void
  hidden: () => boolean
  onVisibility: (listener: () => void) => () => void
}

type Listener = () => void

const listeners = new Set<Listener>()
let timer: unknown = null
let lastFireAt = 0
let visibilityOff: (() => void) | null = null

let clock: SlowRefreshClock = createDomClock()

function createDomClock(): SlowRefreshClock {
  return {
    now: () => Date.now(),
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (id) => globalThis.clearTimeout(id as ReturnType<typeof setTimeout>),
    hidden: () => typeof document !== 'undefined' && document.hidden,
    onVisibility: (listener) => {
      if (typeof document === 'undefined') return () => {}
      const handler = () => listener()
      document.addEventListener('visibilitychange', handler)
      return () => document.removeEventListener('visibilitychange', handler)
    },
  }
}

function arm(): void {
  if (timer != null || listeners.size === 0) return
  const delay = Math.max(0, SLOW_REFRESH_MS - (clock.now() - lastFireAt))
  timer = clock.setTimeout(tick, delay)
}

function disarm(): void {
  if (timer == null) return
  clock.clearTimeout(timer)
  timer = null
}

function tick(): void {
  timer = null
  if (clock.hidden() || listeners.size === 0) return
  lastFireAt = clock.now()
  for (const listener of [...listeners]) listener()
  arm()
}

function onVisibility(): void {
  if (clock.hidden()) disarm()
  else arm()
}

/** Test hook: swap the clock (or `null` to restore the DOM clock). */
export function setSlowRefreshClockForTests(next: SlowRefreshClock | null): void {
  disarm()
  visibilityOff?.()
  visibilityOff = null
  clock = next ?? createDomClock()
  lastFireAt = 0
  if (listeners.size > 0) {
    visibilityOff = clock.onVisibility(onVisibility)
    arm()
  }
}

/** Subscribe to the shared slow tick. No ticks while `document.hidden`. */
export function subscribeSlowRefresh(listener: Listener): () => void {
  listeners.add(listener)
  if (listeners.size === 1) {
    visibilityOff = clock.onVisibility(onVisibility)
    arm()
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      disarm()
      visibilityOff?.()
      visibilityOff = null
    }
  }
}
