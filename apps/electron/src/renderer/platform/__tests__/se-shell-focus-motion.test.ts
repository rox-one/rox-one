import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const root = join(import.meta.dir, '../../../../../..')
const css = readFileSync(join(root, 'apps/electron/src/renderer/index.css'), 'utf8')
const ui = readFileSync(join(root, 'packages/ui/src/styles/index.css'), 'utf8')
const motion = readFileSync(join(root, 'packages/ui/src/styles/tokens/motion.css'), 'utf8')
const pill = readFileSync(
  join(root, 'apps/electron/src/renderer/components/app-shell/titlebar-mode-pill.css'),
  'utf8',
)

const marker = '/* Rox Engineering shell focus rings'
const start = css.indexOf(marker)
const seBlock = start < 0 ? '' : css.slice(start)
const seBare = seBlock.replace(/\/\*[\s\S]*?\*\//g, '')

describe('SE shell focus rings + reduced-motion audit', () => {
  it('declares an SE-scoped focus-ring block', () => {
    expect(start).toBeGreaterThanOrEqual(0)
    expect(seBlock).toContain('html[data-ui-profile="super-engineering"]')
    expect(seBare).toContain('.rox-rail-row')
    expect(seBare).toContain('.rox-mode-pill-item')
    expect(seBare).toContain('.panel-header-btn')
    expect(seBare).toContain('.header-icon-btn')
  })

  it('uses SE accent via --focus / --accent (no hardcoded hex ring colour)', () => {
    expect(seBlock).toContain('var(--focus, var(--accent))')
    expect(seBlock).toContain('--se-shell-focus-ring')
    expect(seBare).not.toMatch(/#[0-9a-fA-F]{3,8}/)
  })

  it('applies an inset focus ring on shared shell chrome and clears outline', () => {
    expect(seBare).toMatch(
      /:is\(\s*\.rox-rail-row,\s*\.rox-mode-pill-item,\s*\.panel-header-btn,\s*\.header-icon-btn\s*\):focus-visible/,
    )
    const focusRule = seBare.slice(seBare.indexOf(':focus-visible'))
    const body = focusRule.slice(focusRule.indexOf('{'), focusRule.indexOf('}') + 1)
    expect(body).toContain('outline: none')
    expect(body).toContain('box-shadow: var(--se-shell-focus-ring)')
    expect(body).toContain('transition-property: transform, opacity, color, background-color')
    expect(seBlock).toContain('inset 0 0 0 var(--focus-ring-width, 2px)')
  })

  it('keeps a solid outline under high contrast (no inset shadow)', () => {
    expect(seBlock).toContain('html[data-contrast="high"][data-ui-profile="super-engineering"]')
    const hc = seBare.slice(seBare.indexOf('data-contrast="high"'))
    const body = hc.slice(hc.indexOf('{'), hc.indexOf('}') + 1)
    expect(body).toContain('box-shadow: none')
    expect(body).toMatch(/outline:\s*var\(--focus-ring-width/)
  })

  it('aliases shell-motion tokens onto --motion-* that zero under reduced-motion and resizing', () => {
    expect(seBlock).toContain('--shell-motion-fast: var(--motion-fast)')
    expect(seBlock).toContain('--shell-motion-disclosure: calc(var(--motion-base) + 140ms * var(--motion-spring-scale, 1))')
    expect(motion).toContain('html[data-resizing]')
    expect(motion).toContain('@media (prefers-reduced-motion: reduce)')
    expect(motion).toMatch(/html\[data-resizing\][\s\S]*--motion-fast:\s*0ms/)
    expect(motion).toMatch(/prefers-reduced-motion: reduce[\s\S]*--motion-fast:\s*0ms/)
    expect(motion).toMatch(/html\[data-resizing\][\s\S]*--motion-spring-scale:\s*0/)
    expect(motion).toMatch(/prefers-reduced-motion: reduce[\s\S]*--motion-spring-scale:\s*0/)
  })

  it('rewires SE pill-indicator and zen sidebar-disclosure off hardcoded durations', () => {
    expect(seBlock).toContain('.rox-mode-pill[data-ready] .rox-mode-pill-indicator')
    expect(seBare).toContain('transform var(--motion-disclosure)')
    expect(seBare).toContain('width var(--motion-disclosure)')
    expect(seBare).toContain('opacity var(--motion-fast)')
    expect(seBlock).toContain('[data-shell-style="zen"] .sidebar-disclosure')
    // Shared pill CSS still has legacy ms; SE override must win via profile scope.
    expect(pill).toMatch(/transform\s+220ms/)
    // bare durations forbidden except the spring-scale term that zeros under RM/resize
    const ms = [...seBare.matchAll(/\b(\d+)ms\b/g)].map((m) => m[1])
    expect(ms.every((n) => n === '140')).toBe(true)
    expect(seBare).toContain('140ms * var(--motion-spring-scale')
  })

  it('packages/ui SE profile also aliases shell-motion (no bare 320ms)', () => {
    const seUi = ui.slice(ui.indexOf('html[data-ui-profile="super-engineering"] {'))
    const first = seUi.slice(0, seUi.indexOf('}', seUi.indexOf('--shell-motion')) + 1)
    expect(first).toContain('--shell-motion-fast: var(--motion-fast)')
    expect(first).toContain('--shell-motion-disclosure: calc(var(--motion-base) + 140ms * var(--motion-spring-scale, 1))')
    expect(first).not.toContain('--shell-motion-disclosure: 320ms')
  })
})
