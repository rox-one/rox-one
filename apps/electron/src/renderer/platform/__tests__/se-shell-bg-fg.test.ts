import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const root = join(import.meta.dir, '../../../../../..')
const css = readFileSync(join(root, 'apps/electron/src/renderer/index.css'), 'utf8')
const ui = readFileSync(join(root, 'packages/ui/src/styles/index.css'), 'utf8')
const themeTs = readFileSync(join(root, 'packages/shared/src/config/theme.ts'), 'utf8')
const railRow = readFileSync(join(root, 'apps/electron/src/renderer/platform/RailRow.tsx'), 'utf8')
const panelHeader = readFileSync(
  join(root, 'apps/electron/src/renderer/components/app-shell/PanelHeader.tsx'),
  'utf8',
)
const modePill = readFileSync(
  join(root, 'apps/electron/src/renderer/components/app-shell/titlebar-mode-pill.css'),
  'utf8',
)
const layers = readFileSync(join(root, 'packages/ui/src/styles/tokens/layers.css'), 'utf8')
const preset = JSON.parse(
  readFileSync(join(root, 'apps/electron/resources/themes/super-engineering.json'), 'utf8'),
)

const marker = '/* Rox Engineering shared shell frame / root + chrome text.'
const start = css.indexOf(marker)
const seBlock = start < 0 ? '' : css.slice(start, start + 2800)
const seBare = seBlock.replace(/\/\*[\s\S]*?\*\//g, '')

describe('SE shared shell bg/fg (canon #0d0d0f / #e8eaed)', () => {
  it('preset background/foreground tokens match Rox Engineering canon', () => {
    expect(preset.name).toBe('Rox Engineering')
    expect(preset.uiProfile).toBe('super-engineering')
    expect(preset.background).toBe('#0d0d0f')
    expect(preset.foreground).toBe('#e8eaed')
    expect(preset.dark?.background).toBe('#0d0d0f')
    expect(preset.dark?.foreground).toBe('#e8eaed')
  })

  it('themeToCSS maps background/foreground to CSS vars', () => {
    expect(themeTs).toContain('vars.push(`--background: ${colors.background};`)')
    expect(themeTs).toContain('vars.push(`--foreground: ${colors.foreground};`)')
  })

  it('packages/ui aliases text-primary and frame-fg to --foreground', () => {
    expect(ui).toMatch(/--text-primary:\s*var\(--foreground\)/)
    expect(layers).toMatch(/--frame-fg:\s*var\(--foreground\)/)
    expect(layers).toMatch(/--content-fg:\s*var\(--foreground\)/)
  })

  it('shared chrome label sources exist (rail label, panel h1, mode pill)', () => {
    expect(railRow).toContain('rox-rail-label')
    expect(panelHeader).toContain('data-layout="panel-header"')
    expect(panelHeader).toMatch(/<h1[\s\S]*text-text-primary/)
    expect(modePill).toContain('color: var(--foreground)')
  })

  it('SE CSS pins window root to --background (no raw hex)', () => {
    expect(start).toBeGreaterThanOrEqual(0)
    expect(seBlock).toContain('html[data-ui-profile="super-engineering"]')
    expect(seBare).toContain('background: var(--background)')
    expect(seBare).toContain(':is(body, #root)')
    expect(seBare).toContain(':not([data-scenic])')
    expect(seBare).toContain(':not([data-shell-material="vibrancy"])')
    expect(seBare).toContain(':not([data-shell-material="mica"])')
    expect(seBare).toContain(':not([data-wallpaper])')
    expect(seBare).not.toMatch(/#[0-9a-fA-F]{3,8}/)
  })

  it('SE CSS pins frame/content fg + chrome labels to --foreground', () => {
    expect(seBare).toContain('--frame-fg: var(--foreground)')
    expect(seBare).toContain('--content-fg: var(--foreground)')
    expect(seBare).toContain('.rox-rail-row:not([aria-disabled="true"]):not([aria-current="page"]) .rox-rail-label')
    expect(seBare).toContain('.rox-mode-pill-item[aria-current="page"]')
    expect(seBare).toContain('[data-layout="panel-header"] h1')
    expect(seBare).toContain('color: var(--foreground)')
  })

  it('keeps scenic / vibrancy / mica / wallpaper out of the root pin', () => {
    // Wallpaper path stays transparent so L0 can paint; native materials stay clear.
    expect(seBare).toContain('data-wallpaper')
    expect(seBare).toContain('data-shell-material="vibrancy"')
    expect(seBare).toContain('data-shell-material="mica"')
    expect(seBare).toContain('data-scenic')
  })

  it('does not rewrite prior SE surface / motion pins', () => {
    expect(css).toContain('background: var(--navigator)')
    expect(css).toContain('background: var(--paper)')
    expect(css).toContain('background: var(--input-surface)')
    expect(css).toContain('--se-shell-press-scale')
    expect(css).toContain('--se-shell-focus-ring')
    expect(seBare).not.toContain('--navigator')
    expect(seBare).not.toContain('--paper')
    expect(seBare).not.toContain('--input-surface')
    expect(seBare).not.toContain('--se-shell-press-scale')
    expect(seBare).not.toContain('--se-shell-focus-ring')
    expect(seBare).not.toContain('transform:')
    expect(seBare).not.toContain('box-shadow:')
    expect(seBare).not.toContain('backdrop-filter')
  })
})
