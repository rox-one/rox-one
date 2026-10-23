import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const root = join(import.meta.dir, '../../../../../..')
const css = readFileSync(join(root, 'apps/electron/src/renderer/index.css'), 'utf8')
const ui = readFileSync(join(root, 'packages/ui/src/styles/index.css'), 'utf8')
const layers = readFileSync(join(root, 'packages/ui/src/styles/tokens/layers.css'), 'utf8')
const themeTs = readFileSync(join(root, 'packages/shared/src/config/theme.ts'), 'utf8')
const panelSlot = readFileSync(
  join(root, 'apps/electron/src/renderer/components/app-shell/PanelSlot.tsx'),
  'utf8',
)
const panelStack = readFileSync(
  join(root, 'apps/electron/src/renderer/components/app-shell/PanelStackContainer.tsx'),
  'utf8',
)
const preset = JSON.parse(
  readFileSync(join(root, 'apps/electron/resources/themes/super-engineering.json'), 'utf8'),
)

const marker = '/* Rox Engineering shared floating content card / PanelSlot chrome.'
const start = css.indexOf(marker)
const seBlock = start < 0 ? '' : css.slice(start, start + 2200)
const seBare = seBlock.replace(/\/\*[\s\S]*?\*\//g, '')

describe('SE shared paper surface (canon #141416 → --paper)', () => {
  it('preset paper token is #141416 under Rox Engineering', () => {
    expect(preset.name).toBe('Rox Engineering')
    expect(preset.uiProfile).toBe('super-engineering')
    expect(preset.paper).toBe('#141416')
    expect(preset.dark?.paper).toBe('#141416')
  })

  it('themeToCSS maps theme.paper to --paper', () => {
    expect(themeTs).toContain("vars.push(`--paper: ${colors.paper || bg};`)")
    expect(themeTs).toMatch(/paper:\s*'paper'/)
  })

  it('packages/ui aliases --surface-elevated to --paper', () => {
    expect(ui).toMatch(/--surface-elevated:\s*var\(--paper\)/)
  })

  it('float-join card paints from --content-bg; PanelSlot is shared content chrome', () => {
    expect(layers).toContain('html[data-content-join="float"] [data-panel-grid-viewport]')
    expect(layers).toContain('background: var(--content-bg)')
    expect(panelSlot).toContain('data-panel-role="content"')
    expect(panelSlot).toContain('data-shell-role="content"')
    expect(panelSlot).toContain('rox-shell-pane')
    expect(panelStack).toContain('data-panel-grid-viewport="true"')
  })

  it('SE CSS pins content pane + float card chrome to --paper (no raw hex)', () => {
    expect(start).toBeGreaterThanOrEqual(0)
    expect(seBlock).toContain('html[data-ui-profile="super-engineering"]')
    expect(seBare).toContain('[data-shell-role="content"]')
    expect(seBare).toContain('[data-panel-role="content"]')
    expect(seBare).toContain('[data-panel-grid-viewport]')
    expect(seBare).toContain('[data-content-join="float"]')
    expect(seBare).toContain('--shell-content: var(--paper)')
    expect(seBare).toContain('--content-bg: var(--paper)')
    expect(seBare).toContain('background: var(--paper)')
    expect(seBare).toContain('backdrop-filter: none')
    expect(seBare).not.toMatch(/#[0-9a-fA-F]{3,8}/)
  })

  it('SE wallpaper re-pin keeps solid paper (spot glass via data-glass-accents only)', () => {
    expect(seBlock).toContain('html[data-ui-profile="super-engineering"][data-wallpaper]')
    const wall = seBare.slice(seBare.indexOf('data-wallpaper'))
    expect(wall).toContain('background: var(--paper)')
    expect(wall).toContain('backdrop-filter: none')
  })

  it('keeps #2199 ultra-wide paper max and #2213 panel measure wiring', () => {
    expect(css).toContain('--shell-paper-max: 1600px')
    expect(css).toContain('--shell-paper-max: 1800px')
    expect(css).toContain('[data-content-join="float"]')
    expect(panelSlot).toContain('rox-panel-gutter')
    expect(panelSlot).toContain('rox-panel-measure')
    expect(panelSlot).toContain('applyPanelMeasure')
    // Paper block must not rewrite ultra-wide / measure tokens.
    expect(seBare).not.toContain('--shell-paper-max')
    expect(seBare).not.toContain('--panel-gutter')
    expect(seBare).not.toContain('--panel-measure')
    expect(seBare).not.toContain('rox-panel-gutter')
  })

  it('does not touch #2210/#2211 motion or focus rings', () => {
    expect(css).toContain('--se-shell-press-scale')
    expect(css).toContain('--se-shell-focus-ring')
    expect(seBare).not.toContain('--se-shell-press-scale')
    expect(seBare).not.toContain('--se-shell-focus-ring')
    expect(seBare).not.toContain('transform:')
    expect(seBare).not.toContain('box-shadow:')
  })
})
