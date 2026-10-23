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

const material = strip(readFileSync(join(import.meta.dir, '../../../styles/tokens/material.css'), 'utf8'))
describe('per-surface intensity', () => {
  const block = material.slice(material.indexOf('.glass-surface'))
  it('re-derives every glass token on .glass-surface from --glass-intensity', () => {
    for (const t of ['blur', 'saturate', 'tint', 'edge-alpha', 'specular-alpha'])
      expect(block).toMatch(new RegExp(`--glass-${t}:\\s*calc\\([^;]*var\\(--glass-intensity\\)`))
  })
  it('declares the non-SE blur formula once; SE accents override separately', () => {
    expect(material.match(/--glass-blur:\s*calc\(8px \+ 24px/g)?.length).toBe(1)
    expect(material.match(/--glass-blur:\s*calc\(var\(--chrome-glass-blur/g)?.length).toBe(1)
    expect(css).not.toMatch(/--glass-blur:/)
    expect(block).toMatch(/--glass-shadow:/)
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

import { isGlassPressKey } from '../use-glass-motion'
const skin = strip(readFileSync(join(import.meta.dir, '../arc-glass-skin.css'), 'utf8'))

describe('keyboard press', () => {
  it('Space and Enter press; other keys do not', () => {
    expect(isGlassPressKey(' ')).toBe(true)
    expect(isGlassPressKey('Enter')).toBe(true)
    expect(isGlassPressKey('a')).toBe(false)
    expect(isGlassPressKey('Tab')).toBe(false)
  })
})

describe('SE optional glass accents', () => {
  it('base paint and degradations are chrome-only (never bare [data-glass-slot])', () => {
    const chrome = ['.rox-mode-pill', '[data-glass-slot="popover"]', '[data-glass-slot="composer"]', '[data-glass-slot="mini-button"]']
    expect(skin).toMatch(
      /html\[data-ui-profile="super-engineering"\]\[data-glass-accents\]\s*:is\(\.rox-mode-pill,\s*\[data-glass-slot="popover"\],\s*\[data-glass-slot="composer"\],\s*\[data-glass-slot="mini-button"\]\)/,
    )
    // No content-layer slots in the skin.
    for (const slot of ['panel', 'toolbar', 'card', 'table', 'row', 'empty', 'editor', 'dialog', 'sheet', 'toast'])
      expect(skin).not.toContain(`[data-glass-slot="${slot}"]`)
    // Bare attribute must not appear in selectors.
    for (const rule of skin.split('}').filter((r) => r.includes('{'))) {
      const sel = rule.split('{')[0]
      if (!sel.includes('[data-glass-slot]')) continue
      expect(sel).not.toMatch(/\[data-glass-slot\](?!=")/)
    }
    for (const c of chrome) expect(skin).toContain(c)
  })
  it('default --glass-intensity is 0 in material and layers (off until themes emit glass)', () => {
    const layers = strip(readFileSync(join(import.meta.dir, '../../../styles/tokens/layers.css'), 'utf8'))
    expect(material).toMatch(/:root\s*{[^}]*--glass-intensity:\s*0;/)
    expect(layers).toMatch(/:root\s*{[^}]*--glass-intensity:\s*0;/)
    expect(material).not.toMatch(/:root\s*{[^}]*--glass-intensity:\s*0\.6;/)
    expect(layers).not.toMatch(/:root\s*{[^}]*--glass-intensity:\s*0\.6;/)
  })
  it('SE accents blur uses chrome-glass-blur; non-SE keeps 8px + 24px * intensity', () => {
    expect(material).toMatch(/\.glass-surface\s*{[^}]*--glass-blur:\s*calc\(8px \+ 24px \* var\(--glass-intensity\)\)/)
    expect(material).toMatch(
      /html\[data-ui-profile="super-engineering"\]\[data-glass-accents\][^{]*{[\s\S]*?--glass-blur:\s*calc\(var\(--chrome-glass-blur/,
    )
  })
  it('is scoped to super-engineering + data-glass-accents (not arc-glass theme)', () => {
    for (const rule of skin.split('}').filter((r) => r.includes('{') && !r.trim().startsWith('@') && !/^\s*(from|to)\b/.test(r.split('{')[0].trim())))
      if (!/^\s*(from|to)\s*$/.test(rule.split('{')[0])) {
        expect(rule.split('{')[0]).toContain('html[data-ui-profile="super-engineering"][data-glass-accents]')
        expect(rule.split('{')[0]).not.toContain('data-theme="arc-glass"')
      }
  })
  it('refraction only on static slots on the full tier, never composer or popovers', () => {
    const refr = skin.split('}').filter((r) => r.includes('url(#rox-glass-skin-refraction)'))
    expect(refr.length).toBeGreaterThan(0)
    for (const r of refr) {
      expect(r).toContain('[data-glass="full"]')
      expect(r).not.toMatch(/composer|popover|menu/)
    }
  })
  it('pop-in is scoped to the explicit popover slot, with a symmetric exit', () => {
    expect(skin).not.toMatch(/role="menu"|\.popover-styled/)
    expect(skin).toMatch(/\[data-glass-slot="popover"\]\[data-state="closed"\]\s*{[^}]*rox-glass-pop-out[^}]*--motion-spring-exit/)
  })
  it('accent buttons keep an accent tint and glass buttons get a hover state', () => {
    expect(skin).toMatch(/\[data-glass-tone="accent"\]\s*{[^}]*--glass-fill:\s*var\(--accent\)/)
    expect(skin).toMatch(/:hover[^{]*{[^}]*--glass-hover-boost/)
  })
  it('never transitions or animates filters, and does not override the intensity slider', () => {
    expect(skin).not.toMatch(/transition[^;]*filter/)
    expect(skin).not.toMatch(/--glass-intensity:/)
    const kf = skin.slice(skin.indexOf('@keyframes'))
    expect(kf).not.toMatch(/filter/)
  })
})

const mini = readFileSync(
    join(import.meta.dir, '../../../../../../apps/electron/src/renderer/components/app-shell/MiniSessionSurface.tsx'),
    'utf8',
  )
describe('Rox Mini buttons', () => {
  it('every glass mini button spreads its own useGlassPress (keyboard press feedback)', () => {
    const buttons = mini.match(/<button data-glass-slot="mini-button"[^>]*>/g) ?? []
    expect(buttons.length).toBe(4)
    const spreads = buttons.map((b) => b.match(/\{\.\.\.(\w+Press)\}/)?.[1])
    for (const s of spreads) expect(s).toBeDefined()
    expect(new Set(spreads).size).toBe(4)
    for (const s of spreads) expect(mini).toContain(`const ${s} = useGlassPress`)
  })
  it('accent tone: 90% accent, sheen capped at 8% including hover', () => {
    const accent = skin.match(/\[data-glass-tone="accent"\]\s*{([^}]*)}/)?.[1] ?? ''
    expect(accent).toMatch(/--glass-fill-mix:\s*90%/)
    const spec = Number(accent.match(/--glass-specular-alpha:\s*(\d+)%/)?.[1])
    const hover = Number(skin.match(/\[data-glass-tone="accent"\]:hover[^{]*{[^}]*--glass-hover-boost:\s*(\d+)%/)?.[1])
    expect(spec + hover).toBeLessThanOrEqual(8)
  })
})

describe('glass fills resolve to real colours', () => {
  const uiStyles = readFileSync(join(import.meta.dir, '../../../styles/index.css'), 'utf8')
  it('every --glass-fill references a custom property the design system defines', () => {
    const fills = [...skin.matchAll(/--glass-fill:\s*var\((--[\w-]+)\)/g)].map((m) => m[1])
    expect(fills.sort()).toEqual(['--accent', '--background', '--background', '--popover'].sort())
    for (const v of new Set(fills)) expect(uiStyles).toMatch(new RegExp(`\\s${v}:\\s*[^;]+;`))
  })
  it('send icon colour cannot fall back to white', () => {
    expect(uiStyles).toMatch(/--accent-foreground:\s*var\(--canvas\)/)
    expect(mini).toContain('text-[var(--glass-accent-ink,var(--accent-foreground,var(--canvas-opaque)))]')
    const accent = skin.match(/\[data-glass-tone="accent"\]\s*{([^}]*)}/)?.[1] ?? ''
    expect(accent).toMatch(/--glass-accent-ink:\s*rgb\(from var\(--background[^;]*\/ 1\)/)
    expect(mini).not.toMatch(/accent-foreground,white/)
  })
  it('no --primary anywhere in the glass work', () => {
    expect(skin).not.toMatch(/--primary/)
    expect(mini).not.toMatch(/bg-primary|primary-foreground/)
  })
  it('readable surfaces never drop below 70%', () => {
    for (const slot of ['popover', 'composer']) {
      const rule = skin.match(new RegExp(`\\[data-glass-slot="${slot}"\\]\\s*{([^}]*)}`))?.[1] ?? ''
      expect(rule).toMatch(/--glass-fill-mix:\s*max\(70%/)
    }
  })
})
