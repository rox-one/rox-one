import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PANEL_EDGE_INSET, PANEL_GAP, PANEL_STACK_TOP_INSET, PANEL_STACK_VERTICAL_OVERFLOW } from '../panel-constants'

const appShell = readFileSync(join(import.meta.dir, '../AppShell.tsx'), 'utf8')
const panelStack = readFileSync(join(import.meta.dir, '../PanelStackContainer.tsx'), 'utf8')

describe('sash terminal clearance', () => {
  it('keeps resize sashes flush with the flat stack instead of clearing a bottom dock', () => {
    // Flat shell: stack and resize sashes share the same zero top inset.
    expect(PANEL_STACK_TOP_INSET).toBe(PANEL_GAP)
    expect(PANEL_STACK_TOP_INSET).toBe(0)
    expect(PANEL_EDGE_INSET).toBe(0)
    expect(PANEL_STACK_VERTICAL_OVERFLOW).toBe(0)


    // The terminal is a panel-cell surface, so the absolute rail sashes keep
    // the flat zero-inset seam and no longer shorten for a bottom dock.
    expect(appShell).not.toContain('bottomDockHeightAtom')
    expect(appShell).not.toContain('bottomTerminalOpen')
    expect(appShell).toContain('const terminalClearance = PANEL_EDGE_INSET + 4')
    expect(appShell).toContain('top: PANEL_STACK_TOP_INSET')
    expect(appShell).toContain('bottom: terminalClearance')
    expect(appShell).not.toMatch(/bottom:\s*PANEL_STACK_VERTICAL_OVERFLOW/)

    // The persistent container chooses its desktop inset without separate branches.
    expect(panelStack).toContain('paddingTop: isCompact ? undefined : PANEL_STACK_TOP_INSET')
    expect(panelStack).not.toContain('marginTop: -PANEL_STACK_TOP_INSET')
  })
})
