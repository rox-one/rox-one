import { describe, expect, it } from 'bun:test'
import { maskTokenForDisplay, secureTokenCompare } from '../headless-start.ts'

describe('secureTokenCompare (RX-SEC-0007)', () => {
  const TOKEN = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2a3b4'

  it('accepts the exact token', () => {
    expect(secureTokenCompare(TOKEN, TOKEN)).toBe(true)
  })

  it('rejects a wrong token', () => {
    expect(secureTokenCompare('wrong-token-value-entirely-here', TOKEN)).toBe(false)
  })

  it('rejects empty and mismatched lengths without throwing', () => {
    expect(secureTokenCompare('', TOKEN)).toBe(false)
    expect(secureTokenCompare(TOKEN, '')).toBe(false)
    expect(secureTokenCompare('short', 'longer-value')).toBe(false)
  })
})

describe('maskTokenForDisplay (RX-SEC-0003)', () => {
  const TOKEN = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2a3b4'

  it('never returns the full secret', () => {
    const masked = maskTokenForDisplay(TOKEN)
    expect(masked).not.toBe(TOKEN)
    expect(masked).not.toContain('c9d0e1f2')
  })

  it('keeps a short prefix/suffix hint for long tokens', () => {
    expect(maskTokenForDisplay(TOKEN).startsWith('a1b2')).toBe(true)
    expect(maskTokenForDisplay(TOKEN).endsWith('a3b4')).toBe(true)
  })

  it('fully masks short tokens instead of leaking them', () => {
    expect(maskTokenForDisplay('short')).toBe('***')
    expect(maskTokenForDisplay('')).toBe('***')
  })
})
