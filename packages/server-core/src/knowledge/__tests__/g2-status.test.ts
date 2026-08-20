import { describe, expect, it } from 'bun:test'
import { readG2AcceptedVariant } from '../g2-status'

describe('readG2AcceptedVariant', () => {
  it('returns C when ACCEPTED and variant C', () => {
    expect(readG2AcceptedVariant('# G2\n> **Status: ACCEPTED**\nvariant C')).toBe('C')
  })

  it('returns null when OPEN', () => {
    expect(readG2AcceptedVariant('**Status: OPEN**')).toBe(null)
  })
})
