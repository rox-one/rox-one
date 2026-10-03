import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveModePillLayout } from '../mode-pill-layout'

const rendererDir = join(import.meta.dir, '..', '..', '..')
const read = (rel: string) => readFileSync(join(rendererDir, rel), 'utf8')
const topBar = read('components/app-shell/TopBar.tsx')
const modeBar = read('platform/ModeBar.tsx')
const pillCss = read('components/app-shell/titlebar-mode-pill.css')
const tileMark = read('components/icons/RoxTileMark.tsx')

const metrics = { full: 520, compact: 210 }

describe('titlebar mode pill layout', () => {
  it('keeps labels when both sides have room', () => {
    const layout = resolveModePillLayout({ topbarWidth: 1600, leftInset: 0, leftFixedEdge: 120, rightWidth: 260, metrics })
    expect(layout.collapsed).toBe(false)
    expect(layout.leftMax).toBe(1600 / 2 - 520 / 2 - 12)
  })

  it('collapses to icons when the labelled pill would hit a side group', () => {
    const layout = resolveModePillLayout({ topbarWidth: 1000, leftInset: 0, leftFixedEdge: 120, rightWidth: 260, metrics })
    expect(layout.collapsed).toBe(true)
    expect(layout.leftMax).toBe(500 - 105 - 12)
  })

  it('centers on the window, compensating for the left rail inset', () => {
    const layout = resolveModePillLayout({ topbarWidth: 1552, leftInset: 48, leftFixedEdge: 120, rightWidth: 260, metrics })
    // Window center is 800px; relative to the titlebar that is 752px.
    expect(layout.leftMax).toBe(752 - 260 - 12)
  })
})

describe('titlebar mode pill source contract', () => {
  it('renders every mode in one pill with no overflow menu', () => {
    expect(modeBar).toContain('getModeRegistry().list()')
    expect(modeBar).not.toContain('listPinnedModes')
    expect(modeBar).not.toContain('DropdownMenu')
    expect(modeBar).toContain('rox-mode-pill-indicator')
  })

  it('is no-drag and keeps high contrast accessible', () => {
    expect(pillCss).toContain('-webkit-app-region: no-drag')
    expect(pillCss).not.toMatch(/border:\s*1px/)
    expect(pillCss).toContain('html[data-contrast="high"] .rox-mode-pill-indicator')
  })

  it('mounts the pill centered in the titlebar, outside the left group', () => {
    expect(topBar).toContain('rox-mode-pill-anchor')
    expect(topBar).toContain('calc(50% - ${leftInset / 2}px)')
  })

  it('keeps cost/usage out of the titlebar (balance lives in the profile strip)', () => {
    expect(topBar).not.toContain('workbench.presence.placeholder')
    expect(topBar).not.toContain('workbench.status.usagePlaceholder')
    expect(topBar).not.toContain('workbench.status.sessionCostTooltip')
    expect(topBar).not.toContain('TopBarUsageSlot')
  })

  it('uses the plate-free portrait for the titlebar mark', () => {
    expect(tileMark).toContain('rox-mark-portrait-18.png')
    expect(tileMark).not.toContain('rox-mark-tile-')
  })
  it('exposes the seven primary surfaces without requiring experimental Workbench chrome', () => {
    expect(topBar).toContain('const showModePill = !isCompact')
    expect(topBar).not.toContain('const showModePill = chrome.showModeBar')
  })

})
