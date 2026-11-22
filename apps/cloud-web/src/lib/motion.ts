/**
 * Motion, without a framework. Rox Cloud is SolidJS, so only the plain
 * `animate` export of Motion is used: this module owns every duration and
 * curve, and every helper first asks whether the person wants motion at all.
 *
 * Used on screen in two places: the console page enters once with `reveal`,
 * and the machine list reorders with `flip`; the console count uses
 * `animateNumber`.
 */
import { animate } from 'motion'

/** The shared base step from the design tokens, in seconds. */
const BASE_SECONDS = 0.16

/** The curve of the design tokens (`--ease`), written out for Motion. */
const EASE: [number, number, number, number] = [0.2, 0.7, 0.3, 1]

/** Motion stops where it needs nothing: a zero duration and no transform. */
export interface AnimateHandle {
  stop: () => void
}

const NOOP: AnimateHandle = { stop: () => {} }

/** Read on every call, so a system setting changed in the tab applies at once. */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * The base step in milliseconds, read from `--dur-base`. The token already
 * turns to `0ms` under reduced motion; the media query is the second guard.
 */
export function baseDurationMs(): number {
  if (prefersReducedMotion() || typeof window === 'undefined') return 0
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--dur-base').trim()
  const value = raw.endsWith('ms') ? Number.parseFloat(raw) : Number.NaN
  return Number.isFinite(value) && value >= 0 ? value : BASE_SECONDS * 1000
}

export interface RevealOptions {
  /** Extra wait in seconds; a stagger is built from unchanged small steps. */
  delay?: number
  /** How far the element rises, in pixels. `0` keeps the fade only. */
  distance?: number
}

/**
 * Bring a node in: opacity from 0 and a short rise. One call per node, after
 * it is mounted. Returns a stop handle for a node that unmounts mid-way.
 */
export function reveal(element: HTMLElement, options: RevealOptions = {}): AnimateHandle {
  if (prefersReducedMotion()) return NOOP
  const distance = options.distance ?? 6
  const controls = animate(
    element,
    { opacity: [0, 1], y: [distance, 0] },
    { duration: BASE_SECONDS, delay: options.delay ?? 0, ease: EASE },
  )
  // Motion leaves its last frame inline; a zero transform would still make the
  // node a containing block for fixed children, so the settled node keeps none.
  void controls.then(() => {
    element.style.opacity = ''
    element.style.transform = ''
  })
  return { stop: () => controls.stop() }
}

export interface FlipOptions {
  /** Overrides the base step for a list that needs to settle slower. */
  duration?: number
}

interface Box {
  left: number
  top: number
  width: number
  height: number
}

function box(element: Element): Box {
  const rect = element.getBoundingClientRect()
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
}

/** Cards carry `data-flip-key`; anything else is matched by its position. */
function keyOf(element: HTMLElement, index: number): string {
  const key = element.dataset.flipKey
  return key === undefined ? `i:${index}` : `k:${key}`
}

/**
 * The nodes a flip moves: every marked card under the container, or the
 * container's own children when nothing is marked. Marked cards survive a
 * re-render of their wrapper, so a list rebuilt from fresh data still matches
 * the card that was there before.
 */
function items(root: HTMLElement): HTMLElement[] {
  const marked = Array.from(root.querySelectorAll<HTMLElement>('[data-flip-key]'))
  if (marked.length > 0) return marked
  return Array.from(root.children).filter((child): child is HTMLElement => child instanceof HTMLElement)
}

/**
 * Reorder in place: measure the items, run the change that moves them, then
 * animate every item from where it was to where it is now. An item without a
 * previous box is new, so it fades in instead.
 */
export function flip(container: HTMLElement, mutate: () => void, options: FlipOptions = {}): void {
  // Reduced motion still applies the change; it simply arrives settled.
  if (prefersReducedMotion()) {
    mutate()
    return
  }
  const duration = options.duration ?? BASE_SECONDS
  const before = new Map<string, Box>()
  items(container).forEach((item, index) => {
    before.set(keyOf(item, index), box(item))
  })

  mutate()

  const seen = new Set<string>()
  items(container).forEach((child, index) => {
    const key = keyOf(child, index)
    if (seen.has(key)) return
    seen.add(key)
    const from = before.get(key)
    if (from === undefined) {
      const enter = animate(child, { opacity: [0, 1], y: [6, 0] }, { duration, ease: EASE })
      void enter.then(() => {
        child.style.opacity = ''
        child.style.transform = ''
      })
      return
    }
    const now = box(child)
    const dx = from.left - now.left
    const dy = from.top - now.top
    const scaleX = now.width === 0 ? 1 : from.width / now.width
    const scaleY = now.height === 0 ? 1 : from.height / now.height
    const moved = Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5
    const resized = Math.abs(scaleX - 1) > 0.01 || Math.abs(scaleY - 1) > 0.01
    if (!moved && !resized) return
    // A card keeps its own width and height; scale is the cheap way to show a
    // size change without animating layout on every frame.
    child.style.transformOrigin = '0 0'
    const controls = animate(
      child,
      { x: [dx, 0], y: [dy, 0], scaleX: [scaleX, 1], scaleY: [scaleY, 1] },
      { duration, ease: EASE },
    )
    void controls.then(() => {
      if (child.style.transformOrigin === '0 0') child.style.transformOrigin = ''
      child.style.transform = ''
    })
  })
}

export interface NumberOptions {
  duration?: number
  onUpdate: (value: number) => void
  onComplete?: () => void
}

/**
 * Count from one number to another; the caller decides how to print it.
 * Reduced motion prints the final number once and animates nothing.
 */
export function animateNumber(from: number, to: number, options: NumberOptions): AnimateHandle {
  if (prefersReducedMotion() || from === to) {
    options.onUpdate(to)
    options.onComplete?.()
    return NOOP
  }
  const controls = animate(from, to, {
    duration: options.duration ?? BASE_SECONDS,
    ease: EASE,
    onUpdate: options.onUpdate,
    onComplete: options.onComplete,
  })
  return { stop: () => controls.stop() }
}
