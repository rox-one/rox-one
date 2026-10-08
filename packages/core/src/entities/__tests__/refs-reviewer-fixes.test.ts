import { describe, expect, test } from 'bun:test'
import {
  ENTITY_FRAGMENT_KINDS,
  entityRefKey,
  formatEntityRef,
  kindTakesFragment,
  parseEntityRef,
} from '../refs.ts'
import { entityRoute } from '../routes.ts'

describe('reviewer fix #7 — percent-encoding round-trip', () => {
  test('ids with # and % round-trip through format/parse', () => {
    for (const id of ['a#b', '100%', 'a#100%b', '%23', 'x%25y#z']) {
      const ref = { kind: 'task' as const, id }
      const literal = formatEntityRef(ref)
      expect(literal.includes('#')).toBe(false)
      // A raw % may remain only as part of %23/%25 escapes.
      expect(literal.replace(/%2[35]/g, '').includes('%')).toBe(false)
      const parsed = parseEntityRef(literal)
      expect(parsed.ok).toBe(true)
      if (parsed.ok) expect(parsed.value).toEqual(ref)
    }
  })

  test('fragments with # and % round-trip', () => {
    const ref = { kind: 'goal-target' as const, id: 'g1', fragment: 'a#b%c' }
    const literal = formatEntityRef(ref)
    const parsed = parseEntityRef(literal)
    expect(parsed).toEqual({ ok: true, value: ref })
  })

  test('legacy plain ids are untouched', () => {
    expect(formatEntityRef({ kind: 'task', id: 't1' })).toBe('task:t1')
    expect(parseEntityRef('task:t1')).toEqual({ ok: true, value: { kind: 'task', id: 't1' } })
  })

  test('entityRefKey uses the encoded literal', () => {
    expect(entityRefKey({ kind: 'task', id: 'a#b' })).toBe('task:a%23b')
  })

  test('encoded ids survive the route builder encoding', () => {
    const route = entityRoute({ kind: 'task', id: 'a#b' })
    expect(route).toBe('tasks/task/a%23b')
  })
})

describe('reviewer fix #8 — fragment allow-list and normalisation', () => {
  test('fragment kinds are the nine container-relative kinds', () => {
    const actual: string[] = [...ENTITY_FRAGMENT_KINDS].sort()
    expect(actual).toEqual(
      [
        'base-record',
        'base-table',
        'base-view',
        'channel-message',
        'goal-check',
        'goal-target',
        'kpi',
        'task-section',
        'wiki-space',
      ].sort(),
    )
    expect(kindTakesFragment('task')).toBe(false)
    expect(kindTakesFragment('goal')).toBe(false)
    expect(kindTakesFragment('goal-target')).toBe(true)
    expect(kindTakesFragment('channel-message')).toBe(true)
  })

  test('rejects fragments on kinds that do not take them', () => {
    expect(parseEntityRef('task:1#x')).toMatchObject({ ok: false, error: { code: 'unexpected-fragment' } })
    expect(parseEntityRef('goal:7#t-3')).toMatchObject({ ok: false, error: { code: 'unexpected-fragment' } })
    expect(parseEntityRef('note:n1#sec')).toMatchObject({ ok: false, error: { code: 'unexpected-fragment' } })
    // Bare refs without fragments stay valid.
    expect(parseEntityRef('task:1')).toEqual({ ok: true, value: { kind: 'task', id: '1' } })
    expect(parseEntityRef('goal:7')).toEqual({ ok: true, value: { kind: 'goal', id: '7' } })
  })

  test('normalises route prefixes so one entity has one encoding', () => {
    expect(parseEntityRef('goal-target:g1#t-3')).toEqual({ ok: true, value: { kind: 'goal-target', id: 'g1', fragment: '3' } })
    expect(parseEntityRef('goal-check:g1#k-7')).toEqual({ ok: true, value: { kind: 'goal-check', id: 'g1', fragment: '7' } })
    expect(parseEntityRef('channel-message:c1#seq-128')).toEqual({
      ok: true,
      value: { kind: 'channel-message', id: 'c1', fragment: '128' },
    })
    // Canonical forms without prefixes still parse.
    expect(parseEntityRef('goal-target:g1#3')).toEqual({ ok: true, value: { kind: 'goal-target', id: 'g1', fragment: '3' } })
  })

  test('empty fragments still report empty-fragment', () => {
    expect(parseEntityRef('goal-target:g1#')).toMatchObject({ ok: false, error: { code: 'empty-fragment' } })
  })
})
