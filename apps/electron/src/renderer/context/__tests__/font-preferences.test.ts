import { describe, expect, it } from 'bun:test'
import {
  normalizeChatFont,
  normalizeTerminalFont,
  normalizeUiFont,
  resolveStoredUiFont,
} from '../font-preferences'

describe('font preferences', () => {
  it('defaults UI, chat, and terminal to Rox', () => {
    expect(normalizeUiFont(undefined)).toBe('rox')
    expect(normalizeChatFont(undefined)).toBe('rox')
    expect(normalizeTerminalFont(undefined)).toBe('rox')
  })

  it('keeps stored inter/system/jetbrains choices', () => {
    expect(normalizeUiFont('inter')).toBe('inter')
    expect(normalizeUiFont('system')).toBe('system')
    expect(normalizeChatFont('inter')).toBe('inter')
    expect(normalizeTerminalFont('system')).toBe('system')
    expect(normalizeTerminalFont('rox')).toBe('rox')
    expect(normalizeTerminalFont('jetbrains')).toBe('jetbrains')
  })

  it('rejects unknown ids', () => {
    expect(normalizeUiFont('comic-sans')).toBe('rox')
    expect(normalizeTerminalFont('courier')).toBe('rox')
  })

  it('migrates the legacy SF-as-system default to Rox, but keeps an explicit system choice', () => {
    expect(resolveStoredUiFont(undefined)).toBe('rox')
    expect(resolveStoredUiFont({ font: 'system' })).toBe('rox')
    expect(resolveStoredUiFont({ font: 'inter' })).toBe('inter')
    expect(resolveStoredUiFont({ font: 'system', chatFont: 'rox' })).toBe('system')
  })
})
