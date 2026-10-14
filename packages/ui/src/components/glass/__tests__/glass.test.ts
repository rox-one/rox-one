import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { applyGlassTier, resolveGlassTier } from '../../../lib/glass-capability'
import { glassPresenceAttrs } from '../use-glass-motion'

const strong = { hardwareConcurrency: 10, deviceMemory: 16, supportsBackdropUrl: true }

describe('resolveGlassTier', () => {
  it('full on a capable machine', () => expect(resolveGlassTier(strong)).toBe('full'))
  it('basic with <=4 cores', () => expect(resolveGlassTier({ ...strong, hardwareConcurrency: 4 })).toBe('basic'))
  it('basic with low memory', () => expect(resolveGlassTier({ ...strong, deviceMemory: 4 })).toBe('basic'))
  it('stays full when merely unplugged', () =>
    expect(resolveGlassTier({ ...strong, onBattery: true, batteryLevel: 0.5 })).toBe('full'))
  it('basic when unplugged and below 20%', () =>
    expect(resolveGlassTier({ ...strong, onBattery: true, batteryLevel: 0.19 })).toBe('basic'))
  it('stays full when charging at low level', () =>
    expect(resolveGlassTier({ ...strong, onBattery: false, batteryLevel: 0.05 })).toBe('full'))
  it('basic with reduced transparency', () =>
    expect(resolveGlassTier({ ...strong, reducedTransparency: true })).toBe('basic'))
  it('basic without backdrop url() support', () =>
    expect(resolveGlassTier({ ...strong, supportsBackdropUrl: false })).toBe('basic'))
})

describe('glassPresenceAttrs', () => {
  it('maps open/closed', () => {
    expect(glassPresenceAttrs(true)['data-glass-presence']).toBe('open')
    expect(glassPresenceAttrs(false)['data-glass-presence']).toBe('closed')
    expect(glassPresenceAttrs(false).inert).toBe('')
    expect(glassPresenceAttrs(true).inert).toBeUndefined()
  })
})

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '')
const css = strip(readFileSync(join(import.meta.dir, '../glass.css'), 'utf8'))
const motion = strip(readFileSync(join(import.meta.dir, '../../../styles/tokens/motion.css'), 'utf8'))

describe('glass CSS invariants', () => {
  it('never transitions backdrop-filter or filter', () => {
    for (const m of css.matchAll(/transition[^;]*;/g)) expect(m[0]).not.toMatch(/filter|all/)
  })
  it('spring tokens zero under reduced motion and resizing', () => {
    expect(motion).toMatch(/html\[data-resizing\]\s*{[^}]*--motion-spring-scale:\s*0/)
    expect(motion).toMatch(/prefers-reduced-motion[\s\S]*--motion-spring-scale:\s*0/)
  })
  it('refraction only applies on the full tier', () => {
    const uses = css.split('}').filter((b) => b.includes('var(--glass-filter)'))
    for (const b of uses) expect(b).toContain('html[data-glass="full"]')
  })
})

describe('closed surface', () => {
  it('hides with a delayed visibility flip', () => {
    const closed = css.split('}').find((b) => b.includes('[data-glass-presence="closed"]')) ?? ''
    expect(closed).toMatch(/visibility:\s*hidden/)
    expect(closed).toMatch(/transition-delay:[^;]*var\(--motion-spring-exit\)/)
  })
})

describe('per-surface intensity', () => {
  const block = css.split('}')[0]
  it('re-derives every glass token on .glass-surface from --glass-intensity', () => {
    for (const t of ['blur', 'saturate', 'tint', 'edge-alpha', 'specular-alpha'])
      expect(block).toMatch(new RegExp(`--glass-${t}:\\s*calc\\([^;]*var\\(--glass-intensity\\)`))
  })
  it('pressed never overrides the closed state', () => {
    expect(css).toContain('[data-glass-pressed]:not([data-glass-presence="closed"])')
  })
})

describe('applyGlassTier ref counting', () => {
  it('keeps listeners until the last caller releases (StrictMode double mount)', () => {
    let added = 0
    let removed = 0
    const g = globalThis as { matchMedia?: unknown }
    const prev = g.matchMedia
    g.matchMedia = () => ({
      matches: false,
      addEventListener: () => { added++ },
      removeEventListener: () => { removed++ },
    })
    try {
      const root = { dataset: {} as Record<string, string> } as unknown as HTMLElement
      const a = applyGlassTier(root)
      a() // StrictMode: mount, unmount…
      const b = applyGlassTier(root) // …remount
      const c = applyGlassTier(root) // second consumer
      expect(root.dataset.glass).toBeDefined()
      b()
      b() // release is once-only
      expect(added - removed).toBe(1)
      c()
      expect(added - removed).toBe(0)
    } finally {
      g.matchMedia = prev
    }
  })
})
