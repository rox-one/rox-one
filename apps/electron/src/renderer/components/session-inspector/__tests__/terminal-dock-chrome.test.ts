import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const dock = readFileSync(join(import.meta.dir, '../BottomTerminalDock.tsx'), 'utf8')
const terminal = readFileSync(join(import.meta.dir, '../InspectorTerminal.tsx'), 'utf8')
const shell = readFileSync(join(import.meta.dir, '../../../atoms/unified-shell.ts'), 'utf8')

describe('terminal dock chrome', () => {
  it('drops the open chrome-strip title row and cwd prefix', () => {
    const openTree = dock.slice(dock.indexOf('return (', dock.indexOf('data-bottom-terminal="collapsed"')))
    expect(openTree).not.toContain('chrome-strip')
    expect(openTree).not.toContain("{t('inspector.terminal')}")
    expect(openTree).toContain('h-5 w-5')
    expect(openTree).toContain('ChevronsDown')
    expect(openTree).toContain('rounded-lg')
    expect(openTree).not.toContain('rounded-xl')
    expect(openTree).toContain('mx-1 mb-1')
    expect(openTree).not.toContain('mx-2 mb-2')

    expect(terminal).not.toMatch(/cwd \? <div/)
    expect(terminal).not.toContain('text-white/30">{cwd}')
    expect(terminal).toContain("t('inspector.terminalHint')")

    expect(shell).toContain('export const bottomDockHeightAtom')
    expect(shell).toMatch(/bottomDockHeightAtom[\s\S]*?\n\s*128,/)
    expect(dock).toContain('const MIN_HEIGHT = 96')
    expect(dock).toContain('window.innerHeight * 0.36')
  })
})
