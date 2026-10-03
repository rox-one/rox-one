import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Rounded-panel shell (Mark, 2026-09-29): every shell pane is a flat,
 * borderless rounded box (`--rox-radius-panel` 10px) separated by a 4px
 * PANEL_GAP / edge inset so the rounding reads against the background.
 * No outlines or shadows; high contrast gets an inset 1px ring.
 */
const appShell = join(import.meta.dir, '..')
const platform = join(import.meta.dir, '../../../platform')
const stack = readFileSync(join(appShell, 'PanelStackContainer.tsx'), 'utf8')
const slot = readFileSync(join(appShell, 'PanelSlot.tsx'), 'utf8')
const rail = readFileSync(join(platform, 'ActivityRail.tsx'), 'utf8')
const inspector = readFileSync(join(platform, 'InspectorHost.tsx'), 'utf8')
const constants = readFileSync(join(appShell, 'panel-constants.ts'), 'utf8')
const sidebarChrome = readFileSync(join(appShell, 'SidebarChrome.tsx'), 'utf8')
const uiCss = readFileSync(join(import.meta.dir, '../../../../../../../packages/ui/src/styles/index.css'), 'utf8')
const rendererCss = readFileSync(join(import.meta.dir, '../../../index.css'), 'utf8')

describe('one-surface shell', () => {
  it('rounded panels sit on a 4px gap/inset grid', () => {
    expect(constants).toContain('export const RADIUS_EDGE = 8')
    expect(constants).toContain('export const RADIUS_INNER = 8')
    expect(constants).toContain('export const PANEL_GAP = 4')
    expect(constants).toContain('export const PANEL_EDGE_INSET = 4')
    expect(constants).toContain('export const CENTER_MIN_WIDTH = 420')
  })

  it('renders sidebar and navigator as flush panes with a hairline divider', () => {
    const desktop = stack.slice(stack.indexOf('DESKTOP BRANCH'))
    const sidebar = desktop.slice(desktop.indexOf('data-panel-role="sidebar"'), desktop.indexOf('data-panel-role="navigator"'))
    expect(sidebar).toContain('rox-shell-pane')
    expect(sidebar).toContain('rox-shell-divider-r')
    expect(sidebar).not.toContain('rox-panel')
    expect(sidebar).not.toContain('shadow-middle')
    expect(sidebar).not.toContain('borderTopLeftRadius')
    expect(stack).not.toContain('RADIUS_EDGE')
  })

  it('content panels are flush, divided only in split view', () => {
    expect(slot).toContain("'rox-shell-pane'")
    expect(slot).toContain("sash && 'rox-shell-divider-l'")
    expect(slot).not.toContain('borderTopLeftRadius')
    expect(slot).not.toContain("'shadow-middle z-0'")
  })

  it('activity rail and inspector are flush with dividers, not boxes', () => {
    expect(rail).toContain('data-shell-role="activity-rail"')
    expect(rail).toContain('rox-shell-divider-r')
    expect(rail).not.toContain('rounded-lg')
    expect(rail).not.toContain('shadow-middle')
    expect(inspector).not.toContain('borderRadius: RADIUS_EDGE')
    expect(inspector).not.toContain('shadow-middle')
    expect(inspector).toContain('data-inspector="collapsed"')
  })

  it('account card is a flat row (no rox-card outline)', () => {
    expect(sidebarChrome).not.toContain('rox-card')
  })

  it('defines divider tokens for standard and high contrast', () => {
    expect(uiCss).toContain('--rox-shell-divider: color-mix(in oklch, var(--foreground) 6%, transparent);')
    expect(uiCss).toContain('--rox-shell-divider: color-mix(in oklch, var(--foreground) 10%, transparent);')
    expect(uiCss).toContain('--rox-radius-panel: 10px;')
    expect(uiCss).toMatch(/\.rox-shell-pane\s*\{[^}]*border-radius:\s*var\(--rox-radius-panel\);[^}]*box-shadow:\s*none;/)
    expect(uiCss).toMatch(/html\[data-contrast="high"\] \.rox-shell-pane\s*\{[^}]*inset 0 0 0 1px/)
    expect(rendererCss).toContain('html[data-scenic] .rox-shell-pane')
  })
})
