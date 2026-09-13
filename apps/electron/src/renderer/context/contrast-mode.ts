export type ContrastMode = 'system' | 'normal' | 'high'
export type ResolvedContrast = 'normal' | 'high'

export function isContrastMode(value: unknown): value is ContrastMode {
  return value === 'system' || value === 'normal' || value === 'high'
}

export function resolveContrast(mode: ContrastMode, prefersMore: boolean): ResolvedContrast {
  if (mode === 'high') return 'high'
  if (mode === 'normal') return 'normal'
  return prefersMore ? 'high' : 'normal'
}

export function prefersMoreContrast(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-contrast: more)').matches
}
