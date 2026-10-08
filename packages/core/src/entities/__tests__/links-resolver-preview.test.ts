import { describe, expect, test } from 'bun:test'

import {
  ENTITY_RELATIONS,
  ROX2_RELATION_KINDS,
  entityLinkDedupeKey,
  isEntityRelation,
} from '../links.ts'
import { EntityResolutionCache } from '../resolver.ts'
import {
  applyPreviewRedaction,
  isRestrictedPreview,
  previewModelFromEntityPreview,
  redactedEntityPreview,
  type EntityPreview,
} from '../preview.ts'
import type { EntityRef } from '../refs.ts'

const taskRef: EntityRef = { kind: 'task', id: '1' }

describe('W1-02 entity links', () => {
  test('exposes 12 relations extending the frozen 8', () => {
    expect(ENTITY_RELATIONS).toHaveLength(12)
    expect(new Set(ENTITY_RELATIONS).size).toBe(12)
    expect(ENTITY_RELATIONS.slice(0, ROX2_RELATION_KINDS.length)).toEqual([...ROX2_RELATION_KINDS])
    expect(ENTITY_RELATIONS).toContain('embeds')
    expect(ENTITY_RELATIONS).toContain('resource-of')
  })

  test('isEntityRelation rejects unknown relations', () => {
    expect(isEntityRelation('mentions')).toBe(true)
    expect(isEntityRelation('aligned-to')).toBe(true)
    expect(isEntityRelation('bogus')).toBe(false)
  })

  test('dedupe key ignores role and anchor', () => {
    const a = entityLinkDedupeKey({ from: taskRef, relation: 'mentions', to: { kind: 'note', id: 'n1' } })
    const b = entityLinkDedupeKey({ from: taskRef, relation: 'mentions', to: { kind: 'note', id: 'n1' } })
    const c = entityLinkDedupeKey({ from: taskRef, relation: 'mentions', to: { kind: 'note', id: 'n2' } })
    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })
})

describe('W1-02 resolution cache', () => {
  const preview = (id: string, etag: string): EntityPreview => ({
    ref: { kind: 'task', id },
    status: 'ok',
    title: id,
    kindLabel: 'entities.kind.task',
    icon: 'circle-check',
    authority: 'local',
    etag,
  })

  test('evicts least-recently-used entries at capacity', () => {
    const cache = new EntityResolutionCache(2)
    cache.set('a', preview('a', 'e1'))
    cache.set('b', preview('b', 'e1'))
    cache.get('a') // refresh recency
    cache.set('c', preview('c', 'e1'))
    expect(cache.get('a')?.title).toBe('a')
    expect(cache.get('b')).toBeUndefined()
    expect(cache.get('c')?.title).toBe('c')
    expect(cache.size).toBe(2)
  })

  test('setIfEtagChanged skips unchanged etags', () => {
    const cache = new EntityResolutionCache(4)
    expect(cache.setIfEtagChanged('a', preview('a', 'e1'))).toBe(true)
    expect(cache.setIfEtagChanged('a', preview('a', 'e1'))).toBe(false)
    expect(cache.setIfEtagChanged('a', preview('a', 'e2'))).toBe(true)
  })

  test('delete and clear drop entries', () => {
    const cache = new EntityResolutionCache(4)
    cache.set('a', preview('a', 'e1'))
    cache.delete('a')
    expect(cache.get('a')).toBeUndefined()
    cache.set('b', preview('b', 'e1'))
    cache.clear()
    expect(cache.size).toBe(0)
  })
})

describe('W1-02 preview redaction', () => {
  const okPreview: EntityPreview = {
    ref: { kind: 'goal', id: '7' },
    status: 'ok',
    title: 'Ship W1',
    kindLabel: 'entities.kind.goal',
    icon: 'target',
    authority: 'local',
    fields: [{ id: 'owner', label: 'Owner', value: 'Ann' }],
    etag: 'e1',
  }

  test('projects an ok preview into a model', () => {
    const model = previewModelFromEntityPreview(okPreview, { dates: { due: '2026-12-01' } })
    expect(model.restricted).toBe(false)
    expect(model.title).toBe('Ship W1')
    expect(model.dates?.due).toBe('2026-12-01')
    expect(isRestrictedPreview(model)).toBe(false)
  })

  test('redacts forbidden previews without leaking entity data', () => {
    for (const status of ['no_access', 'unavailable', 'tombstone'] as const) {
      const model = applyPreviewRedaction({ ...okPreview, status })
      expect(isRestrictedPreview(model)).toBe(true)
      if (isRestrictedPreview(model)) {
        expect(model.restricted).toBe(true)
        expect(model.title).toBe('')
        expect(model.kind).toBe('goal')
        expect(JSON.stringify(model)).not.toContain('Ship W1')
        expect(JSON.stringify(model)).not.toContain('Ann')
      }
    }
  })

  test('redactedEntityPreview keeps only the ref', () => {
    const redacted = redactedEntityPreview(taskRef)
    expect(redacted).toEqual({ ref: taskRef, restricted: true })
  })
})