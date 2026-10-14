import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { SHELL_BREAKPOINTS } from '../viewport-band'
import { RAIL_AUTO_COLLAPSE_BELOW, railStateFor, resolveRailCollapsed } from '../ActivityRail'
import { VIEWPORT_THREE_PANE } from '../viewport-band'

const root = join(import.meta.dir, '../../../../../..')
const chrome = readFileSync(join(root, 'packages/ui/src/styles/tokens/chrome.css'), 'utf8')
const css = readFileSync(join(root, 'apps/electron/src/renderer/index.css'), 'utf8')
const railRow = readFileSync(join(import.meta.dir, '../RailRow.tsx'), 'utf8')

describe('rail breakpoints', () => {
  it('JS breakpoints mirror the --shell-bp-* tokens', () => {
    for (const [name, px] of Object.entries(SHELL_BREAKPOINTS)) {
      expect(chrome).toContain(`--shell-bp-${name}: ${px}px;`)
    }
    expect(Object.values(SHELL_BREAKPOINTS)).toEqual([900, 1280, 1600, 2560])
  })
  it('rail is icons-only below the regular breakpoint unless the user overrides', () => {
    expect(RAIL_AUTO_COLLAPSE_BELOW).toBe(SHELL_BREAKPOINTS.regular)
    const narrowAt = (w: number) => w < RAIL_AUTO_COLLAPSE_BELOW
    expect(resolveRailCollapsed({ persisted: false, narrow: narrowAt(1279), override: false })).toBe(true)
    expect(resolveRailCollapsed({ persisted: false, narrow: narrowAt(1280), override: false })).toBe(false)
    expect(resolveRailCollapsed({ persisted: false, narrow: narrowAt(1600), override: false })).toBe(false)
    expect(resolveRailCollapsed({ persisted: true, narrow: narrowAt(2560), override: false })).toBe(true)
  })
  it('regular breakpoint is the three-pane viewport band', () => {
    expect(SHELL_BREAKPOINTS.regular).toBe(VIEWPORT_THREE_PANE)
  })
  it('labels animate only on collapsed -> expanded, never on mount', () => {
    expect(railStateFor(null, false)).toBe('expanded') // mount expanded: no animation
    expect(railStateFor(null, true)).toBe('collapsed')
    expect(railStateFor(true, false)).toBe('expanding') // the one disclosure
    expect(railStateFor(false, false)).toBe('expanded')
    expect(railStateFor(false, true)).toBe('collapsed')
  })
  it('entrance is scoped to the expanding state, opacity/transform only on the disclosure token', () => {
    expect(railRow).toContain('rox-rail-label')
    const rule = css.slice(css.indexOf('[data-rail-state="expanding"] .rox-rail-label {'))
    expect(rule.slice(0, rule.indexOf('}'))).toContain('var(--motion-disclosure)')
    // No bare .rox-rail-label animation (would replay on every mount).
    expect(css).not.toMatch(/(^|\n)\.rox-rail-label \{/)
    const kf = css.slice(css.indexOf('@keyframes rox-rail-label-in'))
    const body = kf.slice(0, kf.indexOf('}\n}') + 1)
    expect(new Set([...body.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]))).toEqual(new Set(['opacity', 'transform']))
  })
  it('resizing never toggles the animation-name (no restart after resize)', () => {
    expect(css.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/data-resizing\][^{}]*\.rox-rail-label/)
  })
})
