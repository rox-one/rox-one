import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { EntityPreview, EntityRef, Resolver } from '@rox/core/entities'
import { EntityLinkStore, closeEntityLinkStores, getEntityLinkStore } from '../link-store.ts'
import { DefaultResolverHost } from '../resolver-host.ts'
import {
  extractEntityRefsFromText,
  extractLinksFromMessage,
  extractLinksFromTiptapDoc,
  extractWikilinkTargets,
  wikilinkTargetsToRefs,
} from '../extract.ts'

const roots: string[] = []
afterEach(() => {
  closeEntityLinkStores()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix))
  roots.push(root)
  return root
}

const note = (id: string): EntityRef => ({ kind: 'note', id })
const task = (id: string, fragment?: string): EntityRef => (fragment ? { kind: 'task', id, fragment } : { kind: 'task', id })

function previewFor(ref: EntityRef, suffix = ''): EntityPreview {
  return {
    ref,
    status: 'ok',
    title: `${ref.kind}:${ref.id}${suffix}`,
    kindLabel: `entities.kind.${ref.kind}`,
    icon: ref.kind,
    authority: 'local',
    etag: `e-${ref.kind}-${ref.id}-${suffix}`,
  }
}

describe('EntityLinkStore', () => {
  it('creates the database lazily and round-trips links with anchors', () => {
    const root = tempRoot('rox-entity-links-')
    const store = getEntityLinkStore(root)
    expect(getEntityLinkStore(root)).toBe(store)

    const link = store.add({
      from: note('n1'),
      to: task('t1', 'sec-2'),
      relation: 'mentions',
      role: 'assignee',
      anchor: { blockId: 'blk-7', line: 3 },
      createdBy: 'user-1',
    })

    expect(link.to).toEqual({ kind: 'task', id: 't1', fragment: 'sec-2' })
    expect(link.createdBy).toBe('user-1')
    expect(link.anchor).toEqual({ blockId: 'blk-7', line: 3 })
    expect(link.revision).toBe(1)
    expect(store.count()).toBe(1)

    const outgoing = store.outgoing(note('n1'))
    expect(outgoing).toHaveLength(1)
    expect(outgoing[0]!.linkId).toBe(link.linkId)
  })

  it('upserts on the (from, relation, to) identity instead of duplicating', () => {
    const store = new EntityLinkStore({ workspaceRoot: tempRoot('rox-entity-links-') })
    try {
      const first = store.add({ from: note('n1'), to: task('t1'), relation: 'mentions', createdBy: 'user-1' })
      const second = store.add({
        from: note('n1'),
        to: task('t1'),
        relation: 'mentions',
        role: 'reviewer',
        anchor: { line: 9 },
        createdBy: 'user-2',
      })

      expect(second.linkId).toBe(first.linkId)
      // Setting a role/anchor takes ownership of the row (review 5 #3).
      expect(second.createdBy).toBe('user-2')
      expect(second.revision).toBe(2)
      expect(second.role).toBe('reviewer')
      expect(second.anchor).toEqual({ line: 9 })
      expect(store.count()).toBe(1)
      // A bare re-add (no role, no anchor) keeps the author.
      const third = store.add({ from: note('n1'), to: task('t1'), relation: 'mentions', createdBy: 'user-3' })
      expect(third.linkId).toBe(first.linkId)
      expect(third.createdBy).toBe('user-2')
      // A different relation is a distinct link.
      store.add({ from: note('n1'), to: task('t1'), relation: 'blocks', createdBy: 'user-1' })
      expect(store.count()).toBe(2)
    } finally {
      store.close()
    }
  })

  it('removes by identity and reports whether a row was deleted', () => {
    const store = new EntityLinkStore({ workspaceRoot: tempRoot('rox-entity-links-') })
    try {
      store.add({ from: note('n1'), to: task('t1'), relation: 'mentions', createdBy: 'user-1' })
      expect(store.remove({ from: note('n1'), to: task('t1'), relation: 'mentions' })).toBe(true)
      expect(store.remove({ from: note('n1'), to: task('t1'), relation: 'mentions' })).toBe(false)
      expect(store.count()).toBe(0)
    } finally {
      store.close()
    }
  })

  it('paginates backlinks with filters and a stable cursor', () => {
    const store = new EntityLinkStore({ workspaceRoot: tempRoot('rox-entity-links-') })
    try {
      for (let i = 0; i < 5; i++) {
        store.add({ from: note(`n${i}`), to: task('t1'), relation: 'mentions', createdBy: 'u' })
      }
      store.add({ from: note('other'), to: task('t1'), relation: 'blocks', createdBy: 'u' })
      store.add({ from: note('noise'), to: note('elsewhere'), relation: 'mentions', createdBy: 'u' })

      const first = store.backlinks(task('t1'), { limit: 2 })
      expect(first.links).toHaveLength(2)
      expect(first.nextCursor).toBeString()

      const second = store.backlinks(task('t1'), { limit: 2, cursor: first.nextCursor })
      expect(second.links).toHaveLength(2)
      const seen = new Set([...first.links, ...second.links].map(link => link.linkId))
      expect(seen.size).toBe(4)

      const third = store.backlinks(task('t1'), { limit: 2, cursor: second.nextCursor })
      expect(third.links).toHaveLength(2)
      expect(third.nextCursor).toBeUndefined()

      const filtered = store.backlinks(task('t1'), { relations: ['blocks'] })
      expect(filtered.links).toHaveLength(1)
      expect(filtered.links[0]!.from.id).toBe('other')
    } finally {
      store.close()
    }
  })
})

