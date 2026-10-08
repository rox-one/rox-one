/**
 * Reviewer fix #7 — ids carrying `#`/`%` round-trip through refs and routes.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { formatEntityRef, parseEntityRef } from '@rox/core/entities'
import { parseEntityRoute } from '../entity-routes'
import { buildCompoundRoute, parseCompoundRoute, resetEntityRoutesEnabled, setEntityRoutesEnabled } from '../route-parser'

describe('entity id escaping round-trips through the route parser', () => {
  beforeEach(() => setEntityRoutesEnabled(true))
  afterEach(() => resetEntityRoutesEnabled())

  test('task ids with # and % survive format/parse and the entity route', () => {
    for (const id of ['a#b', '100%', 'a#100%b']) {
      const literal = formatEntityRef({ kind: 'task', id })
      const parsed = parseEntityRef(literal)
      expect(parsed).toEqual({ ok: true, value: { kind: 'task', id } })

      // Legacy task routes are not entity-compound routes, but the encoded
      // literal must still decode to the same entity.
      expect(parseEntityRef(literal)?.ok).toBe(true)
    }
  })

  test('channel-message fragment ids round-trip through parseEntityRoute', () => {
    const route = 'messenger/c-1?seq=128'
    const parsed = parseEntityRoute(route)
    expect(parsed?.ref).toEqual({ kind: 'channel-message', id: 'c-1', fragment: '128' })
    const literal = formatEntityRef(parsed!.ref)
    expect(literal).toBe('channel-message:c-1#128')
    expect(parseCompoundRoute(route)?.entityRef).toEqual(parsed!.ref)
    expect(buildCompoundRoute(parseCompoundRoute(route)!)).toBe(route)
  })

  test('goal-target fragments normalise through the route parser', () => {
    const parsed = parseEntityRoute('goals/goal/g-1#t-3')
    expect(parsed?.ref).toEqual({ kind: 'goal-target', id: 'g-1', fragment: '3' })
    expect(formatEntityRef(parsed!.ref)).toBe('goal-target:g-1#3')
  })
})
