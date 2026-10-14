/**
 * Glass capability tier. `full` = backdrop blur + SVG edge refraction (Chromium
 * backdrop-filter url()); `basic` = plain backdrop-filter blur. Pure input →
 * tier so it is testable; `applyGlassTier` writes html[data-glass] and keeps it
 * live (reduced-transparency changes, battery) without polling.
 */
export type GlassTier = 'full' | 'basic'

export interface GlassEnv {
  hardwareConcurrency?: number
  deviceMemory?: number
  reducedTransparency?: boolean
  /** Unplugged. Alone it does not force basic; only together with a low level. */
  onBattery?: boolean
  /** 0..1 */
  batteryLevel?: number
  supportsBackdropUrl?: boolean
}

export const LOW_BATTERY_LEVEL = 0.2

export function resolveGlassTier(env: GlassEnv): GlassTier {
  if (env.reducedTransparency) return 'basic'
  if (env.onBattery && (env.batteryLevel ?? 1) < LOW_BATTERY_LEVEL) return 'basic'
  if ((env.hardwareConcurrency ?? 8) <= 4) return 'basic'
  if (env.deviceMemory !== undefined && env.deviceMemory <= 4) return 'basic'
  if (!env.supportsBackdropUrl) return 'basic'
  return 'full'
}

interface BatteryLike {
  charging: boolean
  level: number
  addEventListener(type: string, listener: () => void): void
  removeEventListener(type: string, listener: () => void): void
}
type GlassNavigator = Navigator & { deviceMemory?: number; getBattery?: () => Promise<BatteryLike> }

const REDUCED_TRANSPARENCY = '(prefers-reduced-transparency: reduce)'
const active = new WeakMap<HTMLElement, () => void>()

/**
 * Sets html[data-glass] and tracks live changes. Idempotent per root: a second
 * call returns the existing cleanup. The cleanup removes every listener.
 */
export function applyGlassTier(root: HTMLElement = document.documentElement): () => void {
  const existing = active.get(root)
  if (existing) return existing

  const nav = navigator as GlassNavigator
  const mq = typeof matchMedia === 'function' ? matchMedia(REDUCED_TRANSPARENCY) : null
  const supportsBackdropUrl = typeof CSS !== 'undefined' && CSS.supports('backdrop-filter', 'url(#a)')
  let battery: BatteryLike | null = null
  let disposed = false

  const write = () => {
    root.dataset.glass = resolveGlassTier({
      hardwareConcurrency: nav.hardwareConcurrency,
      deviceMemory: nav.deviceMemory,
      reducedTransparency: mq?.matches ?? false,
      onBattery: battery ? !battery.charging : false,
      batteryLevel: battery?.level,
      supportsBackdropUrl,
    })
  }

  write()
  mq?.addEventListener('change', write)
  nav.getBattery?.()
    .then((b) => {
      if (disposed) return
      battery = b
      b.addEventListener('chargingchange', write)
      b.addEventListener('levelchange', write)
      write()
    })
    .catch(() => {})

  const cleanup = () => {
    disposed = true
    mq?.removeEventListener('change', write)
    battery?.removeEventListener('chargingchange', write)
    battery?.removeEventListener('levelchange', write)
    active.delete(root)
  }
  active.set(root, cleanup)
  return cleanup
}
