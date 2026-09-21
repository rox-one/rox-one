import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const platformDir = join(import.meta.dir, '..')
const host = readFileSync(join(platformDir, 'WorkspaceSurfaceHost.tsx'), 'utf8')
const inspector = readFileSync(join(platformDir, 'InspectorHost.tsx'), 'utf8')

describe('ship-rox-inspector-strip-host', () => {
  it('keeps InspectorHost mounted when R-collapsed even if visible/chrome flags are off', () => {
    expect(host).toContain('inspectorChromeCollapsedAtom')
    expect(host).toContain('(chrome.showInspector || inspectorVisible || chromeCollapsed) && <InspectorHost />')
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
    expect(collapsed).toContain('mr-0.5')
    expect(collapsed).not.toMatch(/mt-1 mb-1/)
  })

  it('docks BottomTerminalDock outside InspectorHost so terminal stays reachable when R is collapsed', () => {
    expect(host.indexOf('<BottomTerminalDock />')).toBeLessThan(host.indexOf('<InspectorHost />'))
    expect(inspector).toContain('data-testid="bottom-terminal-toggle"')
  })
})
