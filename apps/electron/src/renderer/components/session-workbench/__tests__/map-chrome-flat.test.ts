import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const editor = readFileSync(join(import.meta.dir, '../SessionWorkflowEditor.tsx'), 'utf8')
const terminal = readFileSync(join(import.meta.dir, '../../session-inspector/InspectorTerminal.tsx'), 'utf8')
const dock = readFileSync(join(import.meta.dir, '../../session-inspector/BottomTerminalDock.tsx'), 'utf8')
const css = readFileSync(join(import.meta.dir, '../../../index.css'), 'utf8')

describe('flat map + terminal chrome', () => {
  it('map toolbar actions are a flat group, not an outlined pill', () => {
    const start = editor.indexOf('map-toolbar-group')
    expect(start).toBeGreaterThan(-1)
    const groupTag = editor.slice(editor.lastIndexOf('<div', start), editor.indexOf('>', start))
    expect(groupTag).not.toContain('shadow-strong')
    expect(groupTag).not.toContain('rounded-full')
    expect(groupTag).not.toContain('bg-background/60')
    // Buttons are flat at rest (no per-button pill fill); only the active
    // camera mode is filled.
    expect(editor).not.toContain('map-toolbar-btn h-7 rounded-full')
    expect(editor).not.toContain('map-toolbar-btn h-7 rounded-md bg-foreground')
    expect(editor).toContain("camera === 'map' && 'bg-foreground/10")
  })

  it('toolbar row shares the content background (no radial glow band)', () => {
    expect(editor).not.toContain('radial-gradient(circle_at_top')
    expect(editor).toContain("background: 'var(--background)'")
    expect(editor).toMatch(/<Background[^>]*bgColor="transparent"/)
    expect(css).toMatch(/html\[data-contrast="high"\] \.map-toolbar-btn \{[^}]*background-color: transparent;/)
  })

  it('minimap renders only with scenes and without an outline', () => {
    expect(editor).toMatch(/\{!mapEmpty && showMinimap \? \(\s*<MiniMap/)
    const mini = editor.slice(editor.indexOf('<MiniMap'), editor.indexOf('/>', editor.indexOf('<MiniMap')))
    expect(mini).toContain('!border-0')
    expect(mini).toContain('!shadow-none')
    expect(mini).not.toContain('!border-white/10')
  })

  it('terminal input is flat at rest; focus is a subtle underline, HC a 2px underline', () => {
    expect(terminal).toContain('autoFocus={autoFocus}')
    expect(terminal).toContain('rox-terminal-input')
    expect(dock).toContain('autoFocus={focusOnOpen}')
    expect(css).toMatch(/\.rox-terminal-input:focus-visible \{\s*outline: none;/)
    expect(css).toContain('.rox-terminal-prompt:has(.rox-terminal-input:focus-visible)')
    expect(css).toMatch(/html\[data-contrast="high"\] \.rox-terminal-prompt:has\(\.rox-terminal-input:focus-visible\) \{[^}]*inset 0 -2px 0 var\(--focus\)/)
  })
})
