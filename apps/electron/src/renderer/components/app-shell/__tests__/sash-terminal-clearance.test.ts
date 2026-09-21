import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const appShell = readFileSync(join(import.meta.dir, '../AppShell.tsx'), 'utf8')
const panelStack = readFileSync(join(import.meta.dir, '../PanelStackContainer.tsx'), 'utf8')
const constants = readFileSync(join(import.meta.dir, '../panel-constants.ts'), 'utf8')

describe('sash terminal clearance', () => {
  it('stops resize sashes from drawing through the top bar gap and bottom terminal', () => {
    expect(constants).toContain('export const PANEL_STACK_TOP_INSET = 2')
    expect(constants).toContain('export const PANEL_STACK_VERTICAL_OVERFLOW = 0')

    expect(appShell).toContain('bottomTerminalOpenAtom')
    expect(appShell).toContain('bottomDockHeightAtom')
    expect(appShell).toContain(
      'const terminalClearance = (bottomTerminalOpen ? bottomDockHeight : 28) + PANEL_EDGE_INSET + 4',
    )
    expect(appShell).toContain('top: PANEL_STACK_TOP_INSET')
    expect(appShell).toContain('bottom: terminalClearance')
    expect(appShell).not.toMatch(/bottom:\s*PANEL_STACK_VERTICAL_OVERFLOW/)

    const desktop = panelStack.slice(panelStack.indexOf('DESKTOP BRANCH'))
    expect(desktop).toContain('paddingTop: PANEL_STACK_TOP_INSET')
    expect(desktop).not.toContain('marginTop: -PANEL_STACK_TOP_INSET')
  })
})
