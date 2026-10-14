/**
 * Environment signals FxGate needs, kept dependency-free so @rox/ui stays
 * platform-agnostic (Electron renderer and web viewer).
 */
import { useEffect, useState, useSyncExternalStore } from 'react'

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'
const RENDER_PROFILE_ATTR = 'data-render-profile'

function subscribeReduced(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const unsubs: Array<() => void> = []
  if (typeof window.matchMedia === 'function') {
    const mq = window.matchMedia(REDUCED_MOTION_QUERY)
    mq.addEventListener?.('change', onChange)
    unsubs.push(() => mq.removeEventListener?.('change', onChange))
  }
  if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
    const mo = new MutationObserver(onChange)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: [RENDER_PROFILE_ATTR] })
    unsubs.push(() => mo.disconnect())
  }
  return () => unsubs.forEach((u) => u())
}

/** OS reduced motion OR the app's low-power render profile. */
export function reducedMotionNow(): boolean {
  if (typeof document !== 'undefined' && document.documentElement.getAttribute(RENDER_PROFILE_ATTR) === 'performance') return true
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia(REDUCED_MOTION_QUERY).matches
}

export function useFxReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReduced, reducedMotionNow, () => false)
}

function subscribeVisibility(onChange: () => void): () => void {
  if (typeof document === 'undefined') return () => {}
  document.addEventListener('visibilitychange', onChange)
  return () => document.removeEventListener('visibilitychange', onChange)
}

export function useDocumentVisible(): boolean {
  return useSyncExternalStore(
    subscribeVisibility,
    () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
    () => true,
  )
}

interface BatteryLike {
  charging: boolean
  level: number
  addEventListener(type: string, fn: () => void): void
  removeEventListener(type: string, fn: () => void): void
}

/** Battery saver heuristic: discharging and at or under 20 %. */
export function useBatterySaver(): boolean {
  const [low, setLow] = useState(false)
  useEffect(() => {
    const nav = typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { getBattery?: () => Promise<BatteryLike> })
    if (!nav?.getBattery) return
    let battery: BatteryLike | null = null
    let alive = true
    const update = () => { if (alive && battery) setLow(!battery.charging && battery.level <= 0.2) }
    nav.getBattery().then((b) => {
      battery = b
      update()
      b.addEventListener('chargingchange', update)
      b.addEventListener('levelchange', update)
    }).catch(() => {})
    return () => {
      alive = false
      battery?.removeEventListener('chargingchange', update)
      battery?.removeEventListener('levelchange', update)
    }
  }, [])
  return low
}

let webgl2Cache: boolean | undefined
export function hasWebGL2(): boolean {
  if (webgl2Cache !== undefined) return webgl2Cache
  try {
    const canvas = typeof document === 'undefined' ? null : document.createElement('canvas')
    const gl = canvas?.getContext('webgl2') ?? null
    webgl2Cache = !!gl
    ;(gl as WebGL2RenderingContext | null)?.getExtension('WEBGL_lose_context')?.loseContext()
  } catch {
    webgl2Cache = false
  }
  return webgl2Cache
}

/** Test hook. */
export function __resetWebGL2Cache(): void {
  webgl2Cache = undefined
}
