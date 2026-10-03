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
  it('keeps the rounded desktop stack on its shared 4px inset', () => {
    expect(constants).toContain('export const PANEL_STACK_TOP_INSET = 4')
    expect(constants).toContain('export const PANEL_STACK_BOTTOM_INSET = 0')
    expect(constants).toContain('export const PANEL_STACK_VERTICAL_OVERFLOW = 0')

    const collapsedStart = inspector.indexOf('if (chromeCollapsed)')
    const collapsedReturn = inspector.indexOf('return (', collapsedStart)
    const expandedReturn = inspector.indexOf('return (', collapsedReturn + 1)
    const collapsed = inspector.slice(collapsedStart, expandedReturn)
    const expanded = inspector.slice(expandedReturn)

    expect(expanded).toContain('rox-shell-divider-l')
    expect(expanded).not.toContain('rounded-lg')
    expect(expanded).not.toContain('mt-0.5 mb-0.5')
    expect(expanded).not.toContain('shadow-middle')
    expect(expanded).toContain('overflow-hidden')

    expect(collapsed).not.toContain('mt-1 mb-1')
    expect(collapsed).not.toContain('mr-0.5')
    expect(collapsed).toContain('h-full')
    expect(collapsed).toContain('w-[28px]')
    expect(collapsed).toContain('rox-shell-divider-l')
    expect(collapsed).toContain('data-inspector="collapsed"')

    const desktop = stack.slice(stack.indexOf('DESKTOP BRANCH'))
    expect(desktop).toContain('paddingTop: PANEL_STACK_TOP_INSET')
    expect(desktop).toMatch(/paddingBottom:\s*PANEL_STACK_(TOP|BOTTOM)_INSET/)
    expect(desktop).not.toContain('marginBottom: -PANEL_STACK_BOTTOM_INSET')
    expect(desktop).not.toContain('marginBottom: -PANEL_STACK_TOP_INSET')

    expect(host).toContain('<BottomTerminalDock />')
    expect(host).toContain('<RetainedSurface visible={!inspectorSuppressed && (chrome.showInspector || inspectorVisible || chromeCollapsed)}>')
    expect(host).toContain('<InspectorHost />')
    expect(host.indexOf('<BottomTerminalDock />')).toBeLessThan(host.indexOf('<InspectorHost />'))
  })
})
