import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const schema = readFileSync(join(__dirname, '..', 'mode-types.ts'), 'utf8')
const parser = readFileSync(join(__dirname, '..', 'permissions-config.ts'), 'utf8')

describe('permissions JSON without DSH network proxy', () => {
  it('accepts autoReview rules and never wires a 127.0.0.1 proxy', () => {
    expect(schema).toContain('autoReview:')
    expect(schema).toContain('denyPatterns')
    expect(schema).not.toContain('networkProxy')
    expect(parser).toContain('autoReview:')
    expect(parser).toContain('DEFAULT_PERMISSION_SHADOW_RULES')
    expect(parser).not.toMatch(/127\.0\.0\.1/)
    expect(parser).not.toContain('networkProxy')
  })
})
