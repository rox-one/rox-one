import { useSyncExternalStore, type ReactNode } from 'react'
import { DeferredMotionConfig } from './deferred-motion'
import type { RenderProfile } from '../../shared/render-profile'

const ATTRIBUTE = 'data-render-profile'

/** Current profile from `<html data-render-profile>` (set by useShellAppearance). */
export function readRenderProfile(root: Pick<HTMLElement, 'getAttribute'> | null | undefined): RenderProfile {
  return root?.getAttribute(ATTRIBUTE) === 'performance' ? 'performance' : 'standard'
}

function subscribe(onChange: () => void): () => void {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return () => {}
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: [ATTRIBUTE] })
  return () => observer.disconnect()
}

function snapshot(): RenderProfile {
  return typeof document === 'undefined' ? 'standard' : readRenderProfile(document.documentElement)
}

/** Re-renders when the main-owned shell snapshot switches the profile. */
export function useRenderProfile(): RenderProfile {
  return useSyncExternalStore(subscribe, snapshot, () => 'standard')
}

/** motion/react setting for a profile: low-power always reduces JS motion. */
export function reducedMotionFor(profile: RenderProfile): 'always' | 'user' {
  return profile === 'performance' ? 'always' : 'user'
}

/**
 * PERF-07: CSS alone cannot stop motion/react springs. In the low-power
 * profile every motion component skips transform/layout animation;
 * otherwise motion follows the OS reduced-motion setting.
 */
export function RenderProfileMotionConfig({ children }: { children: ReactNode }) {
  const profile = useRenderProfile()
  return (
    <DeferredMotionConfig reducedMotion={reducedMotionFor(profile)}>
      {children}
    </DeferredMotionConfig>
  )
}

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

/**
 * PERF-07: the single "should JS motion be skipped?" answer for components.
 * True for the OS reduced-motion setting, for a MotionConfig that reduces
 * motion (the low-power root sets 'always'), and for the low-power profile
 * itself (so it also holds outside the root MotionConfig). Use this instead
 * of motion's useReducedMotion(), which reads only the OS setting.
 */
function osReducedMotionSnapshot(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia(REDUCED_MOTION_QUERY).matches
}

function subscribeOsReducedMotion(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}
  const mq = window.matchMedia(REDUCED_MOTION_QUERY)
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}

export function usePrefersReducedMotion(): boolean {
  const fromOs = useSyncExternalStore(subscribeOsReducedMotion, osReducedMotionSnapshot, () => false)
  const profile = useRenderProfile()
  return fromOs || profile === 'performance'
}

/**
 * Synchronous variant for imperative code (scroll follow, canvas viewport
 * tweens): OS reduced motion OR `<html data-render-profile="performance">`.
 */
export function prefersReducedMotionNow(): boolean {
  if (typeof document !== 'undefined' && readRenderProfile(document.documentElement) === 'performance') return true
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia(REDUCED_MOTION_QUERY).matches
}
