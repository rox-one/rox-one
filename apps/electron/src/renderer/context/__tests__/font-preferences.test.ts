import { describe, expect, it } from 'bun:test'
import {
  normalizeChatFont,
  normalizeTerminalFont,
  normalizeUiFont,
  resolveStoredUiFont,
} from '../font-preferences'

describe('font preferences', () => {
  it('defaults UI and chat to Rox and terminal to JetBrains Mono', () => {
    expect(normalizeUiFont(undefined)).toBe('rox')
    expect(normalizeChatFont(undefined)).toBe('rox')
    expect(normalizeTerminalFont(undefined)).toBe('jetbrains')
  })

  it('keeps stored inter/system/jetbrains choices', () => {
    expect(normalizeUiFont('inter')).toBe('inter')
    expect(normalizeUiFont('system')).toBe('system')
    expect(normalizeChatFont('inter')).toBe('inter')
    expect(normalizeTerminalFont('system')).toBe('system')
    expect(normalizeTerminalFont('rox')).toBe('rox')
  })

  it('rejects unknown ids', () => {
    expect(normalizeUiFont('comic-sans')).toBe('rox')
    expect(normalizeTerminalFont('courier')).toBe('jetbrains')
  })

  it('migrates the legacy SF-as-system default to Rox, but keeps an explicit system choice', () => {
    expect(resolveStoredUiFont(undefined)).toBe('rox')
    expect(resolveStoredUiFont({ font: 'system' })).toBe('rox')
    expect(resolveStoredUiFont({ font: 'inter' })).toBe('inter')
    expect(resolveStoredUiFont({ font: 'system', chatFont: 'rox' })).toBe('system')
  })
})
