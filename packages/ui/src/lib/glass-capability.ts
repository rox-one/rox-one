/**
 * Glass capability tier. `full` = backdrop blur + SVG edge refraction (Chromium
 * backdrop-filter url()); `basic` = the solid, blur-free material — under Arc
 * Glass every glass recipe drops backdrop-filter and keeps tint, sheen and
 * hairlines (the same flatten the a11y/performance gates apply); other themes
 * define their own use of the attribute. Pure input → tier so it is testable;
 * `applyGlassTier` writes html[data-glass] and keeps it live
 * (reduced-transparency changes, battery) without polling.
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
const active = new WeakMap<HTMLElement, { refs: number; dispose: () => void }>()

/**
 * Sets html[data-glass] and tracks live changes. Ref-counted per root: every
 * call returns its own once-only release; listeners are removed when the last
 * caller releases (safe under StrictMode double mount/unmount).
 */
export function applyGlassTier(root: HTMLElement = document.documentElement): () => void {
  let entry = active.get(root)
  if (!entry) {
    entry = { refs: 0, dispose: startGlassTier(root) }
    active.set(root, entry)
  }
  entry.refs++
  let released = false
  return () => {
    if (released) return
    released = true
    const current = active.get(root)
    if (!current || --current.refs > 0) return
    active.delete(root)
    current.dispose()
  }
}

function startGlassTier(root: HTMLElement): () => void {
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

  return () => {
    disposed = true
    mq?.removeEventListener('change', write)
    battery?.removeEventListener('chargingchange', write)
    battery?.removeEventListener('levelchange', write)
  }
}
