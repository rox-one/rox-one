import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const root = join(import.meta.dir, '../../../../../..')
const css = readFileSync(join(root, 'apps/electron/src/renderer/index.css'), 'utf8')
const pill = readFileSync(
  join(root, 'apps/electron/src/renderer/components/app-shell/titlebar-mode-pill.css'),
  'utf8',
)
const layout = readFileSync(
  join(root, 'apps/electron/src/renderer/components/app-shell/mode-pill-layout.ts'),
  'utf8',
)
const allScreens = readFileSync(
  join(root, 'apps/electron/src/renderer/platform/AllScreensMenu.tsx'),
  'utf8',
)
const modeBar = readFileSync(join(root, 'apps/electron/src/renderer/platform/ModeBar.tsx'), 'utf8')

const marker = '/* Rox Engineering mode-pill density (radius 8).'
const start = css.indexOf(marker)
const density = start < 0 ? '' : css.slice(start)
const densityBare = density.replace(/\/\*[\s\S]*?\*\//g, '')

describe('SE mode-pill density + overflow (shared chrome)', () => {
  it('scopes radius-8 density to Rox Engineering only', () => {
    expect(start).toBeGreaterThanOrEqual(0)
    expect(density).toContain('html[data-ui-profile="super-engineering"]')
    expect(densityBare).toContain('.rox-mode-pill')
    expect(densityBare).toContain('.rox-mode-pill-item')
    expect(densityBare).toContain('.rox-mode-pill-indicator')
    expect(densityBare).toContain('border-radius: var(--radius-md)')
    // Base titlebar CSS stays capsule for non-SE profiles.
    expect(pill).toMatch(/\.rox-mode-pill\s*\{[^}]*border-radius:\s*var\(--radius-full\)/)
    expect(pill).toMatch(/\.rox-mode-pill-item\s*\{[^}]*border-radius:\s*var\(--radius-full\)/)
    expect(pill).toMatch(/\.rox-mode-pill-indicator\s*\{[^}]*border-radius:\s*var\(--radius-full\)/)
    // Counters keep the full token (badge role); density block must not retarget them.
    expect(densityBare).not.toContain('rox-mode-pill-badge')
  })

  it('does not invent a second overflow system', () => {
    expect(layout).toContain('export function resolveModePillLayout')
    expect(layout).toContain('visibleCount')
    expect(modeBar).toContain('AllScreensMenu')
    expect(modeBar).toContain('foldPills')
    expect(allScreens).toContain('className="rox-mode-pill-item titlebar-no-drag"')
    expect(allScreens).toContain('data-all-screens-trigger')
    // Density CSS is chrome-only — no new overflow helpers.
    expect(densityBare).not.toMatch(/overflow|fold|visibleCount|AllScreens/)
  })

  it('keeps SE motion/focus contracts for pills (no resize jank)', () => {
    // #2210/#2211 already wire press + focus + indicator onto --motion-*
    // (0 under data-resizing). Density must not reintroduce bare ms.
    expect(css).toContain(
      'html[data-ui-profile="super-engineering"] .rox-mode-pill[data-ready] .rox-mode-pill-indicator',
    )
    expect(css).toMatch(
      /html\[data-ui-profile="super-engineering"\][\s\S]*\.rox-mode-pill-item[\s\S]*:focus-visible/,
    )
    const ms = [...densityBare.matchAll(/\b(\d+)ms\b/g)].map((m) => m[1])
    expect(ms).toEqual([])
    expect(densityBare).not.toMatch(/#[0-9a-fA-F]{3,8}/)
  })
})
