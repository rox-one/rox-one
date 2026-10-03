import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PANEL_EDGE_INSET, PANEL_GAP, PANEL_STACK_TOP_INSET, PANEL_STACK_VERTICAL_OVERFLOW } from '../panel-constants'

const appShell = readFileSync(join(import.meta.dir, '../AppShell.tsx'), 'utf8')
const panelStack = readFileSync(join(import.meta.dir, '../PanelStackContainer.tsx'), 'utf8')

describe('sash terminal clearance', () => {
  it('stops resize sashes from drawing through the top bar gap and bottom terminal', () => {
    // Rounded shell: stack and resize sashes share the same 4px top inset.
    expect(PANEL_STACK_TOP_INSET).toBe(PANEL_GAP)
    expect(PANEL_STACK_TOP_INSET).toBe(4)
    expect(PANEL_EDGE_INSET).toBe(4)
    expect(PANEL_STACK_VERTICAL_OVERFLOW).toBe(0)

    expect(appShell).toContain('bottomTerminalOpenAtom')
    expect(appShell).toContain('bottomDockHeightAtom')
    expect(appShell).toContain(
      'const terminalClearance = (bottomTerminalOpen ? bottomDockHeight : 0) + PANEL_EDGE_INSET + 4',
    )
    expect(appShell).toContain('top: PANEL_STACK_TOP_INSET')
    expect(appShell).toContain('bottom: terminalClearance')
    expect(appShell).not.toMatch(/bottom:\s*PANEL_STACK_VERTICAL_OVERFLOW/)

    // The unified container applies the top inset only to desktop layouts.
    expect(panelStack).toContain('paddingTop: isCompact ? undefined : PANEL_STACK_TOP_INSET')
    expect(panelStack).not.toContain('marginTop: -PANEL_STACK_TOP_INSET')
  })

  it('bounds both shell resize hit areas to the content column and terminal clearance', () => {
    for (const label of ['sidebar', 'navigator']) {
      const style = appShell.match(new RegExp(`<ResizeHandle\\s+[\\s\\S]*?labelKey="shell\\.resize\\.${label}"[\\s\\S]*?style=\\{\\{([\\s\\S]*?)\\}\\}`))?.[1]
      expect(style).toBeDefined()
      expect(style).toContain('top: PANEL_STACK_TOP_INSET')
      expect(style).toContain('bottom: terminalClearance')
      expect(style).toContain("height: 'auto'")
    }
  })
})
