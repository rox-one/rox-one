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
    expect(openTree).toContain('rounded-md')
    expect(openTree).not.toContain('rounded-xl')
    expect(openTree).not.toContain('rounded-lg')
    expect(openTree).toContain('mx-0.5 mb-0.5')
    expect(openTree).not.toContain('mx-2 mb-2')
    expect(openTree).not.toContain('absolute right-1.5 top-1.5')
    expect(openTree).toContain('flex h-6 shrink-0 items-center border-b')

    expect(terminal).not.toMatch(/cwd \? <div/)
    expect(terminal).not.toContain('text-white/30">{cwd}')
    expect(terminal).toContain("t('inspector.terminalHint')")

    expect(shell).toContain('export const bottomDockHeightAtom')
    expect(shell).toMatch(/bottomDockHeightAtom[\s\S]*?\n\s*104,/)
    expect(dock).toContain('const MIN_HEIGHT = 88')
    expect(dock).toContain('window.innerHeight * 0.30')
  })
})
