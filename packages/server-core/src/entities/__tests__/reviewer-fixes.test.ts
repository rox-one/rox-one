import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { EntityPreview, EntityRef, Resolver } from '@rox/core/entities'
import { EntityLinkStore, closeEntityLinkStores } from '../link-store.ts'
import { DefaultResolverHost } from '../resolver-host.ts'
import { wikilinkTargetsToRefs } from '../extract.ts'

const roots: string[] = []
afterEach(() => {
  closeEntityLinkStores()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'rox-reviewer-'))
  roots.push(root)
  return root
}

const okPreview = (ref: EntityRef, title = `${ref.kind}:${ref.id}`): EntityPreview => ({
  ref,
  status: 'ok',
  title,
  kindLabel: `entities.kind.${ref.kind}`,
  icon: 'link',
  authority: 'local',
  etag: 'e1',
})

describe('reviewer fix #3 — resolver host maps by index and isolates failures', () => {
  it('maps results by input position when the resolver normalises refs', async () => {
    const host = new DefaultResolverHost()
    host.register({
      kinds: ['task'],
      async resolve(refs, _actor) {
        // Buggy resolver: returns previews keyed by a normalised ref.
        return refs.map(ref => okPreview({ kind: 'task', id: ref.id.toUpperCase() }))
      },
    })
    const refs: EntityRef[] = [
      { kind: 'task', id: 't1' },
      { kind: 'task', id: 't2' },
    ]
    const previews = await host.resolve(refs, { id: 'u', kind: 'user' })
    expect(previews).toHaveLength(2)
    // Results follow input order, one per input ref.
    expect(previews[0]!.title).toBe('task:T1')
    expect(previews[1]!.title).toBe('task:T2')
  })

  it('a rejecting resolver only marks its own refs unavailable', async () => {
    const host = new DefaultResolverHost()
    host.register({
      kinds: ['task'],
      async resolve() {
        throw new Error('boom')
      },
    })
    host.register({
      kinds: ['note'],
      async resolve(refs, _actor) {
        return refs.map(ref => okPreview(ref))
      },
    })
    const previews = await host.resolve(
      [
        { kind: 'task', id: 't1' },
        { kind: 'note', id: 'n1' },
      ],
      { id: 'u', kind: 'user' },
    )
    expect(previews[0]).toMatchObject({ status: 'unavailable' })
    expect(previews[0]!.ref).toEqual({ kind: 'task', id: 't1' })
    expect(previews[1]).toMatchObject({ status: 'ok', title: 'note:n1' })
  })

  it('short resolver responses fill the tail with unavailable', async () => {
    const host = new DefaultResolverHost()
    const short: Resolver = {
      kinds: ['note'],
      async resolve(refs, _actor) {
        return refs.slice(0, 1).map(ref => okPreview(ref))
      },
    }
    host.register(short)
    const previews = await host.resolve(
      [
        { kind: 'note', id: 'n1' },
        { kind: 'note', id: 'n2' },
      ],
      { id: 'u', kind: 'user' },
    )
    expect(previews[0]).toMatchObject({ status: 'ok' })
    expect(previews[1]).toMatchObject({ status: 'unavailable', ref: { kind: 'note', id: 'n2' } })
  })

  it('actor scopes the cache so previews do not leak across users', async () => {
    const host = new DefaultResolverHost()
    let calls = 0
    host.register({
      kinds: ['note'],
      async resolve(refs, actor) {
        calls++
        return refs.map(ref => okPreview(ref, `for-${actor.id}`))
      },
    })
    const ref: EntityRef = { kind: 'note', id: 'n1' }
    const a = await host.resolve([ref], { id: 'alice', kind: 'user' })
    const b = await host.resolve([ref], { id: 'bob', kind: 'user' })
    expect(a[0]!.title).toBe('for-alice')
    expect(b[0]!.title).toBe('for-bob')
    expect(calls).toBe(2)
    // Repeat hits the per-actor entry.
    await host.resolve([ref], { id: 'alice', kind: 'user' })
    expect(calls).toBe(2)
  })

  it('invalidate clears every actor variant of a ref', async () => {
    const host = new DefaultResolverHost()
    let calls = 0
    host.register({
      kinds: ['note'],
      async resolve(refs, actor) {
        calls++
        return refs.map(ref => okPreview(ref, `for-${actor.id}-${calls}`))
      },
    })
    const ref: EntityRef = { kind: 'note', id: 'n1' }
    await host.resolve([ref], { id: 'alice', kind: 'user' })
    await host.resolve([ref], { id: 'bob', kind: 'user' })
    expect(calls).toBe(2)
    host.invalidate(ref)
    await host.resolve([ref], { id: 'alice', kind: 'user' })
    await host.resolve([ref], { id: 'bob', kind: 'user' })
    expect(calls).toBe(4)
  })
})

