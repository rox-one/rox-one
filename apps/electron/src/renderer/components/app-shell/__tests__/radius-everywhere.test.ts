import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const appShell = join(import.meta.dir, '..')
const platform = join(import.meta.dir, '../../../platform')
const stack = readFileSync(join(appShell, 'PanelStackContainer.tsx'), 'utf8')
const slot = readFileSync(join(appShell, 'PanelSlot.tsx'), 'utf8')
const rail = readFileSync(join(platform, 'ActivityRail.tsx'), 'utf8')
const inspector = readFileSync(join(platform, 'InspectorHost.tsx'), 'utf8')
const constants = readFileSync(join(appShell, 'panel-constants.ts'), 'utf8')

describe('ship-rox-radius-everywhere', () => {
  it('keeps RADIUS_EDGE/INNER at 8px', () => {
    expect(constants).toContain('export const RADIUS_EDGE = 8')
    expect(constants).toContain('export const RADIUS_INNER = 8')
  })

  it('rounds the desktop sidebar chrome (was sharp)', () => {
    const desktop = stack.slice(stack.indexOf('DESKTOP BRANCH'))
    const sidebar = desktop.slice(desktop.indexOf('data-panel-role="sidebar"'), desktop.indexOf('data-panel-role="navigator"'))
    expect(sidebar).toContain('rox-panel')
    expect(sidebar).toContain('borderTopLeftRadius: RADIUS_EDGE')
    expect(sidebar).toContain('borderBottomLeftRadius: RADIUS_EDGE')
    expect(sidebar).toContain('overflow-hidden')
  })

  it('uses edge-aware radii on content PanelSlot (no sharp tops)', () => {
    expect(slot).toContain('borderTopLeftRadius: isAtLeftEdge ? RADIUS_EDGE : RADIUS_INNER')
    expect(slot).toContain('borderTopRightRadius: isAtRightEdge ? RADIUS_EDGE : RADIUS_INNER')
    expect(slot).not.toContain('borderBottomLeftRadius: isCompact ? 0')
  })

  it('frames ActivityRail with rounded chrome', () => {
    expect(rail).toContain('rounded-lg')
    expect(rail).toContain('data-shell-role="activity-rail"')
    expect(rail).toContain('overflow-hidden')
    expect(rail).toContain('bg-background')
  })

  it('rounds inspector outer + collapsed strip', () => {
    expect(inspector).toContain('borderRadius: RADIUS_EDGE')
    expect(inspector).toContain('rounded-lg')
    expect(inspector).toContain("data-inspector=\"collapsed\"")
    const start = inspector.indexOf('data-inspector="collapsed"')
    expect(inspector.slice(start - 280, start)).toContain('rounded-lg')
  })
})
