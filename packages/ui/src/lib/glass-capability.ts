/**
 * Glass capability tier. `full` = backdrop blur + SVG refraction (Chromium
 * backdrop-filter url()); `basic` = plain backdrop-filter blur. Pure input
 * → tier so it is testable; `applyGlassTier` writes html[data-glass].
 */
export type GlassTier = 'full' | 'basic'

export interface GlassEnv {
  hardwareConcurrency?: number
  deviceMemory?: number
  reducedTransparency?: boolean
  reducedMotion?: boolean
  onBattery?: boolean
  supportsBackdropUrl?: boolean
}

export function resolveGlassTier(env: GlassEnv): GlassTier {
  if (env.reducedTransparency || env.onBattery) return 'basic'
  if ((env.hardwareConcurrency ?? 8) <= 4) return 'basic'
  if (env.deviceMemory !== undefined && env.deviceMemory <= 4) return 'basic'
  if (!env.supportsBackdropUrl) return 'basic'
  return 'full'
}

type BatteryNav = Navigator & {
  deviceMemory?: number
  getBattery?: () => Promise<{ charging: boolean; addEventListener(t: string, f: () => void): void }>
}

function readEnv(onBattery: boolean): GlassEnv {
  const nav = navigator as BatteryNav
  const mm = (q: string) => typeof matchMedia === 'function' && matchMedia(q).matches
  return {
    hardwareConcurrency: nav.hardwareConcurrency,
    deviceMemory: nav.deviceMemory,
    reducedTransparency: mm('(prefers-reduced-transparency: reduce)'),
    reducedMotion: mm('(prefers-reduced-motion: reduce)'),
    onBattery,
    supportsBackdropUrl: typeof CSS !== 'undefined' && CSS.supports('backdrop-filter', 'url(#a)'),
  }
}

/** Sets html[data-glass] once and on battery changes. Idempotent; no polling. */
export function applyGlassTier(root: HTMLElement = document.documentElement): void {
  const write = (onBattery: boolean) => {
    root.dataset.glass = resolveGlassTier(readEnv(onBattery))
  }
  write(false)
  const nav = navigator as BatteryNav
  void nav.getBattery?.().then((b) => {
    const update = () => write(!b.charging)
    update()
    b.addEventListener('chargingchange', update)
  }).catch(() => {})
}
