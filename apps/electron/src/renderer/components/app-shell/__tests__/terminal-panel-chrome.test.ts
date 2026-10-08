import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const panel = readFileSync(join(import.meta.dir, '../TerminalPanel.tsx'), 'utf8')
const stack = readFileSync(join(import.meta.dir, '../PanelStackContainer.tsx'), 'utf8')
const terminal = readFileSync(join(import.meta.dir, '../../session-inspector/InspectorTerminal.tsx'), 'utf8')
const shell = readFileSync(join(import.meta.dir, '../../../atoms/unified-shell.ts'), 'utf8')

describe('terminal panel chrome', () => {
  it('drops the open chrome-strip title row and cwd prefix', () => {
    const openTree = panel.slice(panel.indexOf('return ('))
    expect(openTree).not.toContain('chrome-strip')
    expect(openTree).not.toContain("{t('inspector.terminal')}")
    expect(openTree).toContain('h-5 w-5')
    expect(openTree).toContain('ChevronsDown')
    // One-surface shell: the terminal is a flush pane under the panel content
    // with a single top hairline — no rounded outlined box, no margins.
    expect(openTree).toContain('rox-shell-pane rox-shell-divider-t')
    expect(openTree).not.toContain('rounded-md border')
    expect(openTree).not.toContain('rounded-xl')
    expect(openTree).not.toContain('rounded-lg')
    expect(openTree).not.toContain('shadow-middle')
    expect(openTree).not.toContain('mx-0.5 mb-0.5')
    expect(openTree).not.toContain('mx-2 mb-2')
    expect(openTree).not.toContain('absolute right-1.5 top-1.5')
    expect(openTree).toContain('flex h-6 shrink-0 items-center')

    expect(terminal).not.toMatch(/cwd \? <div/)
    expect(terminal).not.toContain('text-white/30">{cwd}')
    expect(terminal).toContain("t('inspector.terminalHint')")
    // One prompt (placeholder only) and no permanent collapsed strip.
    expect(terminal).not.toContain('text-white/40">{t(\'inspector.terminalHint\')}')
    expect(panel).toContain('data-terminal-panel="true"')
    expect(panel).toContain('setOpen(false)')
    expect(panel).not.toContain('data-bottom-terminal')

    // The height comes from the panel cell (half of the first column), so the
    // terminal keeps no px dock height and no resize sash of its own.
    expect(shell).not.toContain('bottomDockHeightAtom')
    expect(panel).not.toContain('MIN_HEIGHT')
    expect(panel).not.toContain('window.innerHeight')
    expect(panel).not.toContain('ResizeHandle')

    // The owning panel decides visibility; the TopBar button stays the entry point.
    expect(stack).toContain('bottomTerminalOpenAtom')
    expect(stack).toContain("flexBasis: '50%'")
    expect(stack).toContain('<TerminalPanel autoFocus={terminalFocusOnOpenRef.current} />')

    // The cell mounts on open, so the panel cannot watch the closed→open edge
    // itself: it takes the flag and never focuses a launch restore.
    expect(panel).toContain('{ autoFocus = false }: { autoFocus?: boolean }')
    expect(panel).not.toContain('wasOpenRef')
    expect(panel).not.toContain('focusOnOpen')
  })
})