describe('DefaultResolverHost', () => {
  const noteResolver = (calls: EntityRef[][]): Resolver => ({
    kinds: ['note'],
    async resolve(refs) {
      calls.push(refs)
      return refs.map(ref => previewFor(ref))
    },
  })

  it('fans out by kind, preserves order and caches repeats', async () => {
    const host = new DefaultResolverHost()
    const calls: EntityRef[][] = []
    host.register(noteResolver(calls))

    const refs = [note('n1'), note('n2'), task('t1'), note('n1')]
    const first = await host.resolve(refs, { id: 'u', kind: 'user' })

    expect(first.map(p => p.title)).toEqual(['note:n1', 'note:n2', '', 'note:n1'])
    expect(first[2]!.status).toBe('unavailable')
    expect(calls).toHaveLength(1)
    expect(calls[0]!.map(r => r.id)).toEqual(['n1', 'n2'])

    await host.resolve([note('n1')], { id: 'u', kind: 'user' })
    expect(calls).toHaveLength(1)
    expect(host.cacheSize).toBe(2)

    host.invalidate(note('n1'))
    await host.resolve([note('n1')], { id: 'u', kind: 'user' })
    expect(calls).toHaveLength(2)
  })

  it('batches large inputs by the configured size', async () => {
    const host = new DefaultResolverHost({ batchSize: 40 })
    const calls: number[] = []
    host.register({
      kinds: ['task'],
      async resolve(refs) {
        calls.push(refs.length)
        return refs.map(ref => previewFor(ref))
      },
    })

    const refs = Array.from({ length: 100 }, (_, i) => task(`t${i}`))
    const started = performance.now()
    const previews = await host.resolve(refs, { id: 'u', kind: 'user' })
    const elapsed = performance.now() - started

    expect(previews).toHaveLength(100)
    expect(calls).toEqual([40, 40, 20])
    expect(elapsed).toBeLessThan(40)
  })

  it('drops least-recently-used entries beyond capacity', async () => {
    const host = new DefaultResolverHost({ cacheCapacity: 2 })
    host.register(noteResolver([]))
    await host.resolve([note('a'), note('b')], { id: 'u', kind: 'user' })
    await host.resolve([note('c')], { id: 'u', kind: 'user' })
    expect(host.cacheSize).toBe(2)
  })
})

describe('link extraction', () => {
  it('collects unique wikilink targets', () => {
    expect(extractWikilinkTargets('see [[Alpha]] and [[Alpha#Head|alias]] and [[Beta]]')).toEqual(['Alpha', 'Beta'])
    expect(wikilinkTargetsToRefs('[[Alpha]]')).toEqual([{ to: { kind: 'note', id: 'Alpha' } }])
  })

  it('free-text kind:id refs are inert (explicit syntax only)', () => {
    expect(extractEntityRefsFromText('task:t1 blocks note:n2\nthen project:p1 and task:t1')).toEqual([])
    expect(extractEntityRefsFromText('not-a-ref: x and unknown:thing')).toEqual([])
    expect(extractEntityRefsFromText('doc:2 and user:admin and file:///Users/a/b')).toEqual([])
  })

  it('walks TipTap documents and attributes links to their block', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { id: 'blk-1' },
          content: [
            { type: 'text', text: 'link to [[task:t1]]' },
            { type: 'text', text: 'wiki [[Alpha]]' },
            { type: 'text', text: 'bare task:t9 creates no link' },
          ],
        },
        {
          type: 'wikilink',
          attrs: { target: 'note:n9' },
        },
      ],
    }
    expect(extractLinksFromTiptapDoc(doc)).toEqual([
      { to: { kind: 'task', id: 't1' }, blockId: 'blk-1' },
      { to: { kind: 'note', id: 'Alpha' }, blockId: 'blk-1' },
      { to: { kind: 'note', id: 'n9' } },
    ])
  })

  it('anchors message links by their sequence', () => {
    expect(extractLinksFromMessage({ content: 'cc [[task:t7]] and [[Alpha]]', sequence: 42 })).toEqual([
      { to: { kind: 'task', id: 't7' }, seq: 42 },
      { to: { kind: 'note', id: 'Alpha' }, seq: 42 },
    ])
    expect(extractLinksFromMessage({ content: 'cc task:t7 bare creates no link', sequence: 42 })).toEqual([])
  })
})