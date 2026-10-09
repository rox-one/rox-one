/**
 * Zed-parity blurred material: the `mode:'blurred'` outputs (`data-blurred`,
 * `--theme-mode`) are wired into the material layer, and the electron/web CSS
 * consumes the translucent tiers + the haze scanline overlay. Source-text +
 * selector assertions, mirroring the render-profile CSS contract test.
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ZED_BLURRED_MATERIAL } from '@config/theme'

const renderer = join(import.meta.dir, '../..')
const repo = join(renderer, '../../../..')
const css = readFileSync(join(renderer, 'index.css'), 'utf8')
const cssRules = css.replace(/\/\*[\s\S]*?\*\//g, '')
const tokens = readFileSync(join(repo, 'packages/ui/src/styles/tokens/material.css'), 'utf8')
const themeContext = readFileSync(join(renderer, 'context/ThemeContext.tsx'), 'utf8')

/** Rule bodies whose selector contains `needle`. */
function rulesFor(needle: string): string[] {
  const out: string[] = []
  const re = /([^{}]+)\{([^{}]*)\}/g
  for (const m of cssRules.matchAll(re)) {
    if (m[1].includes(needle)) out.push(`${m[1].trim()} { ${m[2].trim()} }`)
  }
  return out
}

describe('blurred mode wiring', () => {
  it('drives the material layer from the resolved theme mode and preset hints', () => {
    expect(themeContext).toContain('mode: resolvedTheme.mode')
    expect(themeContext).toContain('surfaces: resolvedTheme.surfaces')
    expect(themeContext).toMatch(/resolveMaterial\(resolvedTheme\.material,/)
  })

  it('sets data-material=on for an auto-activated blurred theme (via resolvedMaterial)', () => {
    // The attribute is driven by the resolver result, which auto-enables the
    // layer for `mode:'blurred'` — that is the actual on-switch.
    expect(themeContext).toContain("root.dataset.material = 'on'")
    expect(themeContext).toMatch(/if \(resolvedTheme\.mode === 'blurred'\)/)
    expect(themeContext).toContain("root.dataset.blurred = 'true'")
  })

  it('consumes the data-blurred marker in CSS', () => {
    const rules = rulesFor('[data-blurred="true"]')
    expect(rules.join('\n')).toContain('background: var(--canvas);')
    // Reading surfaces stay opaque; the web canvas clears for the wallpaper.
    expect(rules.join('\n')).toMatch(/\[data-blurred="true"\]\[data-material="on"\]/)
    expect(rules.join('\n')).toContain('body, #root')
  })
})

describe('haze scanline overlay', () => {
  it('paints a static overlay on the chat surface only', () => {
    const rules = rulesFor('[data-material-haze-overlay]')
    const overlay = rules.find(rule => rule.includes('::after') && rule.includes('--material-haze-overlay-active'))
    expect(overlay).toBeDefined()
    expect(overlay!).toContain('[data-focus-zone="chat"]')
    expect(overlay!).toContain('pointer-events: none')
    expect(overlay!).toContain('background-image: var(--material-texture-scanlines)')
    // Empty chat uses the softer MonoCode empty opacity.
    expect(rules.some(rule => rule.includes('--material-haze-overlay-empty'))).toBe(true)
    // No animation on the overlay (invariant: blur/effects never animate).
    const overlayBody = rules.filter(rule => rule.includes('::after')).join('\n')
    expect(overlayBody).not.toContain('animation')
  })

  it('gates the overlay under the a11y/performance/forced-colors resets', () => {
    expect(cssRules).toMatch(/\[data-contrast="high"\][\s\S]*\[data-material-haze-overlay\][\s\S]*\{[^}]*display: none/)
    expect(cssRules).toMatch(/\[data-render-profile="performance"\][\s\S]*\[data-material-haze-overlay\]/)
    expect(cssRules).toMatch(/@media \(forced-colors: active\) \{[\s\S]*\[data-material-haze-overlay\]/)
    expect(cssRules).toMatch(/@media \(prefers-reduced-transparency: reduce\), \(prefers-contrast: more\) \{[\s\S]*\[data-material-haze-overlay\]/)
  })

  it('defines the overlay and blur-mask tokens in the token file only', () => {
    for (const token of [
      '--material-haze-overlay-empty:',
      '--material-haze-overlay-active:',
      '--material-haze-mask-blur-soft:',
      '--material-haze-mask-blur-strong:',
      '--material-haze-mask-blur-soft-active:',
      '--material-haze-mask-blur-strong-active:',
    ]) {
      expect(tokens).toContain(token)
    }
    // The browser-only blur path is behind a supports query (no electron blur)
    // and uses the soft+strong masks with their active variants.
    expect(cssRules).toMatch(/@supports [^{]*\{[\s\S]*--material-haze-mask-blur-soft/)
    expect(cssRules).toMatch(/--material-haze-mask-blur-soft-active[\s\S]*--material-haze-mask-blur-strong-active/)
    expect(cssRules).toMatch(/empty-chat-welcome[\s\S]*--material-haze-mask-blur-strong\)/)
  })
})

describe('zed-blurred profile', () => {
  it('keeps the chrome/panel tiers translucent and reading panes opaque', () => {
    expect(ZED_BLURRED_MATERIAL.enabled).toBe(true)
    expect(ZED_BLURRED_MATERIAL.deepGlass).toBeUndefined()
    expect(ZED_BLURRED_MATERIAL.opacity?.navigator).toBeLessThan(1)
    expect(ZED_BLURRED_MATERIAL.opacity?.topbar).toBeLessThan(1)
  })
})

describe('A7 glass polish', () => {
  /** Rule bodies (not selectors) whose text contains `needle`. */
  function rulesForBody(needle: string): string[] {
    const out: string[] = []
    for (const m of cssRules.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (m[2].includes(needle)) out.push(`${m[1].trim()} { ${m[2].trim()} }`)
    }
    return out
  }

  it('defines the chrome muted-text mix and the light glass lift in the token file only', () => {
    expect(tokens).toContain('--material-chrome-muted-mix:')
    expect(tokens).toContain('--material-light-tint-lift:')
    // Light palettes lift the glass; dark palettes reset to zero.
    expect(tokens).toMatch(/html\.dark\s*\{[\s\S]*--material-light-tint-lift:\s*0/)
  })

  it('strengthens chrome muted text only under the material layer', () => {
    const muted = rulesForBody('--material-chrome-muted-mix')
    expect(muted.length).toBe(1)
    expect(muted[0]).toContain('[data-material="on"]')
    expect(muted[0]).toContain('.chrome-strip')
    expect(muted[0]).toContain('--text-muted:')
    expect(muted[0]).toContain('--muted-foreground:')
  })

  it('adds the light tint lift to the material glass lightness only', () => {
    const lifted = rulesForBody('--material-light-tint-lift')
    expect(lifted.length).toBeGreaterThan(0)
    for (const rule of lifted) expect(rule).toContain('[data-material="on"]')
    // The static (non-material) glass tier keeps no lift.
    const staticGlass = rulesForBody('rgb(from var(--surface-titlebar')
    expect(staticGlass.length).toBeGreaterThan(0)
    for (const rule of staticGlass) expect(rule).not.toContain('--material-light-tint-lift')
  })
})