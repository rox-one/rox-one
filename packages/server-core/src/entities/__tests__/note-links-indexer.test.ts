/**
 * W1-02 (#1499) note-mention indexer units (fix5 B): explicit-syntax
 * extraction from Markdown, atomic idempotent reconcile, flag-off inertia.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeEntityLinkStores, EntityLinkStore, getEntityLinkStore } from '../link-store.ts'
import { createNoteLinksIndexer, extractNoteLinks, NOTE_LINKS_INDEXER_ACTOR } from '../note-links-indexer.ts'

const roots: string[] = []
const tempRoot = () => {
  const root = mkdtempSync(join(tmpdir(), 'rox-note-links-unit-'))
  roots.push(root)
  return root
}
afterEach(() => {
  closeEntityLinkStores()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('extractNoteLinks (explicit syntax only)', () => {
  it('links wikilinks, embeds, plain titles and rox:// with first-occurrence lines', () => {
    const md = ['# Title', 'See [[task:42|Fix]] and ![[note:Plan]].', 'rox://goals/goal/g1, [[Итоги#Решения]], [[task:42]] again'].join('\n')
    expect(extractNoteLinks(md)).toEqual([
      { to: { kind: 'task', id: '42' }, relation: 'mentions', line: 2 },
      { to: { kind: 'note', id: 'Plan' }, relation: 'embeds', line: 2 },
      { to: { kind: 'note', id: 'Итоги' }, relation: 'mentions', line: 3 },
      { to: { kind: 'goal', id: 'g1' }, relation: 'mentions', line: 3 },
    ])
  })

  it('never links bare kind:id, URLs or escaped wikilinks', () => {
    expect(extractNoteLinks('task:42 doc:2 user:admin file:///Users/x https://example.com/doc:2 \\[\\[task:1\\]\\]')).toEqual([])
  })

  it('applies the approved note-title rules', () => {
    expect(extractNoteLinks('[[Встреча: итоги]] [[Проект:Альфа]]').map(link => link.to)).toEqual([
      { kind: 'note', id: 'Встреча: итоги' },
      { kind: 'note', id: 'Проект:Альфа' },
    ])
  })

  it('skips frontmatter, fenced code blocks and inline code', () => {
    const md = [
      '---', 'related: "[[task:fm]]"', '---',
      '`[[task:inline]]` and ``[[task:double]]``',
      '```ts', '[[task:fenced]]', '```',
      '~~~~', '[[task:tilde]]', '~~~', 'still fenced [[task:still]]', '~~~~',
      'after [[task:after]]',
    ].join('\n')
    expect(extractNoteLinks(md).map(link => link.to.id)).toEqual(['after'])
  })

  it('drops self links', () => {
    expect(extractNoteLinks('[[note:me]] [[task:1]]', { kind: 'note', id: 'me' }).map(link => link.to.id)).toEqual(['1'])
  })
})

describe('EntityLinkStore.replaceOutgoing', () => {
  const from = { kind: 'note' as const, id: 'n1' }
  it('adds, keeps, updates anchors and removes stale links; idempotent', () => {
    const store = new EntityLinkStore({ workspaceRoot: tempRoot() })
    const other = { kind: 'note' as const, id: 'n2' }
    store.add({ from: other, to: { kind: 'task', id: 't9' }, relation: 'mentions', createdBy: 'u' })
    expect(store.replaceOutgoing(from, [
      { to: { kind: 'task', id: 't1' }, relation: 'mentions', anchor: { line: 1 } },
      { to: { kind: 'task', id: 't2' }, relation: 'mentions', anchor: { line: 2 } },
      { to: { kind: 'task', id: 't1' }, relation: 'mentions', anchor: { line: 9 } },
    ], 'a')).toEqual({ added: 2, updated: 0, removed: 0 })
    expect(store.replaceOutgoing(from, [
      { to: { kind: 'task', id: 't1' }, relation: 'mentions', anchor: { line: 1 } },
      { to: { kind: 'task', id: 't2' }, relation: 'mentions', anchor: { line: 2 } },
    ], 'a')).toEqual({ added: 0, updated: 0, removed: 0 })
    const t1Before = store.outgoing(from).find(link => link.to.id === 't1')!
    expect(store.replaceOutgoing(from, [
      { to: { kind: 'task', id: 't1' }, relation: 'mentions', anchor: { line: 5 } },
      { to: { kind: 'task', id: 't3' }, relation: 'embeds' },
    ], 'a')).toEqual({ added: 1, updated: 1, removed: 1 })
    const links = store.outgoing(from)
    expect(links.map(link => `${link.relation}:${link.to.id}`).sort()).toEqual(['embeds:t3', 'mentions:t1'])
    const t1After = links.find(link => link.to.id === 't1')!
    expect(t1After.linkId).toBe(t1Before.linkId)
    expect(t1After.anchor).toEqual({ line: 5 })
    expect(t1After.revision).toBe(t1Before.revision + 1)
    // Other notes' links are untouched.
    expect(store.outgoing(other)).toHaveLength(1)
    expect(store.replaceOutgoing(from, [], 'a')).toEqual({ added: 0, updated: 0, removed: 2 })
    expect(store.count()).toBe(1)
    store.close()
  })

  it('rolls back the whole reconcile on failure', () => {
    const store = new EntityLinkStore({ workspaceRoot: tempRoot() })
    store.replaceOutgoing(from, [{ to: { kind: 'task', id: 't1' }, relation: 'mentions' }], 'a')
    // Throws only once the write phase reads it again (after t1 was deleted
    // inside the transaction), so the rollback is really exercised.
    let reads = 0
    const poisoned = { get kind() { if (++reads > 1) throw new Error('boom'); return 'task' }, id: 'x' } as unknown as { kind: 'task'; id: string }
    expect(() => store.replaceOutgoing(from, [
      { to: { kind: 'task', id: 't2' }, relation: 'mentions' },
      { to: poisoned, relation: 'mentions' },
    ], 'a')).toThrow()
    expect(store.outgoing(from).map(link => link.to.id)).toEqual(['t1'])
    // The connection is usable again after the rollback.
    expect(store.replaceOutgoing(from, [], 'a').removed).toBe(1)
    store.close()
  })

  it('removeOutgoingByIdPrefix is an exact prefix match', () => {
    const store = new EntityLinkStore({ workspaceRoot: tempRoot() })
    for (const id of ['a/x', 'a/b/y', 'ab/z', 'a%/w']) {
      store.add({ from: { kind: 'note', id }, to: { kind: 'task', id: 't' }, relation: 'mentions', createdBy: 'u' })
    }
    expect(store.removeOutgoingByIdPrefix('note', 'a/')).toBe(2)
    expect(store.count()).toBe(2)
    store.close()
  })
})

describe('createNoteLinksIndexer', () => {
  it('flag off: writes nothing and never opens the store', () => {
    const root = tempRoot()
    const pushes: string[] = []
    const indexer = createNoteLinksIndexer({ isEnabled: () => false, notify: id => pushes.push(id) })
    expect(indexer.index({ id: 'ws', rootPath: root }, 'n1', '[[task:1]]')).toBe(false)
    expect(indexer.remove({ id: 'ws', rootPath: root }, 'n1')).toBe(false)
    expect(indexer.removeFolder({ id: 'ws', rootPath: root }, 'folder')).toBe(false)
    expect(existsSync(join(root, '.rox'))).toBe(false)
    expect(pushes).toEqual([])
  })

  it('flag on: reconciles, notifies only on change, never rewrites content', () => {
    const root = tempRoot()
    const pushes: string[] = []
    const indexer = createNoteLinksIndexer({ isEnabled: () => true, notify: id => pushes.push(id) })
    const workspace = { id: 'ws', rootPath: root }
    const content = 'Mentions [[task:1]] and [[task:2]]'
    expect(indexer.index(workspace, 'n1', content)).toBe(true)
    expect(indexer.index(workspace, 'n1', content)).toBe(false)
    expect(pushes).toEqual(['ws'])
    const store = getEntityLinkStore(root)
    expect(store.outgoing({ kind: 'note', id: 'n1' }).map(link => [link.to.id, link.createdBy])).toEqual([
      ['1', NOTE_LINKS_INDEXER_ACTOR],
      ['2', NOTE_LINKS_INDEXER_ACTOR],
    ])
    expect(indexer.index(workspace, 'n1', 'Only [[task:2]]')).toBe(true)
    expect(store.backlinks({ kind: 'task', id: '1' }).links).toEqual([])
    expect(indexer.remove(workspace, 'n1')).toBe(true)
    expect(indexer.remove(workspace, 'n1')).toBe(false)
    expect(store.count()).toBe(0)
    expect(pushes).toEqual(['ws', 'ws', 'ws'])
  })

  it('a failing notify is logged, not thrown', () => {
    const warnings: unknown[] = []
    const indexer = createNoteLinksIndexer({
      isEnabled: () => true,
      notify: () => { throw new Error('push failed') },
      logger: { warn: (...args: unknown[]) => { warnings.push(args) } },
    })
    expect(indexer.index({ id: 'ws', rootPath: tempRoot() }, 'n1', '[[task:1]]')).toBe(true)
    expect(warnings).toHaveLength(1)
  })
})
