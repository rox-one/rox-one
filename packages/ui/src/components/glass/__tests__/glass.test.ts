import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveGlassTier } from '../../../lib/glass-capability'
import { glassPresenceAttrs } from '../use-glass-motion'

const strong = { hardwareConcurrency: 10, deviceMemory: 16, supportsBackdropUrl: true }

describe('resolveGlassTier', () => {
  it('full on a capable machine', () => expect(resolveGlassTier(strong)).toBe('full'))
  it('basic with <=4 cores', () => expect(resolveGlassTier({ ...strong, hardwareConcurrency: 4 })).toBe('basic'))
  it('basic with low memory', () => expect(resolveGlassTier({ ...strong, deviceMemory: 4 })).toBe('basic'))
  it('basic on battery', () => expect(resolveGlassTier({ ...strong, onBattery: true })).toBe('basic'))
  it('basic with reduced transparency', () =>
    expect(resolveGlassTier({ ...strong, reducedTransparency: true })).toBe('basic'))
  it('basic without backdrop url() support', () =>
    expect(resolveGlassTier({ ...strong, supportsBackdropUrl: false })).toBe('basic'))
})

describe('glassPresenceAttrs', () => {
  it('maps open/closed', () => {
    expect(glassPresenceAttrs(true)['data-glass-presence']).toBe('open')
    expect(glassPresenceAttrs(false)['data-glass-presence']).toBe('closed')
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
