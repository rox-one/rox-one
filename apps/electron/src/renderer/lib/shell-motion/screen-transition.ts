/**
 * Screen enter transition (top-50 #4). Pure CSS: the entering screen gets a
 * one-shot keyframe chosen by navigation direction; no JS timers, nothing on
 * reduced motion (handled in index.css). Direction follows route depth:
 * deeper → enters from the right, shallower → from the left, sibling → fade.
 */
export type NavDirection = 'forward' | 'back' | 'none'

/** Route depth = number of non-empty path segments ("sessions/abc" → 2). */
export function routeDepth(route: string): number {
  return route.replace(/[?#].*$/, '').split('/').filter(Boolean).length
}

/** Screen key = first segment; transitions run only when it changes. */
export function screenKeyOf(route: string): string {
  return route.replace(/^\/+/, '').split(/[/?#]/)[0] || 'home'
}

export function navDirection(prev: string | null, next: string): NavDirection {
  if (prev === null || prev === next) return 'none'
  const a = routeDepth(prev)
  const b = routeDepth(next)
  if (b > a) return 'forward'
  if (b < a) return 'back'
  return 'none'
}
