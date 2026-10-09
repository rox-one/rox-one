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
    // The tablist is owned by the shared primitive now (W1.1); SurfaceTabs
    // renders no tablist markup of its own.
    expect(surfaceTabsSource).toContain("from '@/components/ui/tabs'")
    expect(surfaceTabsSource).not.toContain('role="tablist"')
    expect(osBrowserTabsSource).toContain('export function osBrowserSurfaceTabs')
  })

  it('renders a collapsed restore strip in InspectorHost', () => {
    expect(inspectorHostSource).toContain('if (chromeCollapsed) {')
    expect(inspectorHostSource).not.toContain('return null')
    expect(inspectorHostSource).toContain('data-inspector="collapsed"')
    // One terminal entry point: the rail/panel chrome (no duplicate TopBar button).
    expect(inspectorHostSource).not.toContain('{terminalControl}')
    expect(topBarSource).not.toContain('data-testid="bottom-terminal-toggle"')
    expect(topBarSource).not.toContain('resolveBottomTerminalToggle')
  })
})
