import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { readG2AcceptedVariant } from '../g2-status'

describe('readG2AcceptedVariant', () => {
  it('returns C when ACCEPTED and variant C', () => {
    expect(readG2AcceptedVariant('# G2\n> **Status: ACCEPTED**\nvariant C')).toBe('C')
  })

  it('returns null when OPEN', () => {
    expect(readG2AcceptedVariant('**Status: OPEN**')).toBe(null)
  })

  it('parses the repo G2 record as C', () => {
    const markdown = readFileSync(
      resolve(import.meta.dir, '../../../../../docs/specs/2026-08-07-siyuan-integration/g2-decision-record.md'),
      'utf8',
    )
    expect(readG2AcceptedVariant(markdown)).toBe('C')
  })
})