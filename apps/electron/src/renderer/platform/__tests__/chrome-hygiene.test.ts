import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const platformDir = join(import.meta.dir, '..')
const topBarPath = join(platformDir, '..', 'components', 'app-shell', 'TopBar.tsx')

describe('ship-rox-chrome-hygiene', () => {
  const surfaceTabsSource = readFileSync(join(platformDir, 'SurfaceTabs.tsx'), 'utf8')
  const inspectorHostSource = readFileSync(join(platformDir, 'InspectorHost.tsx'), 'utf8')
  const osBrowserTabsSource = readFileSync(join(platformDir, 'os-browser-tabs.ts'), 'utf8')
  const topBarSource = readFileSync(topBarPath, 'utf8')

  it('drops OS BrowserWindow chips from SurfaceTabs embedded-default path', () => {
    expect(surfaceTabsSource).not.toContain('useWorkspaceBrowserWindows({')
    expect(surfaceTabsSource).not.toContain('osBrowserSurfaceTabs(')
    expect(surfaceTabsSource).not.toContain('function OsBrowserWindowControl')
    expect(surfaceTabsSource).toContain('do not mount OS BrowserWindow chips')
    expect(surfaceTabsSource.match(/role="tablist"/g)).toHaveLength(1)
    expect(osBrowserTabsSource).toContain('export function osBrowserSurfaceTabs')
  })

  it('keeps true zero-width R-hide and moves terminal toggle to TopBar when collapsed', () => {
    expect(inspectorHostSource).toContain('<RetainedSurface visible={!chromeCollapsed}>')
    expect(inspectorHostSource).toContain('<RetainedSurface visible={browserVisible}>')
    // Expanded rail still hosts terminalControl once; collapsed must not be the only mount.
    expect(inspectorHostSource.match(/\{terminalControl\}/g)).toHaveLength(1)
    expect(topBarSource).toContain('inspectorChromeCollapsed &&')
    expect(topBarSource).toContain('handleTopBarTerminalToggle')
    expect(topBarSource).toContain('data-testid="bottom-terminal-toggle"')
    expect(topBarSource).toContain('resolveBottomTerminalToggle')
  })
})
