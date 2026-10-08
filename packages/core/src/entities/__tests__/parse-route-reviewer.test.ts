import { describe, expect, test } from 'bun:test'
import { entityLinkDedupeKey } from '../links.ts'
import { EntityResolutionCache } from '../resolver.ts'
import { formatEntityRef } from '../refs.ts'
import { parseEntityRoute, parseEntityRouteOrLegacy } from '../parse-route.ts'
import type { EntityPreview } from '../preview.ts'

describe('entityLinkDedupeKey: no collisions on raw separators', () => {
  test('ids containing # and | stay distinct', () => {
    const a = entityLinkDedupeKey({
      from: { kind: 'note', id: 'a#b' },
      relation: 'mentions',
      to: { kind: 'note', id: 'c' },
    })
    const b = entityLinkDedupeKey({
      from: { kind: 'note', id: 'a' },
      relation: 'mentions',
      to: { kind: 'note', id: 'b|c' },
    })
    // The old `${kind}:${id}#…|…` template collided here; JSON of the escaped
    // literals cannot.
    expect(a).not.toBe(b)
    expect(a).toBe(
      JSON.stringify([formatEntityRef({ kind: 'note', id: 'a#b' }), 'mentions', formatEntityRef({ kind: 'note', id: 'c' })]),
    )
  })

  test('fragments participate in the key', () => {
    const a = entityLinkDedupeKey({
      from: { kind: 'task-section', id: 'l1', fragment: 'x' },
      relation: 'mentions',
      to: { kind: 'task', id: 't1' },
    })
    const b = entityLinkDedupeKey({
      from: { kind: 'task-section', id: 'l1', fragment: 'y' },
      relation: 'mentions',
      to: { kind: 'task', id: 't1' },
    })
    expect(a).not.toBe(b)
  })
})

describe('EntityResolutionCache TTL', () => {
  const preview = (id: string): EntityPreview => ({
    ref: { kind: 'task', id },
    status: 'ok',
    title: id,
    kindLabel: 'entities.kind.task',
    icon: 'circle-check',
    authority: 'local',
    etag: 'e1',
  })

  test('entries expire after ttlMs', () => {
    const now = Date.now()
    const cache = new EntityResolutionCache(10, 60_000)
    cache.set('a', preview('a'))
    expect(cache.get('a')?.title).toBe('a')
    const realNow = Date.now
    try {
      Date.now = () => now + 60_001
      expect(cache.get('a')).toBeUndefined()
    } finally {
      Date.now = realNow
    }
  })

  test('ttlMs 0 never expires', () => {
    const cache = new EntityResolutionCache(10)
    cache.set('a', preview('a'))
    expect(cache.get('a')?.title).toBe('a')
  })
})

describe('parseEntityRoute: shared grammar', () => {
  test('percent-encoded wiki fragments decode (Cyrillic page names)', () => {
    const parsed = parseEntityRoute('docs/wiki/w1/%D0%9F%D0%BB%D0%B0%D0%BD')
    expect(parsed?.ref).toEqual({ kind: 'wiki-space', id: 'w1', fragment: 'План' })
  })

  test('kind-first routes keep parsing', () => {
    expect(parseEntityRoute('goals/goal/g-1')?.ref).toEqual({ kind: 'goal', id: 'g-1' })
    expect(parseEntityRoute('messenger/c-1?seq=128')?.ref).toEqual({ kind: 'channel-message', id: 'c-1', fragment: '128' })
    expect(parseEntityRoute('base/b1/t1/v1?record=r1')?.ref).toEqual({
      kind: 'base-record',
      id: 'b1',
      fragment: 't1/v1/r1',
    })
  })

  test('kind-first entry point rejects legacy routes', () => {
    expect(parseEntityRoute('notes/note/n-1')).toBeNull()
    expect(parseEntityRoute('tasks/task/t-1')).toBeNull()
    expect(parseEntityRoute('allSessions/session/s-1')).toBeNull()
  })

  test('orLegacy entry point covers frozen legacy shapes', () => {
    expect(parseEntityRouteOrLegacy('notes/note/n-1')?.ref).toEqual({ kind: 'note', id: 'n-1' })
    expect(parseEntityRouteOrLegacy('tasks/task/t-1')?.ref).toEqual({ kind: 'task', id: 't-1' })
    expect(parseEntityRouteOrLegacy('meetings/meeting/m-1')?.ref).toEqual({ kind: 'call', id: 'm-1' })
    expect(parseEntityRouteOrLegacy('allSessions/session/s-1')?.ref).toEqual({ kind: 'session', id: 's-1' })
    expect(parseEntityRouteOrLegacy('inbox/item/i-1')?.ref).toEqual({ kind: 'mail-thread', id: 'i-1' })
    expect(parseEntityRouteOrLegacy('feed/item/i-1')?.ref).toEqual({ kind: 'feed-item', id: 'i-1' })
    expect(parseEntityRouteOrLegacy('goals/goal/g-1')?.ref).toEqual({ kind: 'goal', id: 'g-1' })
    expect(parseEntityRouteOrLegacy('rox://x')).toBeNull()
    expect(parseEntityRouteOrLegacy('definitely-not-a-route')).toBeNull()
  })
})
