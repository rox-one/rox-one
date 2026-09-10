import { describe, expect, it } from 'bun:test'
import { isValidSessionId, sanitizeSessionId } from '../validation.ts'

describe('session id sanitization', () => {
  it('keeps slug ids and drops traversal leftovers', () => {
    expect(sanitizeSessionId('260202-swift-river')).toBe('260202-swift-river')
    expect(sanitizeSessionId('../../../tmp')).toBe('tmp')
    expect(sanitizeSessionId('..')).toBe('')
    expect(sanitizeSessionId('.')).toBe('')
    expect(isValidSessionId('..')).toBe(false)
    expect(isValidSessionId('260202-swift-river')).toBe(true)
  })
})