describe('reviewer fix #4 — backlinks kinds filter matches the source kind', () => {
  it('filters on from_kind, not to_kind', () => {
    const store = new EntityLinkStore({ workspaceRoot: tempRoot() })
    try {
      const target: EntityRef = { kind: 'task', id: 't1' }
      store.add({ from: { kind: 'note', id: 'n1' }, to: target, relation: 'mentions', createdBy: 'u' })
      store.add({ from: { kind: 'task', id: 't9' }, to: target, relation: 'mentions', createdBy: 'u' })

      const notes = store.backlinks(target, { kinds: ['note'] })
      expect(notes.links).toHaveLength(1)
      expect(notes.links[0]!.from).toEqual({ kind: 'note', id: 'n1' })

      const tasks = store.backlinks(target, { kinds: ['task'] })
      expect(tasks.links).toHaveLength(1)
      expect(tasks.links[0]!.from).toEqual({ kind: 'task', id: 't9' })
    } finally {
      store.close()
    }
  })
})

describe('reviewer fix #5 — outgoing/backlinks are fragment-aware', () => {
  it('keeps container-relative siblings apart', () => {
    const store = new EntityLinkStore({ workspaceRoot: tempRoot() })
    try {
      const sectionA: EntityRef = { kind: 'task-section', id: 'l1', fragment: 'sec-a' }
      const sectionB: EntityRef = { kind: 'task-section', id: 'l1', fragment: 'sec-b' }
      const target: EntityRef = { kind: 'task', id: 't1' }
      store.add({ from: sectionA, to: target, relation: 'mentions', createdBy: 'u' })
      store.add({ from: sectionB, to: target, relation: 'mentions', createdBy: 'u' })
      store.add({ from: { kind: 'task-section', id: 'l1' }, to: target, relation: 'mentions', createdBy: 'u' })

      expect(store.backlinks(sectionA, {}).links).toHaveLength(0)

      const toTargetFromA = store.backlinks(target, {})
      expect(toTargetFromA.links).toHaveLength(3)

      const outA = store.outgoing(sectionA)
      expect(outA).toHaveLength(1)
      expect(outA[0]!.from).toEqual(sectionA)

      const outBare = store.outgoing({ kind: 'task-section', id: 'l1' })
      expect(outBare).toHaveLength(1)
      expect(outBare[0]!.from).toEqual({ kind: 'task-section', id: 'l1' })

      // Fragment-scoped backlinks: message seq 128 does not see seq 129.
      const msg128: EntityRef = { kind: 'channel-message', id: 'c1', fragment: '128' }
      const msg129: EntityRef = { kind: 'channel-message', id: 'c1', fragment: '129' }
      store.add({ from: { kind: 'note', id: 'n1' }, to: msg128, relation: 'mentions', createdBy: 'u' })
      store.add({ from: { kind: 'note', id: 'n2' }, to: msg129, relation: 'mentions', createdBy: 'u' })
      expect(store.backlinks(msg128, {}).links.map(l => l.from.id)).toEqual(['n1'])
      expect(store.backlinks(msg129, {}).links.map(l => l.from.id)).toEqual(['n2'])
      expect(store.backlinks({ kind: 'channel-message', id: 'c1' }, {}).links).toHaveLength(0)
    } finally {
      store.close()
    }
  })
})

describe('reviewer fix #6 — wikilinks prefer entity refs', () => {
  it('parses entity-looking targets instead of minting bogus notes', () => {
    expect(wikilinkTargetsToRefs('[[task:t1|Fix]]')).toEqual([{ to: { kind: 'task', id: 't1' } }])
    expect(wikilinkTargetsToRefs('[[Alpha]]')).toEqual([{ to: { kind: 'note', id: 'Alpha' } }])
    // Unknown kinds are not minted as notes.
    expect(wikilinkTargetsToRefs('[[widget:1]]')).toEqual([])
    // Alias form resolves to the canonical kind.
    expect(wikilinkTargetsToRefs('[[doc:hello]]')).toEqual([{ to: { kind: 'note', id: 'hello' } }])
  })

  it('dedupes entity and alias spellings of the same ref', () => {
    expect(wikilinkTargetsToRefs('[[task:t1]] and [[task:t1|Fix]] and [[Alpha]] and [[Alpha]]')).toEqual([
      { to: { kind: 'task', id: 't1' } },
      { to: { kind: 'note', id: 'Alpha' } },
    ])
  })
})
