import { useSyncExternalStore, type ReactNode } from 'react'
import { MotionConfig } from 'motion/react'
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
  return <MotionConfig reducedMotion={reducedMotionFor(profile)}>{children}</MotionConfig>
}
