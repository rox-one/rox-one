import { describe, expect, test } from 'bun:test'

import {
  ENTITY_ICON_NAMES,
  ENTITY_KINDS,
  ENTITY_KIND_DESCRIPTORS,
  ENTITY_KIND_DESCRIPTORS as DESCRIPTORS,
  ROX2_ENTITY_KINDS,
  entityDeepLink,
  entityRefKey,
  entityRoute,
  formatEntityRef,
  isEntityKind,
  kindDescriptor,
  parseEntityRef,
} from '../index.ts'
import { KIND_ALIASES, normalizeKindAlias } from '../aliases.ts'
import { ENTITY_ROUTE_PREFIXES, isEntityRoutePrefix } from '../routes.ts'

describe('W1-01 kind registry', () => {
  test('freezes the 21 Rox2 kinds byte-identically', () => {
    expect(ROX2_ENTITY_KINDS).toEqual([
      'session',
      'note',
      'task',
      'project',
      'page',
      'memory',
      'skill',
      'source',
      'automation',
      'connection',
      'file',
      'mail-thread',
      'calendar-event',
      'crm-company',
      'channel',
      'channel-message',
      'call',
      'reminder',
      'workflow',
      'person',
      'license-component',
    ])
  })

  test('registers 54 distinct kinds, Rox2 first', () => {
    expect(ENTITY_KINDS).toHaveLength(54)
    expect(new Set(ENTITY_KINDS).size).toBe(54)
    expect(ENTITY_KINDS.slice(0, ROX2_ENTITY_KINDS.length)).toEqual([...ROX2_ENTITY_KINDS])
  })

  test('every kind has a complete descriptor', () => {
    for (const kind of ENTITY_KINDS) {
      const descriptor = DESCRIPTORS[kind]
      expect(descriptor, `missing descriptor for ${kind}`).toBeDefined()
      expect(descriptor.kind).toBe(kind)
      expect(descriptor.labelKey).toBe(`entities.kind.${kind}`)
      expect(descriptor.icon.length).toBeGreaterThan(0)
      expect(ENTITY_ICON_NAMES).toContain(descriptor.icon)
      expect(descriptor.authorities.length).toBeGreaterThan(0)
      expect(typeof descriptor.route).toBe('function')
    }
    expect(Object.keys(DESCRIPTORS).sort()).toEqual([...ENTITY_KINDS].sort())
  })

  test('every descriptor route is non-empty and prefixed with a known entity prefix', () => {
    for (const kind of ENTITY_KINDS) {
      const route = entityRoute({ kind, id: 'x' })
      expect(route.length, `empty route for ${kind}`).toBeGreaterThan(0)
      expect(isEntityRoutePrefix(route), `unknown prefix for ${kind}: ${route}`).toBe(true)
    }
  })

  test('isEntityKind narrows correctly', () => {
    expect(isEntityKind('goal')).toBe(true)
    expect(isEntityKind('task')).toBe(true)
    expect(isEntityKind('widget')).toBe(false)
    expect(isEntityKind('')).toBe(false)
  })
})

describe('W1-01 reference grammar', () => {
  test('parses canonical refs', () => {
    expect(parseEntityRef('task:42')).toEqual({ ok: true, value: { kind: 'task', id: '42' } })
    expect(parseEntityRef('goal:7#t-3')).toEqual({
      ok: true,
      value: { kind: 'goal', id: '7', fragment: 't-3' },
    })
  })

  test('normalises every alias to its canonical kind', () => {
    for (const [alias, canonical] of Object.entries(KIND_ALIASES)) {
      const parsed = parseEntityRef(`${alias}:abc`)
      expect(parsed.ok, `alias ${alias} should parse`).toBe(true)
      if (parsed.ok) {
        expect(parsed.value.kind).toBe(canonical)
        expect(isEntityKind(canonical)).toBe(true)
      }
      expect<string>(normalizeKindAlias(alias)).toBe(canonical)
    }
  })

  test('round-trips every kind through format/parse', () => {
    for (const kind of ENTITY_KINDS) {
      const literal = formatEntityRef({ kind, id: 'a/b c' })
      const parsed = parseEntityRef(literal)
      expect(parsed.ok, `failed to parse ${literal}`).toBe(true)
      if (parsed.ok) {
        expect(parsed.value).toEqual({ kind, id: 'a/b c' })
        expect(entityRefKey(parsed.value)).toBe(literal)
      }
    }
  })

  test('never throws; reports structured errors', () => {
    expect(parseEntityRef('')).toEqual({
      ok: false,
      error: { code: 'empty', message: 'empty reference', input: '' },
    })
    expect(parseEntityRef('nocolon')).toMatchObject({ ok: false, error: { code: 'missing-kind' } })
    expect(parseEntityRef('widget:1')).toMatchObject({ ok: false, error: { code: 'unknown-kind' } })
    expect(parseEntityRef('task:')).toMatchObject({ ok: false, error: { code: 'empty-id' } })
    expect(parseEntityRef('task:1#')).toMatchObject({ ok: false, error: { code: 'empty-fragment' } })
  })

  test('throws only when formatting an empty id', () => {
    expect(() => formatEntityRef({ kind: 'task', id: '' })).toThrow()
  })
})

describe('W1-01 route map', () => {
  test('produces the frozen legacy route for a Rox2 kind', () => {
    expect(entityRoute({ kind: 'task', id: '42' })).toBe('tasks/task/42')
    expect(entityRoute({ kind: 'note', id: 'a b' })).toBe('notes/note/a%20b')
    expect(entityRoute({ kind: 'project', id: 'p1' })).toBe('projects/project/p1')
    expect(entityRoute({ kind: 'memory', id: 'ignored' })).toBe('memory')
  })

  test('builds container-relative routes from fragment', () => {
    expect(entityRoute({ kind: 'goal-target', id: 'g1', fragment: 'r2' })).toBe('goals/goal/g1#t-r2')
    expect(entityRoute({ kind: 'task-section', id: 'l1', fragment: 's2' })).toBe('tasks/list/l1?section=s2')
    expect(entityRoute({ kind: 'channel-message', id: 'c1', fragment: '128' })).toBe('messenger/c1?seq=128')
    expect(entityRoute({ kind: 'base-record', id: 'b1', fragment: 't/v/r' })).toBe('base/b1/t/v?record=r')
    expect(entityRoute({ kind: 'base-table', id: 'b1', fragment: 't1' })).toBe('base/b1/t1')
  })

  test('entityDeepLink prefixes rox://', () => {
    expect(entityDeepLink({ kind: 'goal', id: '7' })).toBe('rox://goals/goal/7')
  })

  test('every descriptor route prefix is declared', () => {
    for (const route of ENTITY_ROUTE_PREFIXES) {
      expect(route.length).toBeGreaterThan(0)
    }
    expect(ENTITY_ROUTE_PREFIXES).toContain('goals')
    expect(ENTITY_ROUTE_PREFIXES).toContain('docs')
    expect(ENTITY_ROUTE_PREFIXES).toContain('messenger')
  })

  test('kindDescriptor returns the same object as the registry', () => {
    expect(kindDescriptor('goal')).toBe(ENTITY_KIND_DESCRIPTORS.goal)
  })
})