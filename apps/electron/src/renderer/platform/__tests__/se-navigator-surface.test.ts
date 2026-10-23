import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const root = join(import.meta.dir, '../../../../../..')
const css = readFileSync(join(root, 'apps/electron/src/renderer/index.css'), 'utf8')
const ui = readFileSync(join(root, 'packages/ui/src/styles/index.css'), 'utf8')
const themeTs = readFileSync(join(root, 'packages/shared/src/config/theme.ts'), 'utf8')
const activityRail = readFileSync(
  join(root, 'apps/electron/src/renderer/platform/ActivityRail.tsx'),
  'utf8',
)
const panelStack = readFileSync(
  join(root, 'apps/electron/src/renderer/components/app-shell/PanelStackContainer.tsx'),
  'utf8',
)
const appShell = readFileSync(
  join(root, 'apps/electron/src/renderer/components/app-shell/AppShell.tsx'),
  'utf8',
)
const preset = JSON.parse(
  readFileSync(join(root, 'apps/electron/resources/themes/super-engineering.json'), 'utf8'),
)

const marker = '/* Rox Engineering shared ActivityRail / contextual sidebar chrome.'
const start = css.indexOf(marker)
const seBlock = start < 0 ? '' : css.slice(start, start + 1600)
const seBare = seBlock.replace(/\/\*[\s\S]*?\*\//g, '')

describe('SE shared navigator surface (canon #121214 → --navigator)', () => {
  it('preset navigator token is #121214 under Rox Engineering', () => {
    expect(preset.name).toBe('Rox Engineering')
    expect(preset.uiProfile).toBe('super-engineering')
    expect(preset.navigator).toBe('#121214')
    expect(preset.dark?.navigator).toBe('#121214')
  })

  it('themeToCSS maps theme.navigator to --navigator', () => {
    expect(themeTs).toContain("vars.push(`--navigator: ${colors.navigator || bg};`)")
    expect(themeTs).toMatch(/navigator:\s*'navigator'/)
  })

  it('packages/ui aliases --surface-rail to --navigator', () => {
    expect(ui).toMatch(/--surface-rail:\s*var\(--navigator\)/)
  })

  it('ActivityRail and AppShell left chrome use chrome-rail', () => {
    expect(activityRail).toContain("'chrome-rail")
    expect(appShell).toMatch(/className="[^"]*chrome-rail/)
  })

  it('PanelStackContainer sidebar/navigator panes are shared chrome wrappers only', () => {
    expect(panelStack).toContain('data-panel-role="sidebar"')
    expect(panelStack).toContain('data-panel-role="navigator"')
    expect(panelStack).toContain('rox-shell-pane')
    // Pane hosts the slot; surface-owned contents stay in Home/Tasks/Messenger/Calls.
    expect(panelStack).toContain('{sidebarSlot}')
  })

  it('SE CSS pins rail + sidebar/navigator chrome to --navigator (no raw hex)', () => {
    expect(start).toBeGreaterThanOrEqual(0)
    expect(seBlock).toContain('html[data-ui-profile="super-engineering"]')
    expect(seBare).toContain('.chrome-rail')
    expect(seBare).toContain('[data-panel-role="sidebar"]')
    expect(seBare).toContain('[data-panel-role="navigator"]')
    expect(seBare).toContain('background: var(--navigator)')
    expect(seBare).toContain('--chrome-plate-bg: var(--navigator)')
    expect(seBare).toContain('backdrop-filter: none')
    expect(seBare).not.toMatch(/#[0-9a-fA-F]{3,8}/)
  })

  it('SE wallpaper re-pin keeps solid navigator (spot glass via data-glass-accents only)', () => {
    expect(seBlock).toContain('html[data-ui-profile="super-engineering"][data-wallpaper]')
    const wall = seBare.slice(seBare.indexOf('data-wallpaper'))
    expect(wall).toContain('background: var(--navigator)')
    expect(wall).toContain('backdrop-filter: none')
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
