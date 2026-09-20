import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const platformDir = join(import.meta.dir, '..')
const inspector = readFileSync(join(platformDir, 'InspectorHost.tsx'), 'utf8')
const host = readFileSync(join(platformDir, 'WorkspaceSurfaceHost.tsx'), 'utf8')
const stack = readFileSync(
  join(platformDir, '..', 'components', 'app-shell', 'PanelStackContainer.tsx'),
  'utf8',
)
const constants = readFileSync(
  join(platformDir, '..', 'components', 'app-shell', 'panel-constants.ts'),
  'utf8',
)

describe('panel inset alignment', () => {
  it('matches inspector and desktop stack top/bottom gaps at 8px', () => {
    expect(constants).toContain('export const PANEL_STACK_TOP_INSET = 8')
    expect(constants).toContain('export const PANEL_STACK_BOTTOM_INSET = 8')
    expect(constants).toContain('export const PANEL_STACK_VERTICAL_OVERFLOW = 0')

    const collapsedStart = inspector.indexOf('if (chromeCollapsed)')
    const collapsedReturn = inspector.indexOf('return (', collapsedStart)
    const expandedReturn = inspector.indexOf('return (', collapsedReturn + 1)
    const collapsed = inspector.slice(collapsedStart, expandedReturn)
    const expanded = inspector.slice(expandedReturn)

    expect(expanded).toContain('rounded-xl')
    expect(expanded).toContain('mt-2 mb-2')
    expect(expanded).toContain('mr-2')
    expect(expanded).toContain('overflow-hidden')

    expect(collapsed).toContain('mt-2 mb-2 mr-2')
    expect(collapsed).toContain('rounded-md')
    expect(collapsed).toContain('data-inspector="collapsed"')

    const desktop = stack.slice(stack.indexOf('DESKTOP BRANCH'))
    expect(desktop).toContain('paddingTop: PANEL_STACK_TOP_INSET')
    expect(desktop).toMatch(/paddingBottom:\s*PANEL_STACK_(TOP|BOTTOM)_INSET/)
    expect(desktop).not.toContain('marginBottom: -PANEL_STACK_BOTTOM_INSET')
    expect(desktop).not.toContain('marginBottom: -PANEL_STACK_TOP_INSET')

    expect(host).toContain('<BottomTerminalDock />')
    expect(host).toContain('(chrome.showInspector || inspectorVisible) && <InspectorHost />')
    expect(host.indexOf('<BottomTerminalDock />')).toBeLessThan(host.indexOf('<InspectorHost />'))
  })
})
