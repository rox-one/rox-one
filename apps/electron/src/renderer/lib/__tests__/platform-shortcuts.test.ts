import { describe, expect, it } from 'bun:test'
import { formatHotkeyDisplay, isMac } from '../platform'

describe('platform shortcut labels', () => {
  it('uses readable Ctrl/Shift/Alt chords on Windows and Linux', () => {
    expect(formatHotkeyDisplay('mod+n', false)).toBe('Ctrl+N')
    expect(formatHotkeyDisplay('shift+mod+d', false)).toBe('Shift+Ctrl+D')
    expect(formatHotkeyDisplay('alt+up', false)).toBe('Alt+↑')
    expect(formatHotkeyDisplay('mod+enter', false)).toBe('Ctrl+Enter')
  })

  it('keeps Command and Option glyphs on macOS', () => {
    expect(formatHotkeyDisplay('mod+n', true)).toBe('⌘N')
    expect(formatHotkeyDisplay('shift+mod+d', true)).toBe('⇧⌘D')
    expect(formatHotkeyDisplay('alt+down', true)).toBe('⌥↓')
    expect(formatHotkeyDisplay('mod+enter', true)).toBe('⌘↵')
  })

  it('distinguishes the bound Backspace key from Delete', () => {
    expect(formatHotkeyDisplay('mod+backspace', false)).toBe('Ctrl+Backspace')
    expect(formatHotkeyDisplay('delete', false)).toBe('Delete')
    expect(formatHotkeyDisplay('mod+backspace', true)).toBe('⌘⌫')
    expect(formatHotkeyDisplay('delete', true)).toBe('⌦')
  })

  it('preserves the global registry notation and defaults to the detected OS', () => {
    expect(formatHotkeyDisplay('MOD+SHIFT+[', false)).toBe('Ctrl+Shift+[')
    expect(formatHotkeyDisplay('mod+left', true)).toBe('⌘←')
    expect(formatHotkeyDisplay('mod+right', false)).toBe('Ctrl+→')
    expect(formatHotkeyDisplay('escape', false)).toBe('Esc')
    expect(formatHotkeyDisplay('tab', true)).toBe('Tab')
    expect(formatHotkeyDisplay('space', false)).toBe('Space')
    expect(formatHotkeyDisplay('mod+k')).toBe(isMac ? '⌘K' : 'Ctrl+K')
  })
})
