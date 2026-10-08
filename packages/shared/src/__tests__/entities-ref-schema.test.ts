import { describe, expect, it } from 'bun:test'
import { entityRefSchema } from '../entities/schemas.ts'

describe('entityRefSchema fragment rule', () => {
  it('accepts fragments only for kinds that take them', () => {
    expect(entityRefSchema.safeParse({ kind: 'task-section', id: 'l1', fragment: 's' }).success).toBe(true)
    expect(entityRefSchema.safeParse({ kind: 'wiki-space', id: 'w', fragment: 'План' }).success).toBe(true)
    expect(entityRefSchema.safeParse({ kind: 'task', id: 't1', fragment: 'sec' }).success).toBe(false)
    expect(entityRefSchema.safeParse({ kind: 'note', id: 'n1', fragment: 'h' }).success).toBe(false)
  })

  it('keeps fragment-less refs valid for every kind', () => {
    expect(entityRefSchema.safeParse({ kind: 'task', id: 't1' }).success).toBe(true)
    expect(entityRefSchema.safeParse({ kind: 'note', id: 'n1' }).success).toBe(true)
  })
})
