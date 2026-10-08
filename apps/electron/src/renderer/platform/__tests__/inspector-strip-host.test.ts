import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const platformDir = join(import.meta.dir, '..')
const host = readFileSync(join(platformDir, 'WorkspaceSurfaceHost.tsx'), 'utf8')
const inspector = readFileSync(join(platformDir, 'InspectorHost.tsx'), 'utf8')

describe('ship-rox-inspector-strip-host', () => {
  it('keeps InspectorHost mounted when R-collapsed even if visible/chrome flags are off', () => {
    expect(host).toContain('inspectorChromeCollapsedAtom')
    expect(host).toContain('<RetainedSurface visible={!inspectorSuppressed && (chrome.showInspector || inspectorVisible || chromeCollapsed)}>')
    expect(host).toContain('<InspectorHost />')
    expect(host).not.toContain('(chrome.showInspector || inspectorVisible) && <InspectorHost />')
  })

  it('renders a full-height 28px collapsed strip without vertical margins that fight h-full', () => {
    const start = inspector.indexOf('if (chromeCollapsed)')
    const collapsedReturn = inspector.indexOf('return (', start)
    const expandedReturn = inspector.indexOf('return (', collapsedReturn + 1)
    const collapsed = inspector.slice(start, expandedReturn)
    expect(collapsed).toContain('data-inspector="collapsed"')
    expect(collapsed).toContain('w-[28px]')
    expect(collapsed).toContain('h-full')
    // Flush strip with a single left hairline (one-surface shell).
    expect(collapsed).toContain('rox-shell-divider-l')
    expect(collapsed).not.toContain('mr-0.5')
    expect(collapsed).not.toContain('rounded-lg')
    expect(collapsed).not.toMatch(/mt-1 mb-1/)
  })

  it('renders the terminal inside the panel stack so it stays reachable when R is collapsed', () => {
    const stack = readFileSync(join(platformDir, '..', 'components', 'app-shell', 'PanelStackContainer.tsx'), 'utf8')
    expect(host).not.toContain('BottomTerminalDock')
    expect(stack).toContain('<TerminalPanel autoFocus=')
    expect(inspector).not.toContain('data-testid="bottom-terminal-toggle"')
  })
})
