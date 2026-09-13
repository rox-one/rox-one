import { describe, expect, it } from 'bun:test'
import { isContrastMode, resolveContrast } from '../contrast-mode.ts'

describe('app-wide contrast (issue 07 leftover)', () => {
  it('resolves system to high when the OS asks for more contrast', () => {
    expect(resolveContrast('system', true)).toBe('high')
    expect(resolveContrast('system', false)).toBe('normal')
  })

  it('lets the user force high or standard regardless of OS', () => {
    expect(resolveContrast('high', false)).toBe('high')
    expect(resolveContrast('normal', true)).toBe('normal')
  })

  it('rejects unknown stored values', () => {
    expect(isContrastMode('high')).toBe(true)
    expect(isContrastMode('system')).toBe(true)
    expect(isContrastMode('more')).toBe(false)
  })
})
