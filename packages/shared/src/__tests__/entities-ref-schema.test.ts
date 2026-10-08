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

describe('entityRefSchema fragment canonicalisation (review 3 #4)', () => {
  it('strips route-level prefixes exactly like parseEntityRef', async () => {
    const { parseEntityRef, entityRoute, formatEntityRef } = await import('@rox/core/entities')
    const cases: Array<[Record<string, string>, string]> = [
      [{ kind: 'goal-target', id: 'g1', fragment: 't-3' }, 'goal-target:g1#t-3'],
      [{ kind: 'goal-check', id: 'g1', fragment: 'k-7' }, 'goal-check:g1#k-7'],
      [{ kind: 'channel-message', id: 'c1', fragment: 'seq-128' }, 'channel-message:c1#seq-128'],
    ]
    for (const [input, literal] of cases) {
      const parsed = entityRefSchema.parse(input)
      const viaLiteral = parseEntityRef(literal)
      expect(viaLiteral.ok).toBe(true)
      if (!viaLiteral.ok) continue
      expect(parsed).toEqual(viaLiteral.value)
      expect(formatEntityRef(parsed)).toBe(formatEntityRef(viaLiteral.value))
    }
    expect(entityRoute(entityRefSchema.parse({ kind: 'goal-target', id: 'g1', fragment: 't-3' }))).not.toContain('t-t-')
  })

  it('leaves canonical and non-prefixed fragments alone', () => {
    expect(entityRefSchema.parse({ kind: 'goal-target', id: 'g1', fragment: '3' })).toEqual({ kind: 'goal-target', id: 'g1', fragment: '3' })
    expect(entityRefSchema.parse({ kind: 'wiki-space', id: 'w', fragment: 't-3' })).toEqual({ kind: 'wiki-space', id: 'w', fragment: 't-3' })
    expect(entityRefSchema.parse({ kind: 'task', id: 't1' })).toEqual({ kind: 'task', id: 't1' })
  })
})
